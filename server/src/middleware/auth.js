const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { HttpError } = require("../utils/http");

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

const createAuthMiddleware = (projection) => async (req, _res, next) => {
  try {
    const token =
      req.cookies?.tripbuddy_session ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null);

    if (!token) throw new HttpError(401, "Authentication is required", "UNAUTHENTICATED");
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error("JWT_SECRET must contain at least 32 characters");
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "tripbuddy",
      audience: "tripbuddy-web",
    });
    const user = await User.findById(payload.sub).select(projection);
    if (!user) throw new HttpError(401, "Session is no longer valid", "UNAUTHENTICATED");
    if (user.accountStatus && user.accountStatus !== "ACTIVE") {
      throw new HttpError(403, "This account is restricted", "ACCOUNT_RESTRICTED");
    }
    if ((payload.v || 0) !== (user.tokenVersion || 0)) {
      throw new HttpError(401, "Session is no longer valid", "UNAUTHENTICATED");
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

const requireAuth = createAuthMiddleware("+role +phoneNumber +tokenVersion");
const requireMatchingAuth = createAuthMiddleware("_id profile.travelPreferences updatedAt +tokenVersion");

const requireModerator = (req, _res, next) => {
  if (!["ADMIN", "MODERATOR"].includes(req.user?.role)) {
    return next(new HttpError(403, "Moderator access is required", "FORBIDDEN"));
  }
  next();
};

const requireAdmin = (req, _res, next) => {
  if (req.user?.role !== "ADMIN") {
    return next(new HttpError(403, "Administrator access is required", "FORBIDDEN"));
  }
  next();
};

module.exports = { requireAuth, requireMatchingAuth, requireModerator, requireAdmin, getCookieOptions };
