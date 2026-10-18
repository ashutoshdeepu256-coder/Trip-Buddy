const mongoose = require("mongoose");
const User = require("../models/User");
const Trip = require("../models/Trip");
const Report = require("../models/Report");
const ReviewReport = require("../models/ReviewReport");
const ModerationRecord = require("../models/ModerationRecord");
const Booking = require("../models/Booking");
const PaymentAttempt = require("../models/PaymentAttempt");
const AuditLog = require("../models/AuditLog");
const AdminOperationGuard = require("../models/AdminOperationGuard");
const { HttpError } = require("../utils/http");
const { recordAudit } = require("./audit.service");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const paged = (items, page, limit, total) => ({ items, page, limit, total, totalPages: Math.ceil(total / limit) });
const keyedCounts = (rows) => Object.fromEntries(rows.map(({ _id, count }) => [_id, count]));

const overview = async () => {
  const tripStatuses = ["DRAFT", "PUBLISHED", "PLANNING", "CONFIRMED", "ONGOING", "COMPLETED", "CANCELLED"];
  const bookingStatuses = ["USER_RECORDED", "EXTERNAL_HANDOFF", "CANCELLED"];
  const paymentStatuses = ["CREATED", "PENDING", "AUTHORIZED", "TRANSFER_PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"];
  const [users, trips, reportCount, reviewReportCount, moderationCounts, bookings, payments] = await Promise.all([
    User.countDocuments({}),
    Trip.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Report.countDocuments({ status: { $in: ["SUBMITTED", "OPEN", "UNDER_REVIEW"] } }),
    ReviewReport.countDocuments({ status: "OPEN" }),
    ModerationRecord.aggregate([{ $match: { reviewStatus: { $in: ["OPEN", "IN_REVIEW", "ESCALATED"] } } }, { $group: { _id: "$reviewStatus", count: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    PaymentAttempt.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);
  const tripCounts = keyedCounts(trips);
  const bookingCounts = keyedCounts(bookings);
  const paymentCounts = keyedCounts(payments);
  const moderationByStatus = keyedCounts(moderationCounts);
  return {
    users: { total: users, recentlyActive: { available: false, value: null, reason: "The platform does not track a reliable last-active timestamp." } },
    trips: Object.fromEntries(tripStatuses.map((status) => [status, tripCounts[status] || 0])),
    safety: { pendingReports: reportCount, openReviewReports: reviewReportCount, moderationQueue: moderationByStatus, pendingModeration: Object.values(moderationByStatus).reduce((sum, value) => sum + value, 0) },
    bookings: Object.fromEntries(bookingStatuses.map((status) => [status, bookingCounts[status] || 0])),
    payments: Object.fromEntries(paymentStatuses.map((status) => [status, paymentCounts[status] || 0])),
    platformHealth: { available: false, reason: "No application observability health source is configured." },
  };
};

const listUsers = async ({ page, limit, search, status, role }) => {
  const filter = {};
  if (status) filter.accountStatus = status;
  if (role) filter.role = role;
  if (search) {
    const pattern = new RegExp(`^${escapeRegex(search)}`, "i");
    filter.$or = [{ name: pattern }, { email: pattern }];
  }
  const [rows, total] = await Promise.all([
    User.find(filter).select("name email role accountStatus profile.city profile.country createdAt updatedAt").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  return paged(rows.map((u) => ({ id: u._id.toString(), name: u.name, email: u.email, role: u.role || "USER", accountStatus: u.accountStatus || "ACTIVE", profile: { city: u.profile?.city || "", country: u.profile?.country || "" }, createdAt: u.createdAt, updatedAt: u.updatedAt })), page, limit, total);
};

const listTrips = async ({ page, limit, search, status }) => {
  const filter = {};
  if (status) filter.status = status;
  if (search) filter.title = new RegExp(`^${escapeRegex(search)}`, "i");
  const [rows, total] = await Promise.all([
    Trip.find(filter).select("title description status privacy moderationVisibility startDate endDate creator destination createdAt updatedAt").populate("creator", "name").populate("destination", "name country").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Trip.countDocuments(filter),
  ]);
  return paged(rows.map((trip) => ({ id: trip._id.toString(), title: trip.title, description: trip.description, status: trip.status, privacy: trip.privacy, moderationVisibility: trip.moderationVisibility, startDate: trip.startDate, endDate: trip.endDate, creator: trip.creator ? { id: trip.creator._id.toString(), name: trip.creator.name } : null, destination: trip.destination, createdAt: trip.createdAt, updatedAt: trip.updatedAt })), page, limit, total);
};

const listAudit = async ({ page, limit, action, resourceType }) => {
  const filter = {};
  if (action) filter.action = action;
  if (resourceType) filter.resourceType = resourceType;
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).select("actor action resourceType resourceId metadata createdAt").populate("actor", "name email").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return paged(rows.map((row) => ({
    id: row._id.toString(), actor: row.actor ? { id: row.actor._id.toString(), name: row.actor.name, email: row.actor.email } : null,
    action: row.action, resourceType: row.resourceType, resourceId: row.resourceId?.toString() || null, createdAt: row.createdAt,
    reason: typeof row.metadata?.reason === "string" ? row.metadata.reason : null,
    before: ["ACTIVE", "SUSPENDED", "BANNED", "USER", "MODERATOR", "ADMIN"].includes(row.metadata?.before) ? row.metadata.before : null,
    after: ["ACTIVE", "SUSPENDED", "BANNED", "USER", "MODERATOR", "ADMIN"].includes(row.metadata?.after) ? row.metadata.after : null,
  })), page, limit, total);
};

const getAdminCount = (session) => User.countDocuments({ role: "ADMIN", accountStatus: "ACTIVE" }).session(session);
const getTarget = async (userId, session) => {
  if (!mongoose.isValidObjectId(userId)) throw new HttpError(400, "Invalid user id", "VALIDATION_ERROR");
  const user = await User.findById(userId).select("name email role accountStatus tokenVersion").session(session);
  if (!user) throw new HttpError(404, "User was not found", "USER_NOT_FOUND");
  return user;
};

const changeUserStatus = async (req, userId, status, reason) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      await AdminOperationGuard.updateOne({ _id: "admin-role-invariant" }, { $inc: { revision: 1 } }, { upsert: true, session });
      const target = await getTarget(userId, session);
      if (target._id.equals(req.user._id)) throw new HttpError(400, "You cannot change your own account status", "SELF_ACTION_NOT_ALLOWED");
      if (target.role === "ADMIN" && target.accountStatus === "ACTIVE" && status !== "ACTIVE" && await getAdminCount(session) <= 1) {
        throw new HttpError(409, "The last active administrator cannot be restricted", "LAST_ACTIVE_ADMIN");
      }
      const before = target.accountStatus;
      if (before === status) throw new HttpError(409, "The account already has this status", "NO_STATUS_CHANGE");
      target.accountStatus = status;
      target.tokenVersion += 1;
      await target.save({ session });
      await recordAudit(req, { action: "ADMIN_USER_STATUS_CHANGED", resourceType: "User", resourceId: target._id, metadata: { before, after: status, reason }, session });
      result = { id: target._id.toString(), accountStatus: status };
    });
    return result;
  } finally { await session.endSession(); }
};

const changeUserRole = async (req, userId, role, reason) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      await AdminOperationGuard.updateOne({ _id: "admin-role-invariant" }, { $inc: { revision: 1 } }, { upsert: true, session });
      const target = await getTarget(userId, session);
      if (target._id.equals(req.user._id)) throw new HttpError(400, "You cannot change your own role", "SELF_ACTION_NOT_ALLOWED");
      const before = target.role || "USER";
      if (before === role) throw new HttpError(409, "The account already has this role", "NO_ROLE_CHANGE");
      if (before === "ADMIN" && target.accountStatus === "ACTIVE" && role !== "ADMIN" && await getAdminCount(session) <= 1) {
        throw new HttpError(409, "The last active administrator cannot be demoted", "LAST_ACTIVE_ADMIN");
      }
      target.role = role;
      target.tokenVersion += 1;
      await target.save({ session });
      await recordAudit(req, { action: "ADMIN_ROLE_CHANGED", resourceType: "User", resourceId: target._id, metadata: { before, after: role, reason }, session });
      result = { id: target._id.toString(), role };
    });
    return result;
  } finally { await session.endSession(); }
};

const listAudits = listAudit;
module.exports = { overview, listUsers, listTrips, listAudits, changeUserStatus, changeUserRole };
