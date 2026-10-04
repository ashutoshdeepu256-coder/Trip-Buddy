const mongoose = require("mongoose");

const emailVerificationTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

emailVerificationTokenSchema.index({ user: 1, createdAt: -1 });
emailVerificationTokenSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { consumedAt: null } },
);
emailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.EmailVerificationToken ||
  mongoose.model("EmailVerificationToken", emailVerificationTokenSchema);
