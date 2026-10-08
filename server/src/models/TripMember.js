const mongoose = require("mongoose");

const tripMemberSchema = new mongoose.Schema(
  {
    trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["OWNER", "MEMBER"], required: true },
    status: { type: String, enum: ["PENDING", "ACTIVE", "LEFT", "REMOVED"], required: true },
    joinedAt: { type: Date, default: null },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

tripMemberSchema.index({ trip: 1, user: 1 }, { unique: true });
tripMemberSchema.index({ user: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.TripMember || mongoose.model("TripMember", tripMemberSchema);
