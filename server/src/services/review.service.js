const mongoose = require("mongoose");
const Review = require("../models/Review");
const ReviewReport = require("../models/ReviewReport");
const ModerationRecord = require("../models/ModerationRecord");
const ReviewReputation = require("./review-reputation.service");
const Trip = require("../models/Trip");
const TripMember = require("../models/TripMember");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const tripService = require("./trip.service");
const { HttpError } = require("../utils/http");
const moderationService = require("./moderation.service");

const idOf = (value) => value?._id?.toString?.() || value?.toString?.() || "";
const sanitizePlainText = (value = "") => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
const activeMemberQuery = (tripId, userId, completedAt) => ({
  trip: tripId,
  user: userId,
  status: "ACTIVE",
  joinedAt: { $ne: null, $lte: completedAt },
});

const assertEligibleAccount = (user) => {
  if (!user || (user.accountStatus && user.accountStatus !== "ACTIVE")) throw new HttpError(403, "An active account is required", "REVIEW_ACCOUNT_INELIGIBLE");
};

const loadCompletedTrip = async (tripId, session = null) => {
  let query = Trip.findById(tripId).select("_id title status privacy completedAt");
  if (session) query = query.session(session);
  const trip = await query.lean();
  if (!trip || trip.status !== "COMPLETED" || !trip.completedAt) {
    throw new HttpError(409, "Reviews are available only for completed Trips", "REVIEW_TRIP_NOT_COMPLETED");
  }
  return trip;
};

const assertParticipant = async (trip, userId, session = null) => {
  let query = TripMember.exists(activeMemberQuery(trip._id, userId, trip.completedAt));
  if (session) query = query.session(session);
  if (!(await query)) throw new HttpError(404, "Review eligibility was not found", "REVIEW_ELIGIBILITY_NOT_FOUND");
};

const audit = async (req, { action, resourceType, resourceId, metadata = {}, session }) => AuditLog.create([{
  actor: req.user?._id || null,
  action,
  resourceType,
  resourceId,
  metadata,
  ip: req.ip,
  userAgent: req.get("user-agent")?.slice(0, 500) || null,
}], { session });

