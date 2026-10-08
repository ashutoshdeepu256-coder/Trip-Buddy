const express = require("express");
const controller = require("../controllers/tripDiscovery.controller");
const optionalAuth = require("../middleware/optional-auth");
const validate = require("../middleware/validate");
const { asyncHandler } = require("../utils/http");
const { discoveryQuerySchema } = require("../validators/trip-discovery.validator");

const router = express.Router();

router.get(
  "/trips",
  optionalAuth,
  validate(discoveryQuerySchema, "query"),
  asyncHandler(controller.list),
);

module.exports = router;
