const mongoose = require("mongoose");
const Block = require("../models/Block");
const Report = require("../models/Report");
const User = require("../models/User");
const { HttpError } = require("../utils/http");
const { recordAudit } = require("./audit.service");

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

const createReport = async (actor, values, req) => {
  if (!mongoose.isValidObjectId(values.reportedUserId)) {
    throw new HttpError(400, "Invalid user ID", "INVALID_USER_ID");
  }
  const reportedUserId = new mongoose.Types.ObjectId(values.reportedUserId);
  if (new mongoose.Types.ObjectId(actor._id).equals(reportedUserId)) {
    throw new HttpError(400, "You cannot report yourself", "SELF_REPORT_FORBIDDEN");
  }
  const reportedUser = await User.findById(reportedUserId);
  if (!reportedUser) throw new HttpError(404, "User was not found", "USER_NOT_FOUND");
  const existing = await Report.exists({
    reporter: actor._id,
    reportedUser: reportedUser._id,
    status: { $in: ["OPEN", "UNDER_REVIEW"] },
  });
  if (existing) {
    throw new HttpError(409, "You already have an open report for this user", "DUPLICATE_REPORT");
  }
  let report;
  try {
    report = await Report.create({
      reporter: actor._id,
      reportedUser: reportedUser._id,
      reason: values.reason,
      description: values.description,
      trip: values.tripId || null,
      message: values.messageId || null,
      activeReportKey: `${actor._id.toString()}:${reportedUser._id.toString()}`,
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
    metadata: { reportedUserId: reportedUser._id.toString(), reason: report.reason },
  });
  return { id: report._id.toString(), status: report.status, createdAt: report.createdAt };
};

const listReports = async ({ status, page, limit }) => {
  const query = status ? { status } : {};
  const reports = await Report.find(query)
    .select("+resolution")
    .populate("reporter", "name email")
    .populate("reportedUser", "name email")
    .populate("assignedTo", "name")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  return reports.map((report) => ({
    id: report._id.toString(),
    reporter: report.reporter && { id: report.reporter._id.toString(), name: report.reporter.name, email: report.reporter.email },
    reportedUser: report.reportedUser && { id: report.reportedUser._id.toString(), name: report.reportedUser.name, email: report.reportedUser.email },
    reason: report.reason,
    description: report.description,
    status: report.status,
    assignedTo: report.assignedTo?.name || null,
    resolution: report.resolution,
    resolvedAt: report.resolvedAt,
    createdAt: report.createdAt,
  }));
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
  report.status = status;
  report.assignedTo = moderator._id;
  report.resolution = resolution || "";
  report.resolvedAt = ["RESOLVED", "DISMISSED"].includes(status) ? new Date() : null;
  if (report.resolvedAt) report.set("activeReportKey", undefined);
  await report.save();
  await recordAudit(req, {
    action: "ADMIN_ACTION",
    resourceType: "Report",
    resourceId: report._id,
    metadata: { status },
  });
  return { id: report._id.toString(), status: report.status, resolvedAt: report.resolvedAt };
};

module.exports = {
  blockUser,
  unblockUser,
  getBlockedUsers,
  isInteractionBlocked,
  createReport,
  listReports,
  reviewReport,
};