const toPublicReview = (value, { viewerId = null, showTrip = false, includeStatus = false } = {}) => {
  const author = value.author && typeof value.author === "object" ? value.author : null;
  const reviewee = value.reviewee && typeof value.reviewee === "object" ? value.reviewee : null;
  const trip = value.trip && typeof value.trip === "object" ? value.trip : null;
  return {
    id: idOf(value._id),
    author: author ? { id: idOf(author._id), name: author.name } : { id: idOf(value.author), name: "Traveler" },
    reviewee: reviewee ? { id: idOf(reviewee._id), name: reviewee.name } : { id: idOf(value.reviewee), name: "Traveler" },
    rating: value.rating,
    comment: value.comment,
    verifiedTripReview: true,
    trip: showTrip && trip ? { id: idOf(trip._id), title: trip.title } : null,
    ...(includeStatus ? { status: value.status, isAuthor: idOf(value.author) === viewerId } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const getSummary = async (req, { userId = null, tripId = null }) => {
  if (userId) {
    const user = await User.findOne({ _id: userId, accountStatus: { $in: ["ACTIVE", null] } }).select("_id").lean();
    if (!user) throw new HttpError(404, "Traveler was not found", "USER_NOT_FOUND");
    return ReviewReputation.getRatingSummary(user._id);
  }
  const trip = await loadCompletedTrip(tripId);
  await tripService.getAccessibleTrip(tripId, req.user || null);
  const rows = await Review.aggregate([
    { $match: { trip: trip._id, status: "PUBLISHED" } },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
  ]);
  return ReviewReputation.summarizeRatings(rows);
};

const list = async (req, { userId = null, tripId = null, page, limit }) => {
  let filter;
  let showTrip = false;
  if (userId) {
    if (!(await User.exists({ _id: userId, accountStatus: { $in: ["ACTIVE", null] } }))) throw new HttpError(404, "Traveler was not found", "USER_NOT_FOUND");
    filter = { reviewee: userId, status: "PUBLISHED" };
  } else {
    const trip = await loadCompletedTrip(tripId);
    await tripService.getAccessibleTrip(tripId, req.user || null);
    filter = { trip: trip._id, status: "PUBLISHED" };
    showTrip = trip.privacy === "PUBLIC" || Boolean(req.user);
  }
  const [items, total, summaryRows] = await Promise.all([
    Review.find(filter).populate("author", "name").populate("reviewee", "name").populate("trip", "title privacy")
      .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Review.countDocuments(filter),
    Review.aggregate([
      { $match: filter },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]),
  ]);
  return {
    items: items.map((item) => toPublicReview(item, { viewerId: idOf(req.user?._id), showTrip })),
    summary: ReviewReputation.summarizeRatings(summaryRows),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
};

const eligibility = async (req, tripId) => {
  assertEligibleAccount(req.user);
  const trip = await loadCompletedTrip(tripId);
  await assertParticipant(trip, req.user._id);
  const [members, authored] = await Promise.all([
    TripMember.find({ trip: trip._id, status: "ACTIVE", joinedAt: { $ne: null, $lte: trip.completedAt }, user: { $ne: req.user._id } }).select("user").lean(),
    Review.find({ trip: trip._id, author: req.user._id }).select("reviewee status").lean(),
  ]);
  const reviewed = new Map(authored.map((item) => [idOf(item.reviewee), item.status]));
  const userIds = members.map((item) => item.user);
  const users = await User.find({ _id: { $in: userIds }, accountStatus: { $in: ["ACTIVE", null] } }).select("name").lean();
  return {
    items: users.map((user) => ({ userId: idOf(user._id), name: user.name, reviewed: reviewed.has(idOf(user._id)), reviewStatus: reviewed.get(idOf(user._id)) || null }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.userId.localeCompare(right.userId)),
  };
};

const create = async (req, data) => {
  assertEligibleAccount(req.user);
  if (idOf(req.user._id) === data.revieweeId) throw new HttpError(400, "You cannot review yourself", "SELF_REVIEW_FORBIDDEN");
  const eligibleTrip = await loadCompletedTrip(data.tripId);
  await assertParticipant(eligibleTrip, req.user._id);
  await assertParticipant(eligibleTrip, data.revieweeId);
  const session = await mongoose.startSession();
  let review;
  let moderationRecord = null;
  const moderation = await moderationService.classify(data.comment, { actorId: req.user._id, contentType: "REVIEW" });
  try {
    await session.withTransaction(async () => {
      const trip = await loadCompletedTrip(data.tripId, session);
      await assertParticipant(trip, req.user._id, session);
      await assertParticipant(trip, data.revieweeId, session);
      const reviewee = await User.findOne({ _id: data.revieweeId, accountStatus: { $in: ["ACTIVE", null] } }).select("_id").session(session).lean();
      if (!reviewee) throw new HttpError(404, "Review eligibility was not found", "REVIEW_ELIGIBILITY_NOT_FOUND");
      [review] = await Review.create([{
        author: req.user._id,
        reviewee: reviewee._id,
        trip: trip._id,
        rating: data.rating,
        comment: sanitizePlainText(data.comment),
        status: moderation.recommendedAction === "HOLD" ? "HIDDEN" : "PUBLISHED",
      }], { session });
      if (moderation.recommendedAction !== "ALLOW") moderationRecord = await moderationService.record({ targetType: "REVIEW", targetId: review._id, actor: req.user._id, result: moderation, session });
      await audit(req, { action: "REVIEW_CREATED", resourceType: "Review", resourceId: review._id, metadata: { tripId: idOf(trip._id), revieweeId: idOf(reviewee._id) }, session });
    });
  } catch (error) {
    if (error.code === 11000) throw new HttpError(409, "You have already reviewed this traveler for this Trip", "DUPLICATE_REVIEW");
    throw error;
  } finally { await session.endSession(); }
  await review.populate([{ path: "author", select: "name" }, { path: "reviewee", select: "name" }, { path: "trip", select: "title privacy" }]);
  return { ...toPublicReview(review, { viewerId: idOf(req.user._id), showTrip: review.trip.privacy === "PUBLIC", includeStatus: true }), ...(moderationRecord && review.status === "HIDDEN" ? { appealId: idOf(moderationRecord._id) } : {}) };
};

const get = async (req, reviewId) => {
  const review = await Review.findOne({ _id: reviewId, $or: [{ status: "PUBLISHED" }, { author: req.user?._id }] })
    .populate("author", "name").populate("reviewee", "name").populate("trip", "title privacy").lean();
  if (!review) throw new HttpError(404, "Review was not found", "REVIEW_NOT_FOUND");
  const authorView = idOf(review.author?._id) === idOf(req.user?._id);
  const moderationRecord = authorView && review.status === "HIDDEN" ? await ModerationRecord.findOne({ targetType: "REVIEW", targetId: review._id }).select("_id").lean() : null;
  return { ...toPublicReview(review, { viewerId: idOf(req.user?._id), showTrip: review.trip?.privacy === "PUBLIC" || authorView, includeStatus: authorView }), ...(moderationRecord ? { appealId: idOf(moderationRecord._id) } : {}) };
};

const update = async (req, reviewId, data) => {
  assertEligibleAccount(req.user);
  if (!(await Review.exists({ _id: reviewId, author: req.user._id, status: "PUBLISHED" }))) throw new HttpError(404, "Review was not found", "REVIEW_NOT_FOUND");
  const session = await mongoose.startSession();
  let review;
  let moderationRecord = null;
  const moderation = await moderationService.classify(data.comment, { actorId: req.user._id, contentType: "REVIEW" });
  try {
    await session.withTransaction(async () => {
      review = await Review.findOne({ _id: reviewId, author: req.user._id }).session(session);
      if (!review) throw new HttpError(404, "Review was not found", "REVIEW_NOT_FOUND");
      if (review.status !== "PUBLISHED") throw new HttpError(409, "Only a published review can be edited", "REVIEW_NOT_EDITABLE");
      const previous = { rating: review.rating, comment: review.comment };
      review.editHistory.push({ rating: review.rating, comment: review.comment, changedAt: new Date() });
      if (review.editHistory.length > 20) review.editHistory.shift();
      review.rating = data.rating;
      review.comment = sanitizePlainText(data.comment);
      if (moderation.recommendedAction === "HOLD") review.status = "HIDDEN";
      await review.save({ session });
      if (moderation.recommendedAction !== "ALLOW") moderationRecord = await moderationService.record({ targetType: "REVIEW", targetId: review._id, actor: req.user._id, result: moderation, session });
      await audit(req, { action: "REVIEW_UPDATED", resourceType: "Review", resourceId: review._id, metadata: { previous, current: { rating: review.rating, comment: review.comment }, revisionCount: review.editHistory.length }, session });
    });
  } finally { await session.endSession(); }
  await review.populate([{ path: "author", select: "name" }, { path: "reviewee", select: "name" }, { path: "trip", select: "title privacy" }]);
  return { ...toPublicReview(review, { viewerId: idOf(req.user._id), showTrip: review.trip.privacy === "PUBLIC", includeStatus: true }), ...(moderationRecord && review.status === "HIDDEN" ? { appealId: idOf(moderationRecord._id) } : {}) };
};

const remove = async (req, reviewId) => {
  assertEligibleAccount(req.user);
  const session = await mongoose.startSession();
  let review;
  try {
    await session.withTransaction(async () => {
      review = await Review.findOne({ _id: reviewId, author: req.user._id }).session(session);
      if (!review) throw new HttpError(404, "Review was not found", "REVIEW_NOT_FOUND");
      if (review.status === "REMOVED") return;
      review.status = "REMOVED";
      await review.save({ session });
      await audit(req, { action: "REVIEW_REMOVED", resourceType: "Review", resourceId: review._id, session });
    });
  } finally { await session.endSession(); }
  return { id: idOf(review._id), status: review.status };
};

const report = async (req, reviewId, data) => {
  assertEligibleAccount(req.user);
  const review = await Review.findOne({ _id: reviewId, status: "PUBLISHED" }).select("_id author").lean();
  if (!review) throw new HttpError(404, "Review was not found", "REVIEW_NOT_FOUND");
  if (idOf(review.author) === idOf(req.user._id)) throw new HttpError(400, "You cannot report your own review", "SELF_REPORT_FORBIDDEN");
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      [result] = await ReviewReport.create([{
        review: review._id,
        reporter: req.user._id,
        reason: data.reason,
        details: sanitizePlainText(data.details),
      }], { session });
      await audit(req, { action: "REVIEW_REPORTED", resourceType: "ReviewReport", resourceId: result._id, metadata: { reviewId: idOf(review._id), reason: data.reason }, session });
    });
  } catch (error) {
    if (error.code === 11000) throw new HttpError(409, "You have already reported this review", "DUPLICATE_REVIEW_REPORT");
    throw error;
  } finally { await session.endSession(); }
  return { id: idOf(result._id), status: result.status, createdAt: result.createdAt };
};

const listReports = async ({ page, limit, status }) => {
  const filter = status ? { status } : { status: "OPEN" };
  const [items, total] = await Promise.all([
    ReviewReport.find(filter).populate("reporter", "name").populate({ path: "review", populate: [{ path: "author", select: "name" }, { path: "reviewee", select: "name" }, { path: "trip", select: "title" }] })
      .sort({ createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    ReviewReport.countDocuments(filter),
  ]);
  return {
    items: items.map((item) => ({
      id: idOf(item._id), reporter: item.reporter && { id: idOf(item.reporter._id), name: item.reporter.name },
      reason: item.reason, details: item.details, status: item.status, resolution: item.resolution,
      review: item.review && {
        id: idOf(item.review._id), author: item.review.author && { id: idOf(item.review.author._id), name: item.review.author.name },
        reviewee: item.review.reviewee && { id: idOf(item.review.reviewee._id), name: item.review.reviewee.name },
        trip: item.review.trip && { id: idOf(item.review.trip._id), title: item.review.trip.title },
        rating: item.review.rating, comment: item.review.comment, status: item.review.status,
      },
      createdAt: item.createdAt, resolvedAt: item.resolvedAt,
    })),
    page, limit, total, totalPages: Math.ceil(total / limit),
  };
};

const moderate = async (req, reviewId, { status, reason }) => {
  const session = await mongoose.startSession();
  let review;
  try {
    await session.withTransaction(async () => {
      review = await Review.findById(reviewId).session(session);
      if (!review) throw new HttpError(404, "Review was not found", "REVIEW_NOT_FOUND");
      if (review.status === "REMOVED" && status !== "REMOVED") throw new HttpError(409, "A removed review cannot be republished", "REVIEW_REMOVED");
      const previousStatus = review.status;
      review.status = status;
      review.moderatedBy = req.user._id;
      review.moderatedAt = new Date();
      review.moderationReason = sanitizePlainText(reason);
      await review.save({ session });
      await audit(req, { action: "REVIEW_MODERATED", resourceType: "Review", resourceId: review._id, metadata: { previousStatus, status, reason: review.moderationReason }, session });
    });
  } finally { await session.endSession(); }
  return { id: idOf(review._id), status: review.status, moderatedAt: review.moderatedAt };
};

const resolveReport = async (req, reportId, { status, resolution }) => {
  const session = await mongoose.startSession();
  let report;
  try {
    await session.withTransaction(async () => {
      report = await ReviewReport.findById(reportId).session(session);
      if (!report) throw new HttpError(404, "Review report was not found", "REVIEW_REPORT_NOT_FOUND");
      if (report.status !== "OPEN") throw new HttpError(409, "Review report is already resolved", "REVIEW_REPORT_RESOLVED");
      report.status = status;
      report.resolution = sanitizePlainText(resolution);
      report.assignedTo = req.user._id;
      report.resolvedAt = new Date();
      await report.save({ session });
      await audit(req, { action: "REVIEW_REPORT_RESOLVED", resourceType: "ReviewReport", resourceId: report._id, metadata: { status }, session });
    });
  } finally { await session.endSession(); }
  return { id: idOf(report._id), status: report.status, resolvedAt: report.resolvedAt };
};

module.exports = { list, getSummary, eligibility, create, get, update, remove, report, listReports, moderate, resolveReport };
