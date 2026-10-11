const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/destination.controller");
const validate = require("../middleware/validate");
const { asyncHandler } = require("../utils/http");
const {
  listingQuerySchema,
  nearbyQuerySchema,
} = require("../validators/destination");

const router = express.Router();
const nearbyLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, handler: require("../utils/http").rateLimitHandler });

router.get(
  "/",
  validate(listingQuerySchema, "query"),
  asyncHandler(controller.list),
);
router.get(
  "/popular",
  validate(listingQuerySchema, "query"),
  asyncHandler(controller.popular),
);
router.get(
  "/trending",
  validate(listingQuerySchema, "query"),
  asyncHandler(controller.trending),
);
router.get(
  "/nearby",
  nearbyLimiter,
  validate(nearbyQuerySchema, "query"),
  asyncHandler(controller.nearby),
);
router.get(
  "/seasonal",
  validate(listingQuerySchema, "query"),
  asyncHandler(controller.seasonal),
);
router.get(
  "/budget",
  validate(listingQuerySchema, "query"),
  asyncHandler(controller.budget),
);
router.get(
  "/adventure",
  validate(listingQuerySchema, "query"),
  asyncHandler(controller.adventure),
);
router.get("/:id", asyncHandler(controller.detail));

module.exports = router;
