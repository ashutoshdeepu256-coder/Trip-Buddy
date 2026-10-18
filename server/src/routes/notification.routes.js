const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/notification.controller");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const schemas = require("../validators/notification.validator");

const router = express.Router();
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, keyGenerator: (req) => req.user._id.toString(), standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
router.use(requireAuth);
router.get("/", validate(schemas.pagination, "query"), asyncHandler(controller.list));
router.get("/unread-count", asyncHandler(controller.unreadCount));
router.get("/preferences", asyncHandler(controller.preferences));
router.patch("/preferences", writeLimiter, validate(schemas.preferences), asyncHandler(controller.updatePreferences));
router.patch("/read", writeLimiter, asyncHandler(controller.markAllRead));
router.patch("/:notificationId/read", writeLimiter, validate(schemas.notificationParams, "params"), asyncHandler(controller.markRead));
router.delete("/:notificationId", writeLimiter, validate(schemas.notificationParams, "params"), asyncHandler(controller.dismiss));

module.exports = router;
