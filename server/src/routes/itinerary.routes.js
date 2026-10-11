const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const controller = require("../controllers/itinerary.controller");
const {
  generateSchema, idParamsSchema, listQuerySchema, updateSchema, dayParamsSchema,
} = require("../validators/itinerary.validator");

const routes = express.Router();
const perUserKey = (req) => req.user._id.toString();
const generationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, keyGenerator: perUserKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
const regenerationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, keyGenerator: perUserKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
routes.use(requireAuth);
routes.post("/generate", generationLimiter, validate(generateSchema), asyncHandler(controller.generate));
routes.get("/", validate(listQuerySchema, "query"), asyncHandler(controller.list));
routes.get("/:itineraryId", validate(idParamsSchema, "params"), asyncHandler(controller.get));
routes.patch("/:itineraryId", validate(idParamsSchema, "params"), validate(updateSchema), asyncHandler(controller.update));
routes.post("/:itineraryId/days/:day/regenerate", regenerationLimiter, validate(dayParamsSchema, "params"), asyncHandler(controller.regenerateDay));
routes.post("/:itineraryId/days/:day/:section/regenerate", regenerationLimiter, validate(dayParamsSchema, "params"), asyncHandler(controller.regenerateDay));
routes.post("/:itineraryId/duplicate", validate(idParamsSchema, "params"), asyncHandler(controller.duplicate));
routes.post("/:itineraryId/archive", validate(idParamsSchema, "params"), asyncHandler(controller.archive));
routes.delete("/:itineraryId", validate(idParamsSchema, "params"), asyncHandler(controller.remove));

module.exports = routes;
