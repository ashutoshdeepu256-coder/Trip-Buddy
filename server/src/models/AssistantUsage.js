const mongoose = require("mongoose");

const assistantUsageSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  requests: { type: Number, default: 0, min: 0 },
  inputCharacters: { type: Number, default: 0, min: 0 },
  outputCharacters: { type: Number, default: 0, min: 0 },
  providerRequests: { type: Number, default: 0, min: 0 },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 400 * 24 * 60 * 60 * 1000) },
}, { timestamps: true });

assistantUsageSchema.index({ owner: 1, day: 1 }, { unique: true });
assistantUsageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.AssistantUsage || mongoose.model("AssistantUsage", assistantUsageSchema);
