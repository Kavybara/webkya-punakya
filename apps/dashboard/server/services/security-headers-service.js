const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https:",
  "media-src 'self' blob: https:",
  "worker-src 'self' blob:",
].join("; ");

export function securityHeaders(options = {}) {
  const isSecureRequest = typeof options.isSecureRequest === "function"
    ? options.isSecureRequest
    : (req) => Boolean(req.secure);

  return (req, res, next) => {
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(self)",
    );

    if (isSecureRequest(req)) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }

    next();
  };
}

export { CONTENT_SECURITY_POLICY };
