const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/review.controller");
const { requireAuth } = require("../middleware/auth");
const optionalAuth = require("../middleware/optional-auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const {
  pageQuerySchema, reviewParamsSchema, userParamsSchema, tripParamsSchema,
  reviewBodySchema, editBodySchema, reportBodySchema,
} = require("../validators/review.validator");

const router = express.Router();
const userRateKey = (req) => req.user._id.toString();
const createLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, limit: 8, keyGenerator: userRateKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
const reportLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, limit: 5, keyGenerator: userRateKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });

router.get("/travellers/:userId/summary", validate(userParamsSchema, "params"), asyncHandler(controller.summaryTraveller));
router.get("/travellers/:userId", validate(userParamsSchema, "params"), validate(pageQuerySchema, "query"), asyncHandler(controller.listTraveller));
router.get("/trips/:tripId/eligibility", requireAuth, validate(tripParamsSchema, "params"), asyncHandler(controller.eligibility));
router.get("/trips/:tripId/summary", optionalAuth, validate(tripParamsSchema, "params"), asyncHandler(controller.summaryTrip));
router.get("/trips/:tripId", optionalAuth, validate(tripParamsSchema, "params"), validate(pageQuerySchema, "query"), asyncHandler(controller.listTrip));
router.post("/", requireAuth, createLimiter, validate(reviewBodySchema), asyncHandler(controller.create));
router.get("/:reviewId", requireAuth, validate(reviewParamsSchema, "params"), asyncHandler(controller.get));
router.patch("/:reviewId", requireAuth, validate(reviewParamsSchema, "params"), validate(editBodySchema), asyncHandler(controller.update));
router.delete("/:reviewId", requireAuth, validate(reviewParamsSchema, "params"), asyncHandler(controller.remove));
router.post("/:reviewId/reports", requireAuth, reportLimiter, validate(reviewParamsSchema, "params"), validate(reportBodySchema), asyncHandler(controller.report));

module.exports = router;
