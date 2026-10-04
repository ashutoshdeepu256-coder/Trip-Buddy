const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", default: null },
    message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    reason: {
      type: String,
      enum: [
        "SPAM",
        "HARASSMENT",
        "SCAM",
        "FAKE_PROFILE",
        "INAPPROPRIATE_CONTENT",
        "SAFETY_CONCERN",
        "OTHER",
      ],
      required: true,
    },
    description: { type: String, trim: true, maxlength: 3000, default: "" },
    evidence: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"],
      default: "OPEN",
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolution: { type: String, select: false, maxlength: 2000, default: "" },
    activeReportKey: { type: String, select: false },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

reportSchema.index({ status:  1, createdAt: -1 });
reportSchema.index({ reportedUser: 1, status: 1 });
reportSchema.index({ reporter: 1, reportedUser: 1, status: 1 });
reportSchema.index({ activeReportKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.Report || mongoose.model("Report", reportSchema);
