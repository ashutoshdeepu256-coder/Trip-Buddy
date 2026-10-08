const mongoose = require("mongoose");

const listOfStrings = { type: [String], default: [] };

const tripImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    publicId: { type: String, required: true, trim: true, maxlength: 240 },
    format: { type: String, enum: ["jpg", "png", "webp"], required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const tripSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    destination: { type: mongoose.Schema.Types.ObjectId, ref: "Destination", default: null },
    title: { type: String, trim: true, maxlength: 120, default: "" },
    description: { type: String, trim: true, maxlength: 4000, default: "" },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    budget: {
      min: { type: Number, min: 0, default: null },
      max: { type: Number, min: 0, default: null },
      currency: { type: String, uppercase: true, trim: true, maxlength: 3, default: "USD" },
    },
    groupSize: {
      min: { type: Number, min: 1, default: 1 },
      max: { type: Number, min: 1, default: 1 },
    },
    travelStyle: listOfStrings,
    interests: listOfStrings,
    activities: listOfStrings,
    accommodationPreference: listOfStrings,
    transportPreference: listOfStrings,
    foodPreference: listOfStrings,
    privacy: {
      type: String,
      enum: ["PUBLIC", "COMMUNITY", "PRIVATE", "INVITE_ONLY"],
      default: "PUBLIC",
    },
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "PLANNING", "CONFIRMED", "ONGOING", "COMPLETED", "CANCELLED"],
      default: "DRAFT",
      index: true,
    },
    images: { type: [tripImageSchema], default: [] },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: undefined,
        validate: {
          validator(value) {
            return value === undefined ||
              (value.length === 2 &&
                Number.isFinite(value[0]) &&
                value[0] >= -180 &&
                value[0] <= 180 &&
                Number.isFinite(value[1]) &&
                value[1] >= -90 &&
                value[1] <= 90);
          },
          message: "Trip coordinates must be [longitude, latitude]",
        },
      },
    },
    publishedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

tripSchema.index({ creator: 1, createdAt: -1 });
tripSchema.index({ destination: 1, status: 1, startDate: 1 });
tripSchema.index({ status: 1, privacy: 1, startDate: 1 });
tripSchema.index({ status: 1, startDate: 1, endDate: 1 });
tripSchema.index({ status: 1, "budget.min": 1, "budget.max": 1 });
tripSchema.index({ location: "2dsphere" });

module.exports = mongoose.models.Trip || mongoose.model("Trip", tripSchema);
