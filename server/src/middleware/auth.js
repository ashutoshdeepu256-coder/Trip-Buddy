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

const requireAuth = async (req, _res, next) => {
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
    const user = await User.findById(payload.sub).select("+role +phoneNumber +tokenVersion");
    if (!user) throw new HttpError(401, "Session is no longer valid", "UNAUTHENTICATED");
    if ((payload.v || 0) !== (user.tokenVersion || 0)) {
      throw new HttpError(401, "Session is no longer valid", "UNAUTHENTICATED");
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

const requireModerator = (req, _res, next) => {
  if (!["ADMIN", "MODERATOR"].includes(req.user?.role)) {
    return next(new HttpError(403, "Moderator access is required", "FORBIDDEN"));
  }
  next();
};

module.exports = { requireAuth, requireModerator, getCookieOptions };
