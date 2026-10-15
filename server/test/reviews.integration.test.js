const test = require("node:test");
const assert = require("node:assert/strict");

const configuredUri = process.env.MONGODB_TEST_URI;
test("completed Trip review eligibility, moderation, reports, privacy and reputation aggregates", {
  skip: !configuredUri ? "Set MONGODB_TEST_URI to an isolated disposable replica-set test database" : false,
}, async (context) => {
  const uri = new URL(configuredUri);
  const sourceDatabase = uri.pathname.replace(/^\//, "").split("/")[0];
  assert.match(sourceDatabase, /test/i, "MONGODB_TEST_URI must name a dedicated test database");
  uri.pathname = `/${sourceDatabase}_phase20_reviews_${process.pid}`;

  const mongoose = require("mongoose");
  await mongoose.connect(uri.toString(), { serverSelectionTimeoutMS: 3000 });
  const User = require("../src/models/User");
  const Trip = require("../src/models/Trip");
  const TripMember = require("../src/models/TripMember");
  const Review = require("../src/models/Review");
  const ReviewReport = require("../src/models/ReviewReport");
  const AuditLog = require("../src/models/AuditLog");
  const reviewService = require("../src/services/review.service");
  const trustService = require("../src/services/trust.service");
  await Promise.all([User, Trip, TripMember, Review, ReviewReport, AuditLog].map((model) => model.init()));

  const owner = await User.create({ name: "Trip Owner", email: "phase20-owner@test.invalid", passwordHash: "integration-placeholder" });
  const author = await User.create({ name: "Reviewer", email: "phase20-author@test.invalid", passwordHash: "integration-placeholder" });
  const reviewee = await User.create({ name: "Travel Partner", email: "phase20-target@test.invalid", passwordHash: "integration-placeholder" });
  const outsider = await User.create({ name: "Outsider", email: "phase20-outsider@test.invalid", passwordHash: "integration-placeholder" });
  const moderator = await User.create({ name: "Moderator", email: "phase20-moderator@test.invalid", passwordHash: "integration-placeholder", role: "MODERATOR" });
  const trip = await Trip.create({ creator: owner._id, title: "Completed test trip", status: "COMPLETED", privacy: "PRIVATE", completedAt: new Date(Date.now() - 60_000) });
  await TripMember.create([owner, author, reviewee].map((user, index) => ({
    trip: trip._id, user: user._id, role: index === 0 ? "OWNER" : "MEMBER", status: "ACTIVE", joinedAt: new Date(Date.now() - 86_400_000),
  })));
  const incompleteTrip = await Trip.create({ creator: owner._id, title: "Not complete", status: "ONGOING" });
  await TripMember.create({ trip: incompleteTrip._id, user: author._id, role: "MEMBER", status: "ACTIVE", joinedAt: new Date() });

  const makeRequest = (user) => ({ user, ip: "127.0.0.1", get: () => "phase20-test" });
  const req = makeRequest(author);
  const reviewInput = { tripId: trip._id.toString(), revieweeId: reviewee._id.toString(), rating: 5, comment: "Helpful and kind." };
  context.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  await context.test("only completed Trip members may review another active participant", async () => {
    const self = await reviewService.create(req, { ...reviewInput, revieweeId: author._id.toString() }).then(() => null, (error) => error);
    assert.equal(self.code, "SELF_REVIEW_FORBIDDEN");
    const incomplete = await reviewService.create(req, { ...reviewInput, tripId: incompleteTrip._id.toString() }).then(() => null, (error) => error);
    assert.equal(incomplete.code, "REVIEW_TRIP_NOT_COMPLETED");
    const unauthorized = await reviewService.eligibility(makeRequest(outsider), trip._id.toString()).then(() => null, (error) => error);
    assert.equal(unauthorized.code, "REVIEW_ELIGIBILITY_NOT_FOUND");
  });

  let review;
  await context.test("concurrent duplicate submissions resolve to one uniquely indexed review", async () => {
    const results = await Promise.allSettled([reviewService.create(req, reviewInput), reviewService.create(req, reviewInput)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "DUPLICATE_REVIEW").length, 1);
    review = await Review.findOne({ author: author._id, reviewee: reviewee._id, trip: trip._id });
    assert.ok(review);
    assert.equal(await Review.countDocuments({ trip: trip._id }), 1);
  });

  await context.test("authors edit with audit history, reports reach moderators, and hidden/removed reviews leave aggregates", async () => {
    await reviewService.update(req, review._id.toString(), { rating: 4, comment: "Updated, still respectful." });
    review = await Review.findById(review._id);
    assert.equal(review.editHistory.length, 1);
    const forbiddenEdit = await reviewService.update(makeRequest(outsider), review._id.toString(), { rating: 1, comment: "Impersonation" }).then(() => null, (error) => error);
    assert.equal(forbiddenEdit.code, "REVIEW_NOT_FOUND");
    const secondReport = await reviewService.report(makeRequest(outsider), review._id.toString(), { reason: "OTHER", details: "Please check context." });
    assert.equal(secondReport.status, "OPEN");
    const duplicateReport = await reviewService.report(makeRequest(outsider), review._id.toString(), { reason: "SPAM", details: "Repeated." }).then(() => null, (error) => error);
    assert.equal(duplicateReport.code, "DUPLICATE_REVIEW_REPORT");
    assert.equal((await reviewService.listReports({ page: 1, limit: 10 })).total, 1);

    await reviewService.moderate({ ...makeRequest(moderator), user: moderator }, review._id.toString(), { status: "HIDDEN", reason: "Needs human review" });
    let summary = await reviewService.getSummary(req, { userId: reviewee._id.toString() });
    assert.equal(summary.reviewCount, 0);
    await reviewService.moderate({ ...makeRequest(moderator), user: moderator }, review._id.toString(), { status: "PUBLISHED", reason: "Reviewed and restored" });
    summary = await reviewService.getSummary(req, { userId: reviewee._id.toString() });
    assert.equal(summary.averageRating, 4);
    assert.equal(summary.reviewCount, 1);

    await reviewService.resolveReport({ ...makeRequest(moderator), user: moderator }, (await ReviewReport.findOne())._id.toString(), { status: "DISMISSED", resolution: "No policy breach found." });
    await reviewService.moderate({ ...makeRequest(moderator), user: moderator }, review._id.toString(), { status: "REMOVED", reason: "Author requested removal" });
    summary = await reviewService.getSummary(req, { userId: reviewee._id.toString() });
    assert.equal(summary.reviewCount, 0);
    assert.ok(await AuditLog.countDocuments({ action: { $in: ["REVIEW_CREATED", "REVIEW_UPDATED", "REVIEW_REPORTED", "REVIEW_MODERATED", "REVIEW_REPORT_RESOLVED"] } }) >= 6);

    const authorOwned = await reviewService.create(req, { tripId: trip._id.toString(), revieweeId: owner._id.toString(), rating: 3, comment: "Will remove this." });
    assert.equal((await reviewService.remove(req, authorOwned.id)).status, "REMOVED");
  });

  await context.test("public profiles expose verified aggregates without private membership data", async () => {
    await reviewService.create(makeRequest(owner), { tripId: trip._id.toString(), revieweeId: reviewee._id.toString(), rating: 2, comment: "Another rating." });
    const profile = await trustService.getPublicProfile(reviewee._id.toString());
    assert.equal(profile.trust.reviewsReceived, 1);
    assert.equal(profile.trust.averageRating, 2);
    assert.equal(profile.trust.tripsCompleted, 1);
    assert.equal(Object.hasOwn(profile, "memberships"), false);
    const publicReviews = await reviewService.list({ user: outsider, validatedQuery: {} }, { userId: reviewee._id, page: 1, limit: 10 });
    assert.equal(publicReviews.items[0].verifiedTripReview, true);
    assert.equal(publicReviews.items[0].trip, null);
    assert.equal(Object.hasOwn(publicReviews.items[0], "moderationReason"), false);
  });
});
