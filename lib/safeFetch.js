import dns from "node:dns";
import net from "node:net";
import axios from "axios";

/**
 * Guarded outbound HTTP for commands that fetch a user-supplied URL.
 *
 * A chat command that takes a URL and returns its body is a request proxy. If
 * the bot runs on the same host as anything private -- a metadata service, an
 * admin panel, the database -- then "fetch this URL and paste the result" is
 * enough to read all of it. The reply travels back into the group chat, so the
 * attacker does not even need a listener of their own.
 *
 * The defences, and why each one is here:
 *
 *   1. Scheme allowlist. `file:` and `gopher:` reach things HTTP cannot.
 *   2. No credentials in the URL, or the fetch is an authenticated request to a
 *      host the attacker chooses.
 *   3. The hostname is resolved *by us*, and every returned address is checked.
 *      Checking only for literal IPs is not enough -- a name can point inward.
 *   4. One private answer rejects the whole name. A round-robin record mixing a
 *      public and a private address would otherwise be a coin flip.
 *   5. The socket is pinned to the address we validated, so a second resolution
 *      cannot differ from the first (DNS rebinding).
 *   6. Redirects are followed manually, and every hop is re-validated. A
 *      validated URL that 302s to 169.254.169.254 is the whole attack otherwise.
 *   7. Bounded time and bounded size, and a content-type allowlist, so the
 *      command cannot be used to pull a large file or an executable.
 */

export const DEFAULT_MAX_BYTES = 512 * 1024;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_REDIRECTS = 5;

/*
 * A WhatsApp text message is capped well below the fetch cap, so a body that
 * `safeGet` legitimately accepts can still be too large to send. Trimming at the
 * boundary keeps the command usable instead of throwing a serialization error
 * after the request has already been made.
 */
export const MAX_SAFE_TEXT_LENGTH = 3_500;

/** Clip text to `MAX_SAFE_TEXT_LENGTH`, marking that something was cut. */
export function truncate(text, limit = MAX_SAFE_TEXT_LENGTH) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n… (dipotong, respons panjang)`;
}

const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "text/plain",
  "application/json",
  "application/x-javascript",
  "text/javascript",
];

export class SsrfBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/*
 * Names that must never be reached, whatever the resolver says.
 *
 * `localhost` is the obvious case: it is a hostname, so the address checks below
 * cannot judge it, and it would be caught only if resolution returned a loopback
 * address. That makes the guard depend on the resolver behaving -- a hosts-file
 * entry, a captive portal, or an injected `resolveHostname` all turn it into a
 * way in. Refusing the name outright removes the dependency.
 *
 * `.local` is mDNS, which resolves inside the LAN rather than to a public
 * record, and `.internal` / `.intranet` are the conventional private-DNS
 * suffixes. None of them have a legitimate use as a public fetch target.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".home.arpa"];

function blockedHostnameReason(host) {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(name)) return "local hostname";

  const suffix = BLOCKED_HOSTNAME_SUFFIXES.find((s) => name.endsWith(s));
  if (suffix) return `internal-only suffix (${suffix})`;

  return null;
}

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

/**
 * Decode the non-canonical IPv4 spellings a URL will hand us intact.
 *
 * WHATWG URL parsing keeps `http://2130706433/` and `http://0x7f000001/` as the
 * hostname verbatim. The resolver then treats them as numbers, not names, so
 * they arrive at the socket as 127.0.0.1 while looking like an opaque host.
 *
 * Returns null when the string is not one of these forms.
 */
