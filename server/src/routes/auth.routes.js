const express = require("express");
const rateLimit = require("express-rate-limit");
const authController = require("../controllers/auth.controller");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
} = require("../validators/auth");

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const emailResendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const emailVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

router.post("/register", authLimiter, validate(registerSchema), asyncHandler(authController.register));
router.post("/login", authLimiter, validate(loginSchema), asyncHandler(authController.login));
router.post("/logout", requireAuth, authController.logout);
router.get("/me", requireAuth, authController.currentUser);
router.post(
  "/resend-verification-email",
  requireAuth,
  emailResendLimiter,
  asyncHandler(authController.resendEmailVerification),
);
router.post(
  "/verify-email",
  emailVerifyLimiter,
  validate(verifyEmailSchema),
  asyncHandler(authController.verifyEmail),
);

module.exports = router;
