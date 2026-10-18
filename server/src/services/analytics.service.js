const User = require("../models/User");
const Trip = require("../models/Trip");
const TripMember = require("../models/TripMember");
const Connection = require("../models/Connection");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Itinerary = require("../models/Itinerary");
const Booking = require("../models/Booking");
const Expense = require("../models/Expense");
const ExpenseSettlement = require("../models/ExpenseSettlement");
const PaymentAttempt = require("../models/PaymentAttempt");
const Review = require("../models/Review");
const Report = require("../models/Report");
const ReviewReport = require("../models/ReviewReport");
const ModerationRecord = require("../models/ModerationRecord");
const AuditLog = require("../models/AuditLog");
const AssistantMessage = require("../models/AssistantMessage");
const Notification = require("../models/Notification");
const { resolvePeriod, fillSeries, DAY, safeRatio } = require("../utils/analytics-period");
const PROVIDER_VERIFIED_SOURCES = ["API", "WEBHOOK", "RECONCILIATION"];

const dateFormat = (bucket) => bucket === "hour" ? "%Y-%m-%dT%H:00:00.000Z" : "%Y-%m-%dT00:00:00.000Z";
const groupDate = (field, bucket) => ({ $dateToString: { format: dateFormat(bucket), date: `$${field}`, timezone: "UTC" } });
const range = (period) => ({ $gte: period.from, $lt: period.to });
const aggregateCount = async (Model, field, period, filter = {}) => {
  const rows = await Model.aggregate([
    { $match: { ...filter, [field]: range(period) } },
    { $group: { _id: groupDate(field, period.bucket), count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  return fillSeries(period, rows);
};

const aggregatePaymentHistory = async (period, statuses) => {
  const rows = await PaymentAttempt.aggregate([
    { $match: { "history.at": range(period) } },
    { $unwind: "$history" },
    { $match: { "history.at": range(period), "history.status": { $in: statuses }, "history.source": { $in: PROVIDER_VERIFIED_SOURCES } } },
    { $group: { _id: groupDate("history.at", period.bucket), count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  return fillSeries(period, rows);
};

const aggregateBookingHandoffs = async (period) => {
  const rows = await Booking.aggregate([
    { $match: { "statusHistory.changedAt": range(period) } },
    { $unwind: "$statusHistory" },
    { $match: { "statusHistory.status": "EXTERNAL_HANDOFF", "statusHistory.changedAt": range(period) } },
    { $group: { _id: groupDate("statusHistory.changedAt", period.bucket), count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  return fillSeries(period, rows);
};

const aggregateByAuditAction = async (period, action) => aggregateCount(AuditLog, "createdAt", period, { action });

const aggregateGroupedSeries = async (Model, field, groupField, period, filter = {}, expectedValues = []) => {
  const rows = await Model.aggregate([
    { $match: { ...filter, [field]: range(period) } },
    { $group: { _id: { date: groupDate(field, period.bucket), value: `$${groupField}` }, count: { $sum: 1 } } },
  ]);
  const grouped = Object.fromEntries(expectedValues.map((value) => [value, fillSeries(period, [])]));
  for (const row of rows) {
    grouped[row._id.value] ||= fillSeries(period, []);
    const point = grouped[row._id.value].find((item) => item.at === row._id.date);
    if (point) point.count = row.count;
  }
  return grouped;
};

const aggregatePaymentsByStatus = async (period) => {
  const rows = await PaymentAttempt.aggregate([
    { $match: { "history.at": range(period) } },
    { $unwind: "$history" },
    { $match: { "history.at": range(period), "history.source": { $in: PROVIDER_VERIFIED_SOURCES } } },
    { $group: { _id: { date: groupDate("history.at", period.bucket), status: "$history.status" }, count: { $sum: 1 } } },
  ]);
  return rows.reduce((result, row) => {
    const key = row._id.status;
    result[key] ||= fillSeries(period, []);
    const point = result[key].find((item) => item.at === row._id.date);
    if (point) point.count = row.count;
    return result;
  }, Object.fromEntries(["CREATED", "PENDING", "AUTHORIZED", "TRANSFER_PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"].map((status) => [status, fillSeries(period, [])])));
};

const aggregateAssistantReplies = async (period) => {
  const rows = await AssistantMessage.aggregate([
    { $match: { role: "ASSISTANT", createdAt: range(period) } },
    { $group: { _id: { date: groupDate("createdAt", period.bucket), source: "$source" }, count: { $sum: 1 } } },
  ]);
  const output = { GEMINI: fillSeries(period, []), DETERMINISTIC_FALLBACK: fillSeries(period, []) };
  for (const row of rows) {
    const point = output[row._id.source]?.find((item) => item.at === row._id.date);
    if (point) point.count = row.count;
  }
  return output;
};

const total = (series) => series.reduce((sum, point) => sum + point.count, 0);

const getAnalytics = async (query, now = new Date()) => {
  const period = resolvePeriod(query, now);
  const assistantRepliesPromise = aggregateAssistantReplies(period);
  const notificationAvailable = period.from >= new Date(now.getTime() - 180 * DAY);
  const definitions = {
    currentEligibleUsers: User.countDocuments({ accountStatus: "ACTIVE" }),
    usersRegistered: aggregateCount(User, "createdAt", period),
    accountStatusChanges: aggregateByAuditAction(period, "ADMIN_USER_STATUS_CHANGED"),
    tripsCreated: aggregateCount(Trip, "createdAt", period),
    tripsPublished: aggregateCount(Trip, "publishedAt", period, { publishedAt: { $ne: null } }),
    tripsCompleted: aggregateCount(Trip, "completedAt", period, { completedAt: { $ne: null } }),
    tripsCancelled: aggregateCount(Trip, "cancelledAt", period, { cancelledAt: { $ne: null } }),
    membershipsJoined: aggregateCount(TripMember, "joinedAt", period, { joinedAt: { $ne: null } }),
    connectionRequests: aggregateCount(Connection, "createdAt", period),
    connectionAcceptances: aggregateByAuditAction(period, "CONNECTION_ACCEPTED"),
    conversationsCreated: aggregateCount(Conversation, "createdAt", period),
    messagesCreated: aggregateCount(Message, "createdAt", period),
    itinerariesCreated: aggregateCount(Itinerary, "createdAt", period),
    itineraryGenerations: aggregateByAuditAction(period, "ITINERARY_GENERATED"),
    geminiItinerariesCreated: aggregateCount(Itinerary, "createdAt", period, { source: "GEMINI" }),
    fallbackItinerariesCreated: aggregateCount(Itinerary, "createdAt", period, { source: "DETERMINISTIC_FALLBACK" }),
    bookingsCreated: aggregateCount(Booking, "createdAt", period),
    bookingExternalHandoffs: aggregateBookingHandoffs(period),
    expensesCreated: aggregateCount(Expense, "createdAt", period),
    settlementsRecorded: aggregateCount(ExpenseSettlement, "recordedAt", period),
    providerVerifiedSettlements: aggregateCount(ExpenseSettlement, "recordedAt", period, { source: "PROVIDER_VERIFIED" }),
    userReportedSettlements: aggregateCount(ExpenseSettlement, "recordedAt", period, { source: "USER_REPORTED" }),
    paymentAttemptsCreated: aggregateCount(PaymentAttempt, "createdAt", period),
    paymentVerifiedSuccesses: aggregatePaymentHistory(period, ["SUCCEEDED"]),
    paymentVerifiedFailures: aggregatePaymentHistory(period, ["FAILED"]),
    paymentRefundEvents: aggregatePaymentHistory(period, ["REFUNDED", "PARTIALLY_REFUNDED"]),
    paymentStatusEvents: aggregatePaymentsByStatus(period),
    reviewsCreated: aggregateCount(Review, "createdAt", period),
    safetyReportsCreated: aggregateCount(Report, "createdAt", period),
    reviewReportsCreated: aggregateCount(ReviewReport, "createdAt", period),
    reviewReportsResolved: aggregateCount(ReviewReport, "resolvedAt", period, { resolvedAt: { $ne: null } }),
    reviewsModerated: aggregateCount(Review, "moderatedAt", period, { moderatedAt: { $ne: null } }),
    moderationRecordsCreated: aggregateCount(ModerationRecord, "createdAt", period),
    moderationClassifierProviders: aggregateGroupedSeries(ModerationRecord, "createdAt", "provider", period, {}, ["RULES", "GEMINI", "UNAVAILABLE"]),
    moderationDecisions: aggregateCount(ModerationRecord, "reviewedAt", period, { reviewedAt: { $ne: null } }),
    assistantReplySources: assistantRepliesPromise,
    notificationsPersisted: notificationAvailable ? aggregateCount(Notification, "createdAt", period) : Promise.resolve(null),
  };
  const keys = Object.keys(definitions);
  const values = await Promise.all(Object.values(definitions));
  const data = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
  const assistantReplies = data.assistantReplySources.GEMINI.map((point, index) => ({ at: point.at, count: point.count + data.assistantReplySources.DETERMINISTIC_FALLBACK[index].count }));
  const assistantFallbacks = data.assistantReplySources.DETERMINISTIC_FALLBACK;
  const assistantTotal = total(assistantReplies);
  const fallbackTotal = total(assistantFallbacks);
  const itineraryTotal = total(data.geminiItinerariesCreated) + total(data.fallbackItinerariesCreated);
  const itineraryFallbacks = total(data.fallbackItinerariesCreated);
  const notificationMetric = notificationAvailable
    ? { available: true, values: data.notificationsPersisted, retentionDays: 180, semantics: "Notification documents persisted; delivery is not tracked." }
    : { available: false, values: null, retentionDays: 180, reason: "Notification documents expire after 180 days; this range extends beyond retained data." };
  const metrics = {
    currentEligibleUsers: { available: true, value: data.currentEligibleUsers, asOf: now.toISOString(), definition: "Accounts currently in ACTIVE status." },
    historicalEligibleUsers: { available: false, reason: "Historical account-status snapshots are not retained; only audited status changes since Phase 25 deployment exist." },
    usersRegistered: data.usersRegistered,
    accountStatusChanges: { values: data.accountStatusChanges, coverage: "Audited changes are available only from Phase 25 deployment onward; older history is not backfilled." },
    tripsCreated: data.tripsCreated,
    tripsPublished: data.tripsPublished,
    tripsCompleted: data.tripsCompleted,
    tripsCancelled: data.tripsCancelled,
    membershipsJoined: data.membershipsJoined,
    connectionRequests: data.connectionRequests,
    connectionAcceptances: { values: data.connectionAcceptances, coverage: "Counts existing CONNECTION_ACCEPTED audit events." },
    conversationsCreated: data.conversationsCreated,
    messagesCreated: data.messagesCreated,
    itinerariesCreated: data.itinerariesCreated,
    itineraryGenerations: data.itineraryGenerations,
    geminiItinerariesCreated: data.geminiItinerariesCreated,
    fallbackItinerariesCreated: data.fallbackItinerariesCreated,
    itineraryFallbackShare: { available: itineraryTotal > 0, value: safeRatio(itineraryFallbacks, itineraryTotal), numerator: itineraryFallbacks, denominator: itineraryTotal, reason: itineraryTotal ? null : "No itinerary records in this period." },
    bookingsCreated: data.bookingsCreated,
    bookingExternalHandoffs: { values: data.bookingExternalHandoffs, semantics: "TripBuddy handoff records only; external reservation conversion is not measured." },
    expensesCreated: data.expensesCreated,
    settlementsRecorded: data.settlementsRecorded,
    providerVerifiedSettlements: data.providerVerifiedSettlements,
    userReportedSettlements: data.userReportedSettlements,
    paymentAttemptsCreated: data.paymentAttemptsCreated,
    paymentVerifiedSuccesses: data.paymentVerifiedSuccesses,
    paymentVerifiedFailures: data.paymentVerifiedFailures,
    paymentRefundEvents: data.paymentRefundEvents,
    paymentStatusEvents: data.paymentStatusEvents,
    reviewsCreated: data.reviewsCreated,
    safetyReportsCreated: data.safetyReportsCreated,
    reviewReportsCreated: data.reviewReportsCreated,
    moderationRecordsCreated: data.moderationRecordsCreated,
    moderationClassifierProviders: data.moderationClassifierProviders,
    moderationDecisions: data.moderationDecisions,
    assistantReplies: { values: assistantReplies, bySource: data.assistantReplySources },
    assistantFallbackShare: { available: assistantTotal > 0, value: safeRatio(fallbackTotal, assistantTotal), numerator: fallbackTotal, denominator: assistantTotal, reason: assistantTotal ? null : "No assistant replies in this period." },
    assistantProviderFailureRate: { available: false, value: null, reason: "Provider failures are not recorded separately from deterministic fallback replies." },
    notificationPersistence: notificationMetric,
    notificationDelivery: { available: false, reason: "Notification delivery acknowledgements are not instrumented." },
  };
  const summary = Object.fromEntries(Object.entries(metrics).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, total(value)]));
  summary.currentEligibleUsers = data.currentEligibleUsers;
  summary.accountStatusChanges = total(data.accountStatusChanges);
  summary.connectionAcceptances = total(data.connectionAcceptances);
  summary.bookingExternalHandoffs = total(data.bookingExternalHandoffs);
  summary.paymentStatusEvents = Object.fromEntries(Object.entries(data.paymentStatusEvents).map(([status, values]) => [status, total(values)]));
  summary.moderationClassifierProviders = Object.fromEntries(Object.entries(data.moderationClassifierProviders).map(([provider, values]) => [provider, total(values)]));
  summary.assistantReplies = assistantTotal;
  summary.assistantFallbackReplies = fallbackTotal;
  summary.itineraryFallbackShare = safeRatio(itineraryFallbacks, itineraryTotal);
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString(), bucket: period.bucket, timezone: "UTC", window: period.window, freshness: "Live aggregation at request time; no cache." },
    summary,
    metrics,
  };
};

module.exports = { getAnalytics, PROVIDER_VERIFIED_SOURCES };
