const mongoose = require("mongoose");

const verificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["EMAIL", "PHONE", "IDENTITY"], required: true },
    status: {
      type: String,
      enum: ["PENDING", "VERIFIED", "REJECTED", "EXPIRED", "REVOKED"],
      required: true,
      default: "PENDING",
    },
    provider: { type: String, trim: true, maxlength: 80, default: "manual" },
    referenceId: { type: String, select: false, maxlength: 200, default: null },
    submittedAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewNotes: { type: String, select: false, maxlength: 2000, default: "" },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      select: false,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

verificationSchema.index({ user: 1, type: 1, createdAt: -1 });
verificationSchema.index({ status: 1, createdAt: -1 });
verificationSchema.index(
  { user: 1, type: 1 },
  { unique: true, partialFilterExpression: { status: "PENDING" } },
);

module.exports =
  mongoose.models.Verification ||
  mongoose.model("Verification", verificationSchema);
