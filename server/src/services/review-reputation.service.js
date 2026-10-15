const mongoose = require("mongoose");
const Review = require("../models/Review");

const summarizeRatings = (rows = []) => {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) {
    const rating = Number(row._id ?? row.rating);
    const count = Number(row.count ?? 1);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5 && Number.isSafeInteger(count) && count > 0) {
      distribution[rating] += count;
    }
  }
  const reviewCount = Object.values(distribution).reduce((sum, count) => sum + count, 0);
  const ratingSum = Object.entries(distribution).reduce((sum, [rating, count]) => sum + Number(rating) * count, 0);
  return {
    averageRating: reviewCount ? Math.round((ratingSum * 10) / reviewCount) / 10 : null,
    reviewCount,
    ratingDistribution: distribution,
  };
};

const getRatingSummary = async (revieweeId) => {
  const rows = await Review.aggregate([
    { $match: { reviewee: new mongoose.Types.ObjectId(revieweeId), status: "PUBLISHED" } },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
  ]);
  return summarizeRatings(rows);
};

module.exports = { summarizeRatings, getRatingSummary };