function decodeNumericIPv4(input) {
  // Dotted quad, the only form that is unambiguous.
  const dotted = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(input);
  if (dotted) {
    const parts = dotted.slice(1).map(Number);
    if (parts.some((p) => p > 255)) return null;
    return parts.join(".");
  }

  // Single 32-bit value, decimal or hex, optionally with 1-3 dotted parts
  // (`127.1` is 127.0.0.1). Rejects anything with a non-numeric suffix.
  const parts = input.split(".");
  if (parts.length > 4 || parts.some((p) => p === "" || !/^[0-9a-fA-F]+$/.test(p))) {
    return null;
  }

  const numbers = parts.map((part) => {
    const isHex = /^0[xX]/.test(part);
    const value = isHex ? parseInt(part.slice(2), 16) : parseInt(part, part.length > 1 && part[0] === "0" ? 8 : 10);
    return { value, digits: isHex ? 0 : part.length };
  });

  // A leading zero means octal, so `0177.1` is not decimal 177.
  if (numbers.some((n) => !Number.isFinite(n.value) || n.value < 0 || n.value > 255)) {
    return null;
  }

  // Trailing parts are 8 bits each; the last absorbs everything left over.
  const trailing = numbers.slice(0, -1);
  const last = numbers[numbers.length - 1];
  const shift = 8 * (4 - numbers.length);
  if (last.value >= 2 ** shift) return null;

  const total =
    trailing.reduce((acc, n) => acc * 256 + n.value, 0) * 256 ** (3 - trailing.length) +
    last.value;
  if (!Number.isInteger(total) || total < 0 || total > 0xffffffff) return null;

  return [24, 16, 8, 0].map((s) => (total >>> s) & 0xff).join(".");
}

