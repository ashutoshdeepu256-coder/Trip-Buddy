const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/maps.controller");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const { geocodeQuerySchema, reverseQuerySchema, routeBodySchema, distanceBodySchema } = require("../validators/maps.validator");

const router = express.Router();
const providerLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });

router.get("/capabilities", controller.getCapabilities);
router.get("/geocode", providerLimiter, validate(geocodeQuerySchema, "query"), asyncHandler(controller.geocode));
router.get("/reverse", providerLimiter, validate(reverseQuerySchema, "query"), asyncHandler(controller.reverse));
router.post("/route", providerLimiter, validate(routeBodySchema), asyncHandler(controller.route));
router.post("/distance", validate(distanceBodySchema), controller.distance);

module.exports = router;
