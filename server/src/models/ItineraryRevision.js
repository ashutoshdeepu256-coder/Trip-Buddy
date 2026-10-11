const mongoose = require("mongoose");

const itineraryRevisionSchema = new mongoose.Schema({
  itinerary: { type: mongoose.Schema.Types.ObjectId, ref: "Itinerary", required: true, index: true },
  revision: { type: Number, required: true, min: 1 },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  operation: { type: String, required: true, maxlength: 60 },
  resourceType: { type: String, enum: ["ITINERARY", "DAY", "ACTIVITY", "COLLABORATION"], required: true },
  resourceId: { type: String, default: null, maxlength: 80 },
  idempotencyKey: { type: String, default: null, maxlength: 64 },
  createdAt: { type: Date, default: Date.now },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
}, { versionKey: false });

itineraryRevisionSchema.index({ itinerary: 1, revision: -1 }, { unique: true });
itineraryRevisionSchema.index({ itinerary: 1, createdAt: -1 });
itineraryRevisionSchema.index({ itinerary: 1, actor: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });

module.exports = mongoose.models.ItineraryRevision || mongoose.model("ItineraryRevision", itineraryRevisionSchema);
