const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/match.controller");
const { requireMatchingAuth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const { tripIdParamSchema } = require("../validators/trip.validator");
const { matchIdParamsSchema, matchesQuerySchema } = require("../validators/match.validator");

const routes = express.Router();
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

routes.get("/matches", requireMatchingAuth, validate(matchesQuerySchema, "query"), asyncHandler(controller.list));
routes.get("/matches/:matchId", requireMatchingAuth, validate(matchIdParamsSchema, "params"), asyncHandler(controller.detail));
routes.get(
  "/trips/:tripId/compatibility",
  requireMatchingAuth,
  validate(tripIdParamSchema, "params"),
  asyncHandler(controller.compatibility),
);
routes.post(
  "/trips/:tripId/matches/refresh",
  requireMatchingAuth,
  refreshLimiter,
  validate(tripIdParamSchema, "params"),
  asyncHandler(controller.refresh),
);

module.exports = routes;
