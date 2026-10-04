const mongoose = require("mongoose");
const User = require("../models/User");

const getTrustSignals = async (user) => {
  const emailVerified = user.verification?.email?.status === "VERIFIED";
  const phoneVerified = user.verification?.phone?.status === "VERIFIED";
  const identityVerified = user.verification?.identity?.status === "VERIFIED";
  let tripsCompleted = 0;
  let reviewsReceived = 0;
  let averageRating = null;

  const Trip = mongoose.models.Trip;
  const Review = mongoose.models.Review;
  if (Trip) {
    tripsCompleted = await Trip.countDocuments({
      status: "COMPLETED",
      $or: [{ participants: user._id }, { members: user._id }, { createdBy: user._id }],
    });
  }
  if (Review) {
    const reviews = await Review.aggregate([
      { $match: { reviewee: user._id, status: { $in: ["PUBLISHED", "APPROVED"] } } },
      { $group: { _id: null, count: { $sum: 1 }, average: { $avg: "$rating" } } },
    ]);
    reviewsReceived = reviews[0]?.count || 0;
    averageRating =
      typeof reviews[0]?.average === "number"
        ? Math.round(reviews[0].average * 10) / 10
        : null;
  }
  return {
    emailVerified,
    phoneVerified,
    identityVerified,
    tripsCompleted,
    reviewsReceived,
    averageRating,
  };
};

const getPublicProfile = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return null;
  return {
    id: user._id.toString(),
    name: user.name,
    profile: user.profile,
    trust: await getTrustSignals(user),
    createdAt: user.createdAt,
  };
};

module.exports = { getTrustSignals, getPublicProfile };
