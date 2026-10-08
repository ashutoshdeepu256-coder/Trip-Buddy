const express = require("express");
const multer = require("multer");
const controller = require("../controllers/trip.controller");
const requireAuth = require("../middleware/auth").requireAuth;
const optionalAuth = require("../middleware/optional-auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const rateLimit = require("express-rate-limit");
const {
  createTripSchema,
  updateTripSchema,
  statusChangeSchema,
  listMyTripsQuerySchema,
  tripIdParamSchema,
} = require("../validators/trip.validator");
const { MAX_FILE_SIZE, contentTypes } = require("../services/trip-image.service");

const routes = express.Router();
const trips = express.Router();
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 8 },
  fileFilter(_req, file, callback) {
    if (!contentTypes.has(file.mimetype)) {
      const error = new Error("Only JPEG, PNG, or WEBP images are accepted");
      error.statusCode = 400;
      error.code = "INVALID_TRIP_IMAGE";
      return callback(error);
    }
    callback(null, true);
  },
});

routes.get(
  "/users/me/trips",
  requireAuth,
  validate(listMyTripsQuerySchema, "query"),
  asyncHandler(controller.mine),
);

trips.post("/", requireAuth, createLimiter, validate(createTripSchema), asyncHandler(controller.create));
trips.get("/:tripId", optionalAuth, validate(tripIdParamSchema, "params"), asyncHandler(controller.get));
trips.patch("/:tripId", requireAuth, validate(tripIdParamSchema, "params"), validate(updateTripSchema), asyncHandler(controller.update));
trips.delete("/:tripId", requireAuth, validate(tripIdParamSchema, "params"), asyncHandler(controller.remove));
trips.post("/:tripId/publish", requireAuth, validate(tripIdParamSchema, "params"), asyncHandler(controller.publish));
trips.post("/:tripId/cancel", requireAuth, validate(tripIdParamSchema, "params"), asyncHandler(controller.cancel));
trips.post(
  "/:tripId/status",
  requireAuth,
  validate(tripIdParamSchema, "params"),
  validate(statusChangeSchema),
  asyncHandler(controller.changeStatus),
);
trips.post(
  "/:tripId/images",
  requireAuth,
  validate(tripIdParamSchema, "params"),
  imageUpload.array("images", 8),
  asyncHandler(controller.uploadImages),
);
trips.delete(
  "/:tripId/images/:imageIndex",
  requireAuth,
  validate(tripIdParamSchema, "params"),
  (req, _res, next) => {
    if (!/^\d+$/.test(req.params.imageIndex)) {
      return next(new (require("../utils/http").HttpError)(400, "Invalid image index", "INVALID_TRIP_IMAGE"));
    }
    next();
  },
  asyncHandler(controller.removeImage),
);

routes.use("/trips", trips);

module.exports = routes;
