const mongoose = require("mongoose");
const Block = require("../models/Block");
const Report = require("../models/Report");
const User = require("../models/User");
const Trip = require("../models/Trip");
const Message = require("../models/Message");
const Review = require("../models/Review");
const chatService = require("./chat.service");
const { HttpError } = require("../utils/http");
const { recordAudit } = require("./audit.service");
const notificationService = require("./notification.service");

const blockUser = async (actor, targetId, req) => {
  if (!mongoose.isValidObjectId(targetId)) {
    throw new HttpError(400, "Invalid user ID", "INVALID_USER_ID");
  }
  const blockedId = new mongoose.Types.ObjectId(targetId);
  if (new mongoose.Types.ObjectId(actor._id).equals(blockedId)) {
    throw new HttpError(400, "You cannot block yourself", "SELF_BLOCK_FORBIDDEN");
  }
  if (!(await User.exists({ _id: blockedId }))) {
    throw new HttpError(404, "User was not found", "USER_NOT_FOUND");
  }
  let result;
  try {
    result = await Block.updateOne(
      { blocker: actor._id, blocked: blockedId },
      { $setOnInsert: { blocker: actor._id, blocked: blockedId } },
      { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    result = { upsertedCount: 0 };
  }
  if (result.upsertedCount) {
    await recordAudit(req, {
      action: "USER_BLOCKED",
      resourceType: "User",
      resourceId: blockedId,
    });
  }
  return { blocked: true };
};

const unblockUser = async (actor, targetId, req) => {
  if (!mongoose.isValidObjectId(targetId)) {
    throw new HttpError(400, "Invalid user ID", "INVALID_USER_ID");
  }
  const result = await Block.deleteOne({
    blocker: actor._id,
    blocked: new mongoose.Types.ObjectId(targetId),
  });
  if (result.deletedCount) {
    await recordAudit(req, {
      action: "USER_UNBLOCKED",
      resourceType: "User",
      resourceId: targetId,
    });
  }
  return { blocked: false };
};

const getBlockedUsers = async (actor) => {
  const blocks = await Block.find({ blocker: actor._id })
    .populate("blocked", "name profile.city profile.country")
    .sort({ createdAt: -1 })
    .lean();
  return blocks
    .filter((block) => block.blocked)
    .map((block) => ({
      id: block.blocked._id.toString(),
      name: block.blocked.name,
      location: [block.blocked.profile?.city, block.blocked.profile?.country]
        .filter(Boolean)
        .join(", "),
      blockedAt: block.createdAt,
    }));
};

const isInteractionBlocked = async (firstUserId, secondUserId) =>
  Boolean(
    await Block.exists({
      $or: [
        { blocker: firstUserId, blocked: secondUserId },
        { blocker: secondUserId, blocked: firstUserId },
      ],
    }),
  );

const getInteractionBlockedIds = async (userId, counterpartIds) => {
  if (!counterpartIds.length) return [];
  const blocks = await Block.find({
    $or: [
      { blocker: userId, blocked: { $in: counterpartIds } },
      { blocked: userId, blocker: { $in: counterpartIds } },
    ],
  }).select("blocker blocked").lean();
  return blocks.map((block) =>
    block.blocker.toString() === userId.toString() ? block.blocked.toString() : block.blocker.toString(),
  );
};

const createReport = async (actor, values, req) => {
  const targetType = values.targetType || "TRAVELLER";
  let reportedUserId = null;
  let tripId = values.tripId || null;
  let messageId = values.messageId || null;
  let reviewId = null;
  let targetId = values.targetId || null;
  if (targetType === "TRAVELLER") {
    targetId = values.reportedUserId;
    if (!mongoose.isValidObjectId(targetId)) throw new HttpError(400, "Invalid user ID", "INVALID_USER_ID");
    reportedUserId = new mongoose.Types.ObjectId(targetId);
  } else if (targetType === "TRIP") {
    targetId ||= tripId;
    const trip = await Trip.findById(targetId).select("_id creator").lean();
    if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
    reportedUserId = trip.creator;
    tripId = trip._id;
  } else if (targetType === "MESSAGE") {
    targetId ||= messageId;
    const message = await Message.findById(targetId).select("_id sender conversation").lean();
    if (!message) throw new HttpError(404, "Message was not found", "MESSAGE_NOT_FOUND");
    await chatService.requireConversation(message.conversation, actor._id);
    reportedUserId = message.sender;
    messageId = message._id;
  } else if (targetType === "REVIEW") {
    reviewId = targetId;
    const review = await Review.findOne({ _id: reviewId, status: "PUBLISHED" }).select("_id author").lean();
    if (!review) throw new HttpError(404, "Review was not found", "REVIEW_NOT_FOUND");
    reportedUserId = review.author;
  }
  if (reportedUserId && new mongoose.Types.ObjectId(actor._id).equals(reportedUserId)) {
    throw new HttpError(400, "You cannot report yourself", "SELF_REPORT_FORBIDDEN");
  }
  if (reportedUserId && !(await User.exists({ _id: reportedUserId }))) throw new HttpError(404, "User was not found", "USER_NOT_FOUND");
  const targetKey = targetId || new mongoose.Types.ObjectId().toString();
  const activeReportKey = `${actor._id.toString()}:${targetType}:${targetKey}`;
  const activeStatuses = { $in: ["SUBMITTED", "OPEN", "UNDER_REVIEW"] };
  const duplicateFilter = { reporter: actor._id, status: activeStatuses };
  duplicateFilter.$or = reportedUserId
    ? [{ activeReportKey }, { reportedUser: reportedUserId }]
    : [{ activeReportKey }];
  const existing = await Report.exists(duplicateFilter);
  if (existing) {
    throw new HttpError(409, "You already have an open report for this user", "DUPLICATE_REPORT");
  }
  let report;
  try {
    report = await Report.create({
      reporter: actor._id,
      reportedUser: reportedUserId,
      targetType,
      reason: values.reason,
      description: values.description,
      trip: tripId,
      message: messageId,
      review: reviewId,
      activeReportKey,
      history: [{ status: "SUBMITTED", actor: actor._id, at: new Date() }],
    });
  } catch (error) {
    if (error.code === 11000) {
      throw new HttpError(409, "You already have an open report for this user", "DUPLICATE_REPORT");
    }
    throw error;
  }
  await recordAudit(req, {
    action: "USER_REPORTED",
    resourceType: "Report",
    resourceId: report._id,
    metadata: { targetType, reason: report.reason },
  });
  return { id: report._id.toString(), status: report.status, createdAt: report.createdAt };
};

const listMyReports = async (actor, { page, limit }) => {
  const query = { reporter: actor._id };
  const [items, total] = await Promise.all([
    Report.find(query).select("targetType reason status createdAt updatedAt resolvedAt").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Report.countDocuments(query),
  ]);
  return { items: items.map((item) => ({ id: item._id.toString(), targetType: item.targetType, reason: item.reason, status: item.status === "OPEN" ? "SUBMITTED" : item.status, createdAt: item.createdAt, updatedAt: item.updatedAt, resolvedAt: item.resolvedAt })), page, limit, total, totalPages: Math.ceil(total / limit) };
};

const listReports = async ({ status, page, limit }) => {
  const query = status === "OPEN" ? { status: { $in: ["SUBMITTED", "OPEN"] } } : status ? { status } : {};
  const [reports, total] = await Promise.all([Report.find(query)
    .select("+resolution +moderatorNotes")
    .populate("reporter", "name")
    .populate("reportedUser", "name")
    .populate("assignedTo", "name")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean(), Report.countDocuments(query)]);
  return { items: reports.map((report) => ({
    id: report._id.toString(),
    reporter: report.reporter && { id: report.reporter._id.toString(), name: report.reporter.name },
    reportedUser: report.reportedUser && { id: report.reportedUser._id.toString(), name: report.reportedUser.name },
    reason: report.reason,
    description: report.description,
    status: report.status === "OPEN" ? "SUBMITTED" : report.status,
    assignedTo: report.assignedTo?.name || null,
    resolution: report.resolution,
    moderatorNotes: report.moderatorNotes,
    targetType: report.targetType,
    tripId: report.trip?.toString?.() || null,
    messageId: report.message?.toString?.() || null,
    reviewId: report.review?.toString?.() || null,
    history: report.history,
    resolvedAt: report.resolvedAt,
    createdAt: report.createdAt,
  })), page, limit, total, totalPages: Math.ceil(total / limit) };
};

const reviewReport = async ({ reportId, moderator, status, resolution, req }) => {
  if (!mongoose.isValidObjectId(reportId)) {
    throw new HttpError(400, "Invalid report ID", "INVALID_REPORT_ID");
  }
  const report = await Report.findById(reportId);
  if (!report) throw new HttpError(404, "Report was not found", "REPORT_NOT_FOUND");
  if (!["UNDER_REVIEW", "RESOLVED", "DISMISSED"].includes(status)) {
    throw new HttpError(400, "Invalid report status", "INVALID_REPORT_STATUS");
  }
  const previousStatus = report.status;
  const allowed = {
    SUBMITTED: ["UNDER_REVIEW", "DISMISSED"],
    OPEN: ["UNDER_REVIEW", "DISMISSED"],
    UNDER_REVIEW: ["RESOLVED", "DISMISSED"],
  };
  if (!allowed[previousStatus]?.includes(status)) {
    throw new HttpError(409, "This report status transition is not allowed", "INVALID_REPORT_TRANSITION");
  }
  report.status = status;
  report.assignedTo = moderator._id;
  report.moderatorNotes = resolution || "";
  report.resolution = resolution || "";
  report.history.push({ status, actor: moderator._id, note: resolution || "", at: new Date() });
  report.resolvedAt = ["RESOLVED", "DISMISSED"].includes(status) ? new Date() : null;
  if (report.resolvedAt) report.set("activeReportKey", undefined);
  await report.save();
  await recordAudit(req, {
    action: "ADMIN_ACTION",
    resourceType: "Report",
    resourceId: report._id,
    metadata: { previousStatus, status },
  });
  await notificationService.notifySafetyStatus({ report, status, req });
  return { id: report._id.toString(), status: report.status, resolvedAt: report.resolvedAt };
};

module.exports = {
  blockUser,
  unblockUser,
  getBlockedUsers,
  isInteractionBlocked,
  getInteractionBlockedIds,
  createReport,
  listMyReports,
  listReports,
  reviewReport,
};
