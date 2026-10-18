const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const controller = require("../controllers/analytics.controller");
const { query } = require("../validators/analytics.validator");

const router = express.Router();
const analyticsLimiter = rateLimit({ windowMs: 60_000, limit: 10, keyGenerator: (req) => req.user._id.toString(), standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
router.use(requireAuth, requireAdmin);
router.get("/", analyticsLimiter, validate(query, "query"), asyncHandler(controller.getAdminAnalytics));

module.exports = router;
