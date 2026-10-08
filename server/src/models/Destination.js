const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    alt: { type: String, trim: true, maxlength: 240, default: "" },
    credit: { type: String, trim: true, maxlength: 240, default: "" },
  },
  { _id: false },
);

const coordinatesSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: {
      type: [Number],
      validate: {
        validator(value) {
          return (
            value.length === 2 &&
            Number.isFinite(value[0]) &&
            value[0] >= -180 &&
            value[0] <= 180 &&
            Number.isFinite(value[1]) &&
            value[1] >= -90 &&
            value[1] <= 90
          );
        },
        message: "Coordinates must be [longitude, latitude]",
      },
    },
  },
  { _id: false },
);

const destinationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 140,
    },
    country: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100, default: "" },
    city: { type: String, trim: true, maxlength: 100, default: "" },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    images: { type: [imageSchema], default: [] },
    coordinates: { type: coordinatesSchema, default: undefined },
    activities: { type: [String], default: [] },
    categories: {
      type: [String],
      enum: ["ADVENTURE", "BEACH", "CULTURE", "NATURE", "CITY"],
      default: [],
    },
    bestMonths: {
      type: [Number],
      default: [],
      validate: {
        validator: (months) =>
          months.every(
            (month) => Number.isInteger(month) && month >= 1 && month <= 12,
          ),
        message: "Best months must be integers from 1 to 12",
      },
    },
    estimatedBudget: {
      min: { type: Number, min: 0, default: null },
      max: { type: Number, min: 0, default: null },
      currency: {
        type: String,
        uppercase: true,
        trim: true,
        maxlength: 3,
        default: "USD",
      },
      period: { type: String, enum: ["DAY", "TRIP"], default: "DAY" },
    },
    weather: {
      summary: { type: String, trim: true, maxlength: 300, default: "" },
      climate: { type: String, trim: true, maxlength: 120, default: "" },
      averageTemperaturesC: {
        min: { type: Number, default: null },
        max: { type: Number, default: null },
      },
      source: { type: String, trim: true, maxlength: 120, default: "" },
      updatedAt: { type: Date, default: null },
    },
    popularity: {
      score: { type: Number, min: 0, default: 0 },
      trendScore: { type: Number, min: 0, default: 0 },
      updatedAt: { type: Date, default: null },
    },
    communityStatistics: {
      tripsCount: { type: Number, min: 0, default: 0 },
      travelersCount: { type: Number, min: 0, default: 0 },
      buddiesCount: { type: Number, min: 0, default: 0 },
      updatedAt: { type: Date, default: null },
    },
    popularPlaces: {
      type: [
        {
          name: { type: String, required: true, trim: true, maxlength: 120 },
          description: {
            type: String,
            trim: true,
            maxlength: 500,
            default: "",
          },
        },
      ],
      default: [],
    },
    travelInformation: {
      currency: { type: String, trim: true, maxlength: 80, default: "" },
      language: { type: String, trim: true, maxlength: 120, default: "" },
      timeZone: { type: String, trim: true, maxlength: 80, default: "" },
      visa: { type: String, trim: true, maxlength: 1000, default: "" },
      safety: { type: String, trim: true, maxlength: 1000, default: "" },
      transport: { type: String, trim: true, maxlength: 1000, default: "" },
    },
    adventure: { type: Boolean, default: false },
    mapProvider: {
      type: String,
      enum: ["GOOGLE_MAPS", "MAPBOX", "NONE"],
      default: "NONE",
    },
    mapPlaceId: { type: String, trim: true, maxlength: 200, default: "" },
    published: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

destinationSchema.index({ slug: 1 }, { unique: true });
destinationSchema.index({ coordinates: "2dsphere" });
destinationSchema.index({ "popularity.score": -1, name: 1 });
destinationSchema.index({ "popularity.trendScore": -1, name: 1 });
destinationSchema.index({ bestMonths: 1 });
destinationSchema.index({ adventure: 1, "estimatedBudget.min": 1 });
destinationSchema.index({
  name: "text",
  city: "text",
  state: "text",
  country: "text",
  description: "text",
});

module.exports =
  mongoose.models.Destination ||
  mongoose.model("Destination", destinationSchema);