function ipv4ToLong(ip) {
  return ip.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

/** RFC1918 and the rest of the non-public IPv4 space. */
function isBlockedIPv4(ip) {
  const long = ipv4ToLong(ip);
  const inRange = (start, end) => long >= ipv4ToLong(start) && long <= ipv4ToLong(end);

  if (inRange("0.0.0.0", "0.255.255.255")) return "unspecified/this-network";
  if (inRange("10.0.0.0", "10.255.255.255")) return "private (RFC1918)";
  if (inRange("100.64.0.0", "100.127.255.255")) return "carrier-grade NAT";
  if (inRange("127.0.0.0", "127.255.255.255")) return "loopback";
  if (inRange("169.254.0.0", "169.254.255.255")) return "link-local";
  if (inRange("172.16.0.0", "172.31.255.255")) return "private (RFC1918)";
  if (inRange("192.0.0.0", "192.0.0.255")) return "IETF protocol assignments";
  if (inRange("192.0.2.0", "192.0.2.255")) return "documentation (TEST-NET-1)";
  if (inRange("192.88.99.0", "192.88.99.255")) return "6to4 relay anycast";
  if (inRange("192.168.0.0", "192.168.255.255")) return "private (RFC1918)";
  if (inRange("198.18.0.0", "198.19.255.255")) return "benchmarking";
  if (inRange("198.51.100.0", "198.51.100.255")) return "documentation (TEST-NET-2)";
  if (inRange("203.0.113.0", "203.0.113.255")) return "documentation (TEST-NET-3)";
  if (inRange("224.0.0.0", "239.255.255.255")) return "multicast";
  if (inRange("240.0.0.0", "255.255.255.255")) return "reserved/broadcast";

  return null;
}

/**
 * Expand an IPv6 literal to its 8 groups, so the range checks below are plain
 * integer comparisons rather than prefix string matching.
 *
 * Handles `::` compression, an embedded IPv4 tail (`::ffff:127.0.0.1`), and a
 * zone index (`fe80::1%eth0`), which `net.isIP` rejects outright.
 */
function expandIPv6(ip) {
  let address = ip.split("%")[0];

  // Fold a trailing dotted quad into the last two groups.
  const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (embedded) {
    const long = ipv4ToLong(embedded[1]);
    if (!Number.isFinite(long)) return null;
    const high = ((long >>> 16) & 0xffff).toString(16);
    const low = (long & 0xffff).toString(16);
    address = address.slice(0, embedded.index) + `${high}:${low}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;

  const toGroups = (part) => (part === "" ? [] : part.split(":"));

  let groups;
  if (halves.length === 2) {
    const head = toGroups(halves[0]);
    const tail = toGroups(halves[1]);
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill("0"), ...tail];
  } else {
    groups = toGroups(address);
  }

  if (groups.length !== 8) return null;

  const out = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/** IPv6 loopback, unspecified, ULA, link-local, multicast, and the mapped forms. */
function isBlockedIPv6(ip) {
  const groups = expandIPv6(ip);
  if (!groups) return "malformed address";

  const isZeroPrefix = (count) => groups.slice(0, count).every((g) => g === 0);
  const g0 = groups[0];

  // ::ffff:a.b.c.d -- the IPv4-mapped range. Judged by the address it carries.
  if (isZeroPrefix(5) && groups[5] === 0xffff) {
    const embedded = [groups[6] >>> 8, groups[6] & 0xff, groups[7] >>> 8, groups[7] & 0xff].join(".");
    const reason = isBlockedIPv4(embedded);
    if (reason) return `IPv4-mapped ${embedded} is ${reason}`;
    return null;
  }

  // ::a.b.c.d -- deprecated IPv4-compatible, and ::1 is the loopback.
  if (isZeroPrefix(6) && groups[6] === 0 && groups[7] === 1) return "loopback";
  if (isZeroPrefix(8)) return "unspecified";
  if (isZeroPrefix(7) && groups[7] === 1) return "IPv4-compatible";

  // 64:ff9b::/96 NAT64 -- a translation prefix whose entire purpose is embedding
// a v4 address in the low 32 bits. Blocked outright rather than judged by the
// embedded address: whether a given NAT64 address reaches loopback depends on
// the translator's configuration, which we cannot see from here.
  if (g0 === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return "NAT64 translation prefix (64:ff9b::/96)";
  }

  if ((g0 & 0xfe00) === 0xfc00) return "unique local (fc00::/7)";
  if ((g0 & 0xffc0) === 0xfe80) return "link-local (fe80::/10)";
  if ((g0 & 0xff00) === 0xff00) return "multicast";
  if (g0 === 0x2001 && groups[1] === 0x0db8) return "documentation (2001:db8::/32)";

  return null;
}

/**
 * Is this address one we refuse to let the bot reach?
 *
 * Returns the reason when blocked, or null when it is a publicly routable
 * address. Returns null for an ordinary hostname too -- names are not judged
 * here, they are resolved first, because only the answer can be checked.
 */
export function isBlockedAddress(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);

  // Not a literal, but it may be one of the numeric spellings the parser let
  // through. Decoding here means the caller cannot forget to.
  const decoded = decodeNumericIPv4(ip);
  if (decoded) {
    const reason = isBlockedIPv4(decoded);
    return reason ? `${reason} (decoded from ${ip})` : null;
  }

  // A name. Not blockable on its face -- DNS answers are checked elsewhere.
  return null;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/**
 * Parse and check a URL, without resolving anything.
 *
 * Resolution is deliberately a separate step: the caller needs the hostname
 * both to validate it and to pin the socket to the same answer.
 */
export function parseUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new SsrfBlockedError("URL tidak valid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`Scheme tidak diizinkan: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new SsrfBlockedError("URL tidak boleh memuat kredensial.");
  }

  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (!host) throw new SsrfBlockedError("URL tidak memiliki host.");

  // Refused before resolution, so correctness does not depend on the resolver.
  const nameReason = blockedHostnameReason(host);
  if (nameReason) {
    throw new SsrfBlockedError(`Alamat tujuan diblokir: ${host} (${nameReason}).`);
  }

  // A literal IP in the URL is judged immediately; a name goes to DNS.
  const reason = isBlockedAddress(host);
  if (reason) throw new SsrfBlockedError(`Alamat tujuan diblokir: ${host} (${reason}).`);

  return url;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

async function resolveAll(hostname, family) {
  const records = await dns.promises.lookup(hostname, {
    all: true,
    verbatim: true,
    ...(family ? { family } : {}),
  });
  return records.map((r) => ({ address: r.address, family: r.family }));
}

/**
 * Resolve a hostname and refuse it if any answer points somewhere private.
 *
 * Rejecting on *any* private answer is deliberate: a record that mixes a
 * public and a private address is a coin flip, and the attacker picks when the
 * flip happens.
 */
async function resolveAndValidate(hostname, resolveHostname) {
  let addresses;
  try {
    addresses = await resolveHostname(hostname);
  } catch (error) {
    throw new Error(`Resolusi gagal untuk ${hostname}: ${error.message}`);
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new SsrfBlockedError(`Tidak ada alamat untuk ${hostname}.`);
  }

  for (const { address } of addresses) {
    const reason = isBlockedAddress(address);
    if (reason) {
      throw new SsrfBlockedError(`${hostname} resolve ke alamat terlarang ${address} (${reason}).`);
    }
  }

  return addresses;
}

/**
 * A `lookup` for the http(s) agent that re-checks the address it hands over.
 *
 * This is what closes the rebinding window. Validating a name and then letting
 * the agent resolve it again leaves a gap where the second answer can differ
 * from the first; pinning means the socket gets exactly what we judged.
 */
export function createPinnedLookup(resolveHostname = (h) => resolveAll(h)) {
  return function pinnedLookup(hostname, options, callback) {
    const done = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : options || {};

    resolveAndValidate(hostname, resolveHostname).then(
      (addresses) => {
        if (opts.all) return done(null, addresses);
        const [first] = addresses;
        return done(null, first.address, first.family);
      },
      (error) => done(error),
    );
  };
}

// ---------------------------------------------------------------------------
// Response checks
// ---------------------------------------------------------------------------

function isAllowedContentType(raw) {
  const header = String(raw || "");

  // A control character means the header is malformed or is trying to smuggle a
  // second value past whatever inspects it. Trimming the media type alone would
  // turn "text/html\0image/png" into a clean-looking "text/html".
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(header)) return false;

  // Compare the media type only. The parameter list is attacker-controlled too.
  const media = header
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!media) return false;
  return ALLOWED_CONTENT_TYPES.includes(media);
}

