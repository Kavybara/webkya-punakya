/**
 * Client identity for rate limiting and audit logs.
 *
 * The dashboard is served through a Cloudflare tunnel, so `X-Forwarded-For`
 * only describes the real caller when the request genuinely arrived from a
 * proxy we control. Trusting that header unconditionally lets any direct client
 * mint unlimited identities by rotating one header, which resets every limiter
 * keyed on `req.ip` — including the login brute-force guard and the public
 * order-tracking guard. So we trust it only for peers on the allowlist, and
 * fall back to the transport address otherwise.
 */

const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

/**
 * Node reports IPv4 peers as IPv4-mapped IPv6 on dual-stack sockets, so the
 * same client can appear as either form. Collapse them so an allowlist entry
 * and a request address compare equal regardless of socket family.
 */
export function normalizeIpAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  if (!address) return "";
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mapped ? mapped[1] : address;
}

export function isLoopbackAddress(value) {
  return LOOPBACK_ADDRESSES.has(normalizeIpAddress(value));
}

export function parseTrustedProxyIps(value = "") {
  return new Set(
    String(value || "")
      .split(",")
      .map(normalizeIpAddress)
      .filter(Boolean),
  );
}

/**
 * Build the value for `app.set("trust proxy", ...)`.
 *
 * With no `TRUSTED_PROXY_IPS` configured we trust loopback peers only, which is
 * what a Cloudflare tunnel running on this same host looks like. Every other
 * peer is treated as a direct client, so a forged `X-Forwarded-For` sent to an
 * exposed origin port is ignored and cannot rotate the limiter key.
 *
 * Set `TRUSTED_PROXY_IPS` (comma separated) when a proxy sits on another host,
 * and keep the origin port off the public internet when you do.
 */
export function resolveTrustProxy(env = process.env) {
  const configured = parseTrustedProxyIps(env.TRUSTED_PROXY_IPS);
  if (configured.size) {
    return (address) => configured.has(normalizeIpAddress(address));
  }
  return (address) => isLoopbackAddress(address);
}

/**
 * The transport address, which no client can forge. Used as the last-resort
 * key and as the audit value when the request never crossed a proxy.
 */
export function directPeerAddress(request = {}) {
  return normalizeIpAddress(request.socket?.remoteAddress) || "unknown";
}

/**
 * Rate-limiter key. `req.ip` already honours the trust proxy decision, so this
 * is only spoofable if the deployment is configured to trust a peer that is not
 * actually a proxy.
 */
export function clientKey(request = {}) {
  return normalizeIpAddress(request.ip) || directPeerAddress(request);
}
