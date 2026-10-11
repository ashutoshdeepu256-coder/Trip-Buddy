const mongoose = require("mongoose");

const proposedUserSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    score: { type: Number, min: 0, max: 100, required: true },
    scoreBreakdown: { type: mongoose.Schema.Types.Mixed, required: true },
    dimensionStatus: { type: mongoose.Schema.Types.Mixed, required: true },
    reasons: { type: [String], default: [] },
    status: { type: String, enum: ["PENDING", "ACCEPTED", "REJECTED"], default: "PENDING", required: true },
    respondedAt: { type: Date, default: null },
  },
  { _id: false },
);

const groupRecommendationSchema = new mongoose.Schema(
  {
    trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true },
    proposedUsers: { type: [proposedUserSchema], required: true, validate: (users) => users.length > 0 },
    score: { type: Number, min: 0, max: 100, required: true },
    currentMembers: { type: Number, min: 0, required: true },
    scoreBreakdown: { type: mongoose.Schema.Types.Mixed, required: true },
    reasons: { type: [String], default: [] },
    constraintsSatisfied: { type: [String], default: [] },
    unknownConstraints: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["PROPOSED", "VIEWED", "ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"],
      default: "PROPOSED",
      required: true,
    },
    algorithmVersion: { type: String, required: true, maxlength: 40 },
    generationKey: { type: String, required: true, maxlength: 64 },
    activeKey: { type: mongoose.Schema.Types.ObjectId, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

groupRecommendationSchema.index(
  { activeKey: 1 },
  { unique: true, partialFilterExpression: { activeKey: { $type: "objectId" } } },
);
groupRecommendationSchema.index({ trip: 1, generationKey: 1 }, { unique: true });
groupRecommendationSchema.index({ "proposedUsers.user": 1, status: 1, createdAt: -1 });
groupRecommendationSchema.index({ trip: 1, status: 1, expiresAt: 1 });

module.exports = mongoose.models.GroupRecommendation || mongoose.model("GroupRecommendation", groupRecommendationSchema);
