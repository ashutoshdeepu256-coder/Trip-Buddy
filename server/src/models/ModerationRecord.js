const mongoose = require("mongoose");

const moderationRecordSchema = new mongoose.Schema({
  targetType: { type: String, enum: ["MESSAGE", "REVIEW", "PROFILE", "TRIP", "REPORT", "ASSISTANT_INPUT", "ASSISTANT_OUTPUT"], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  categories: { type: [String], default: [] },
  confidence: { type: Number, min: 0, max: 1, default: 0 },
  severity: { type: String, enum: ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"], default: "NONE" },
  reasonCodes: { type: [String], default: [] },
  ruleVersion: { type: String, required: true },
  provider: { type: String, enum: ["RULES", "GEMINI", "UNAVAILABLE"], default: "RULES" },
  recommendedAction: { type: String, enum: ["ALLOW", "FLAG", "HOLD", "RESTRICT"], required: true },
  finalAction: { type: String, enum: ["ALLOW", "FLAG", "HOLD", "HIDE", "ESCALATE", "RESTORE"], default: "FLAG" },
  reviewStatus: { type: String, enum: ["NOT_REQUIRED", "OPEN", "IN_REVIEW", "APPROVED", "ACTIONED", "DISMISSED", "ESCALATED"], default: "OPEN" },
  moderator: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  moderatorReason: { type: String, maxlength: 500, default: "", select: false },
  reviewedAt: { type: Date, default: null },
  appealedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  appealedAt: { type: Date, default: null },
  appealReason: { type: String, maxlength: 500, default: "", select: false },
}, { timestamps: true });

moderationRecordSchema.index({ targetType: 1, targetId: 1 }, { unique: true });
moderationRecordSchema.index({ reviewStatus: 1, severity: -1, createdAt: 1 });
moderationRecordSchema.index({ targetType: 1, createdAt: -1 });

module.exports = mongoose.models.ModerationRecord || mongoose.model("ModerationRecord", moderationRecordSchema);
