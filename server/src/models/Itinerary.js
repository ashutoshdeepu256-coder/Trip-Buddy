const mongoose = require("mongoose");

const itinerarySchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", default: null },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  destination: { type: String, required: true, trim: true, maxlength: 160 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  budget: {
    amount: { type: Number, min: 0, default: null },
    currency: { type: String, uppercase: true, trim: true, match: /^[A-Z]{3}$/ },
  },
  preferences: {
    interests: { type: [String], default: [] },
    pace: { type: String, enum: ["RELAXED", "MODERATE", "FAST"], default: "MODERATE" },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  plan: { type: mongoose.Schema.Types.Mixed, required: true },
  source: { type: String, enum: ["GEMINI", "DETERMINISTIC_FALLBACK"], required: true },
  model: { type: String, trim: true, maxlength: 100, default: null },
  archivedAt: { type: Date, default: null },
}, { timestamps: true, minimize: false });

itinerarySchema.index({ owner: 1, archivedAt: 1, updatedAt: -1 });
itinerarySchema.index({ trip: 1, owner: 1 });
itinerarySchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.models.Itinerary || mongoose.model("Itinerary", itinerarySchema);
