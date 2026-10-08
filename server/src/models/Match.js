const mongoose = require("mongoose");

const scoreBreakdownSchema = new mongoose.Schema(
  {
    destination: { type: Number, min: 0, max: 100, default: null },
    dates: { type: Number, min: 0, max: 100, default: null },
    budget: { type: Number, min: 0, max: 100, default: null },
    interests: { type: Number, min: 0, max: 100, default: null },
    travelStyle: { type: Number, min: 0, max: 100, default: null },
    activities: { type: Number, min: 0, max: 100, default: null },
    groupSize: { type: Number, min: 0, max: 100, default: null },
    otherPreferences: { type: Number, min: 0, max: 100, default: null },
  },
  { _id: false },
);

const matchSchema = new mongoose.Schema(
  {
    trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    score: { type: Number, min: 0, max: 100, required: true },
    category: { type: String, enum: ["EXCELLENT", "GOOD", "MODERATE", "LOW", "POOR"], required: true },
    scoreBasis: { type: String, enum: ["EVALUATED_DIMENSIONS", "NEUTRAL_NO_DATA"], required: true },
    dataCoverage: { type: Number, min: 0, max: 100, required: true },
    scoreBreakdown: { type: scoreBreakdownSchema, required: true },
    dimensionStatus: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    preferenceBreakdown: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    reasons: { type: [String], default: [] },
    matchReasons: { type: [String], default: [] },
    potentialDifferences: { type: [String], default: [] },
    matchedAttributes: { type: [String], default: [] },
    mismatchedAttributes: { type: [String], default: [] },
    evaluatedDimensions: { type: [String], default: [] },
    unknownDimensions: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["CALCULATED", "VIEWED", "CONNECTED", "DISMISSED", "EXPIRED"],
      default: "CALCULATED",
      required: true,
    },
    generatedAt: { type: Date, default: Date.now, required: true },
  },
  { timestamps: true },
);

matchSchema.index({ trip: 1, user: 1 }, { unique: true });
matchSchema.index({ user: 1, score: -1, generatedAt: -1 });
matchSchema.index({ user: 1, generatedAt: -1 });
matchSchema.index({ user: 1, status: 1, generatedAt: -1 });
matchSchema.index({ status: 1, generatedAt: -1 });

module.exports = mongoose.models.Match || mongoose.model("Match", matchSchema);
