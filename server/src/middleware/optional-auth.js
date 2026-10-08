const jwt = require("jsonwebtoken");
const User = require("../models/User");

const optionalAuth = async (req, _res, next) => {
  try {
    const token =
      req.cookies?.tripbuddy_session ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null);
    if (!token || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      return next();
    }
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "tripbuddy",
      audience: "tripbuddy-web",
    });
    const user = await User.findById(payload.sub).select("+role +tokenVersion");
    if (user && (payload.v || 0) === (user.tokenVersion || 0)) req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError" || error.name === "NotBeforeError") {
      return next();
    }
    next(error);
  }
};

module.exports = optionalAuth;
