const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/tripDiscovery.controller");
const optionalAuth = require("../middleware/optional-auth");
const validate = require("../middleware/validate");
const { asyncHandler } = require("../utils/http");
const { discoveryQuerySchema } = require("../validators/trip-discovery.validator");

const router = express.Router();
const discoveryLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, handler: require("../utils/http").rateLimitHandler });

router.get(
  "/trips",
  discoveryLimiter,
  optionalAuth,
  validate(discoveryQuerySchema, "query"),
  asyncHandler(controller.list),
);

module.exports = router;