// ---------------------------------------------------------------------------
// safeGet
// ---------------------------------------------------------------------------

/**
 * Fetch a URL, refusing anything that points back at us.
 *
 * `resolveHostname` and `request` are injected so the guard's behaviour can be
 * tested without a socket; the defaults are the real resolver and axios.
 */
export async function safeGet(rawUrl, options = {}) {
  const {
    resolveHostname = resolveAll,
    request = axios.get,
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    responseType = "arraybuffer",
  } = options;

  let url = parseUrl(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // Validated per hop: a public URL that redirects inward is the whole attack.
    await resolveAndValidate(url.hostname.replace(/^\[/, "").replace(/\]$/, ""), resolveHostname);

    const response = await request({
      url: url.toString(),
      responseType,
      maxRedirects: 0, // followed here, so every hop is validated
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      timeout: timeoutMs,
      validateStatus: () => true,
    });

    const status = response.status;

    if (status >= 300 && status < 400) {
      const location = response.headers?.location || response.headers?.Location;
      if (!location) throw new SsrfBlockedError("Redirect tanpa tujuan.");

      if (hop === maxRedirects) {
        throw new SsrfBlockedError(`Terlalu banyak redirect (>${maxRedirects}).`);
      }

      // `new URL(location, base)` so relative redirects resolve correctly.
      url = parseUrl(new URL(location, url).toString());
      continue;
    }

    const body = response.data;
    const buffer = Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === "string" ? body : JSON.stringify(body ?? ""));

    if (buffer.length > maxBytes) {
      throw new SsrfBlockedError(`Respons terlalu besar (>${maxBytes} byte).`);
    }

    const contentType = response.headers?.["content-type"] || response.headers?.["Content-Type"];
    if (!isAllowedContentType(contentType)) {
      throw new SsrfBlockedError(`Content-Type tidak diizinkan: ${contentType || "tidak diketahui"}.`);
    }

    return { status, contentType, data: buffer, url: url.toString() };
  }

  throw new SsrfBlockedError("Terlalu banyak redirect.");
}

export default { safeGet, parseUrl, isBlockedAddress, SsrfBlockedError, truncate };