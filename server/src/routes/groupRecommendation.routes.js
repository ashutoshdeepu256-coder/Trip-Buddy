const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/groupRecommendation.controller");
const { requireAuth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const { tripIdParamSchema } = require("../validators/trip.validator");
const { recommendationIdParamsSchema } = require("../validators/group-recommendation.validator");

const routes = express.Router();
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

routes.post(
  "/trips/:tripId/group-recommendations/generate",
  requireAuth,
  generateLimiter,
  validate(tripIdParamSchema, "params"),
  asyncHandler(controller.generate),
);
routes.get(
  "/trips/:tripId/group-recommendations",
  requireAuth,
  validate(tripIdParamSchema, "params"),
  asyncHandler(controller.listForTrip),
);
routes.get(
  "/group-recommendations/:recommendationId",
  requireAuth,
  validate(recommendationIdParamsSchema, "params"),
  asyncHandler(controller.detail),
);
routes.post(
  "/group-recommendations/:recommendationId/accept",
  requireAuth,
  validate(recommendationIdParamsSchema, "params"),
  asyncHandler(controller.accept),
);
routes.post(
  "/group-recommendations/:recommendationId/reject",
  requireAuth,
  validate(recommendationIdParamsSchema, "params"),
  asyncHandler(controller.reject),
);

module.exports = routes;
