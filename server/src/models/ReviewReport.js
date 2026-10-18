const mongoose = require("mongoose");

const reviewReportSchema = new mongoose.Schema({
  review: { type: mongoose.Schema.Types.ObjectId, ref: "Review", required: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reason: { type: String, enum: ["HARASSMENT", "SPAM", "PERSONAL_DATA", "FALSE_CLAIM", "OTHER"], required: true },
  details: { type: String, trim: true, maxlength: 1000, default: "" },
  status: { type: String, enum: ["OPEN", "RESOLVED", "DISMISSED"], default: "OPEN", required: true, index: true },
  resolution: { type: String, trim: true, maxlength: 1000, default: "" },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

reviewReportSchema.index({ reporter: 1, review: 1 }, { unique: true });
reviewReportSchema.index({ status: 1, createdAt: 1 });
reviewReportSchema.index({ createdAt: 1 });

module.exports = mongoose.models.ReviewReport || mongoose.model("ReviewReport", reviewReportSchema);
