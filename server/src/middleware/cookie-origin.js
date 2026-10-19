const { HttpError } = require("../utils/http");

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

const configuredClientOrigin = () => {
  const configured = process.env.CLIENT_URL || "http://localhost:5173";
  try {
    return new URL(configured).origin;
  } catch {
    return configured;
  }
};

const requireTrustedCookieOrigin = (req, _res, next) => {
  const origin = req.get("origin");
  if (
    req.cookies?.tripbuddy_session &&
    !safeMethods.has(req.method.toUpperCase()) &&
    origin &&
    origin !== configuredClientOrigin()
  ) {
    return next(new HttpError(403, "Request origin is not allowed", "REQUEST_ORIGIN_DENIED"));
  }
  return next();
};

module.exports = requireTrustedCookieOrigin;
