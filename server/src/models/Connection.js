const mongoose = require("mongoose");

const connectionSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", default: null },
  // Sorted participant ids make reverse-direction requests share the same key.
  pairKey: { type: String, required: true, maxlength: 100 },
  tripKey: { type: String, required: true, maxlength: 30 },
  activeKey: { type: String, default: null, maxlength: 140 },
  status: {
    type: String,
    enum: ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED", "UNMATCHED"],
    default: "PENDING",
    required: true,
  },
  respondedAt: { type: Date, default: null },
  unmatchedAt: { type: Date, default: null },
  audit: {
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    unmatchedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
}, { timestamps: true });

connectionSchema.pre("validate", function validateParticipants() {
  if (this.requester && this.recipient && this.requester.equals(this.recipient)) {
    this.invalidate("recipient", "Requester and recipient must differ");
  }
});

connectionSchema.index(
  { activeKey: 1 },
  { unique: true, partialFilterExpression: { activeKey: { $type: "string" } } },
);
connectionSchema.index({ requester: 1, status: 1, createdAt: -1 });
connectionSchema.index({ recipient: 1, status: 1, createdAt: -1 });
connectionSchema.index({ trip: 1, status: 1 });

module.exports = mongoose.models.Connection || mongoose.model("Connection", connectionSchema);
