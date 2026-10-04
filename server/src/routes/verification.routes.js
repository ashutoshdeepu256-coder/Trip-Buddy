const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/verification.controller");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const { sendOtpSchema, verifyOtpSchema } = require("../validators/verification");

const router = express.Router();
const limiter = (limit, windowMs = 15 * 60 * 1000) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
const phoneSendLimiter = limiter(5, 60 * 60 * 1000);
const phoneVerifyLimiter = limiter(10);
const identityLimiter = limiter(3, 60 * 60 * 1000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.mimetype)) {
      const error = new Error("Only PDF, PNG, or JPEG files are accepted");
      error.statusCode = 400;
      error.code = "INVALID_DOCUMENT_TYPE";
      return callback(error);
    }
    callback(null, true);
  },
});

router.use(requireAuth);
router.get("/me", asyncHandler(controller.status));
router.get("/history", asyncHandler(controller.history));
router.post(
  "/phone/send-otp",
  phoneSendLimiter,
  validate(sendOtpSchema),
  asyncHandler(controller.sendPhoneOTP),
);
router.post(
  "/phone/verify-otp",
  phoneVerifyLimiter,
  validate(verifyOtpSchema),
  asyncHandler(controller.verifyPhoneOTP),
);
router.post("/identity", identityLimiter, asyncHandler(controller.submitIdentity));
router.get("/identity/status", asyncHandler(controller.identityStatus));
router.post("/identity/document", identityLimiter, upload.single("document"), asyncHandler(controller.uploadIdentity));

module.exports = router;
