const test = require("node:test");
const assert = require("node:assert/strict");
const Review = require("../src/models/Review");
const ReviewReport = require("../src/models/ReviewReport");
const { reviewBodySchema, editBodySchema, reportBodySchema, moderateBodySchema } = require("../src/validators/review.validator");
const { summarizeRatings } = require("../src/services/review-reputation.service");

test("review inputs enforce bounded ratings, plain feedback limits and server-owned identity", () => {
  const valid = { tripId: "507f1f77bcf86cd799439011", revieweeId: "507f1f77bcf86cd799439012", rating: 5, comment: "A considerate travel companion." };
  assert.equal(reviewBodySchema.safeParse(valid).success, true);
  assert.equal(reviewBodySchema.safeParse({ ...valid, rating: 5.5 }).success, false);
  assert.equal(reviewBodySchema.safeParse({ ...valid, rating: 6 }).success, false);
  assert.equal(reviewBodySchema.safeParse({ ...valid, authorId: "507f1f77bcf86cd799439013" }).success, false);
  assert.equal(reviewBodySchema.safeParse({ ...valid, status: "PUBLISHED" }).success, false);
  assert.equal(editBodySchema.safeParse({ rating: 1, comment: "x".repeat(1001) }).success, false);
  assert.equal(reportBodySchema.safeParse({ reason: "SPAM", status: "HIDDEN" }).success, false);
  assert.equal(moderateBodySchema.safeParse({ status: "HIDDEN", reason: "Policy violation" }).success, true);
});

test("review uniqueness covers author, reviewed traveler and Trip; reports deduplicate per reporter", () => {
  assert.ok(Review.schema.indexes().some(([fields, options]) => fields.author === 1 && fields.reviewee === 1 && fields.trip === 1 && options.unique));
  assert.ok(ReviewReport.schema.indexes().some(([fields, options]) => fields.reporter === 1 && fields.review === 1 && options.unique));
  assert.deepEqual(Review.schema.path("status").enumValues, ["PUBLISHED", "HIDDEN", "REMOVED"]);
});

test("rating summary is deterministic, rounded to one decimal and counts only supplied eligible ratings", () => {
  assert.deepEqual(summarizeRatings([{ _id: 5, count: 1 }, { _id: 4, count: 1 }, { _id: 1, count: 4 }, { _id: 7, count: 30 }]), {
    averageRating: 2.2,
    reviewCount: 6,
    ratingDistribution: { 1: 4, 2: 0, 3: 0, 4: 1, 5: 1 },
  });
  assert.deepEqual(summarizeRatings([]), {
    averageRating: null,
    reviewCount: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  });
});
