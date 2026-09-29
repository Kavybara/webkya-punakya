/**
 * The public address of this instance, used in links sent to customers over
 * WhatsApp and in links the owner pastes elsewhere.
 *
 * There used to be four copies of this resolution, with three different
 * fallbacks and no agreement on which setting wins. Two of them defaulted to
 * the live production domain, so an instance that had never been configured
 * sent customers links to somebody else's site. The default is the local
 * origin instead: a link that does not resolve is an obvious mistake, a link
 * that resolves to production is a silent one.
 */

/** Trim, and drop the slashes that would otherwise double up when joining. */
function stripSlashes(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function firstConfigured(...values) {
  return values.map((value) => stripSlashes(value)).find(Boolean) || "";
}

/**
 * Sources, most authoritative first: the owner's saved setting, the
 * environment the instance was deployed with, then the legacy `botPublicUrl`
 * that older databases still carry and that settings-routes keeps in sync.
 *
 * @param {object} db database snapshot
 * @param {object} [options]
 * @param {string} [options.fallback] used when nothing is configured at all
 * @returns {string} the base address, without a trailing slash
 */
export function publicWebsiteUrl(db = {}, options = {}) {
  const settings = db.settings || {};
  return firstConfigured(
    settings.publicDomain,
    process.env.PUBLIC_DOMAIN,
    settings.botPublicUrl,
    options.fallback,
  );
}

/**
 * @param {object} db database snapshot
 * @param {string} path site-relative path, with or without leading slashes
 * @param {object} [options] see {@link publicWebsiteUrl}
 */
export function joinPublicUrl(db = {}, path = "", options = {}) {
  const base = publicWebsiteUrl(db, options);
  const suffix = stripSlashes(path);
  // With no base, a bare path would resolve against whatever page the reader
  // happens to be on. Keep it rooted so the link still means "this site".
  if (!base) return suffix ? `/${suffix}` : "/";
  return suffix ? `${base}/${suffix}` : base;
}
