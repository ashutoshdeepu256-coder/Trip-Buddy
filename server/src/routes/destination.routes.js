const express = require("express");
const controller = require("../controllers/destination.controller");
const validate = require("../middleware/validate");
const { asyncHandler } = require("../utils/http");
const {
  listingQuerySchema,
  nearbyQuerySchema,
} = require("../validators/destination");

const router = express.Router();

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
