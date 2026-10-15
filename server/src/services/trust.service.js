const User = require("../models/User");
const Trip = require("../models/Trip");
const TripMember = require("../models/TripMember");
const reviewReputation = require("./review-reputation.service");

const getTrustSignals = async (user) => {
  const emailVerified = user.verification?.email?.status === "VERIFIED";
  const phoneVerified = user.verification?.phone?.status === "VERIFIED";
  const identityVerified = user.verification?.identity?.status === "VERIFIED";
  let tripsCompleted = 0;
  const memberships = await TripMember.find({ user: user._id, status: "ACTIVE", joinedAt: { $ne: null } }).select("trip").lean();
  const completedTrips = await Trip.find({ _id: { $in: memberships.map((item) => item.trip) }, status: "COMPLETED", completedAt: { $ne: null } }).select("_id completedAt").lean();
  const completedAtByTrip = new Map(completedTrips.map((trip) => [trip._id.toString(), trip.completedAt]));
  tripsCompleted = new Set(memberships.filter((membership) => membership.joinedAt <= completedAtByTrip.get(membership.trip.toString())).map((membership) => membership.trip.toString())).size;
  const ratingSummary = await reviewReputation.getRatingSummary(user._id);
  return {
    emailVerified,
    phoneVerified,
    identityVerified,
    tripsCompleted,
    reviewsReceived: ratingSummary.reviewCount,
    averageRating: ratingSummary.averageRating,
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
