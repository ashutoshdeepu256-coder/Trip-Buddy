const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    targetType: { type: String, enum: ["TRAVELLER", "TRIP", "MESSAGE", "REVIEW", "INCIDENT"], default: "TRAVELLER", index: true },
    trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", default: null },
    message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    review: { type: mongoose.Schema.Types.ObjectId, ref: "Review", default: null },
    reason: {
      type: String,
      enum: [
        "SPAM",
        "HARASSMENT",
        "SCAM",
        "FAKE_PROFILE",
        "INAPPROPRIATE_CONTENT",
        "THREATS",
        "DISCRIMINATION",
        "UNSAFE_MEETING",
        "EMERGENCY",
        "SAFETY_CONCERN",
        "OTHER",
      ],
      required: true,
    },
    description: { type: String, trim: true, maxlength: 3000, default: "" },
    evidence: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["SUBMITTED", "OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"],
      default: "SUBMITTED",
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolution: { type: String, select: false, maxlength: 2000, default: "" },
    moderatorNotes: { type: String, select: false, maxlength: 2000, default: "" },
    history: { type: [{ status: String, actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, note: { type: String, maxlength: 2000 }, at: { type: Date, default: Date.now } }], default: [] },
    activeReportKey: { type: String, select: false },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

reportSchema.index({ status:  1, createdAt: -1 });
reportSchema.index({ status: 1, targetType: 1, createdAt: -1 });
reportSchema.index({ reportedUser: 1, status: 1 });
reportSchema.index({ reporter: 1, reportedUser: 1, status: 1 });
reportSchema.index({ activeReportKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.Report || mongoose.model("Report", reportSchema);
