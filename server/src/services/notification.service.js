const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const User = require("../models/User");
const TripMember = require("../models/TripMember");

const RETENTION_DAYS = 180;
const idOf = (value) => value?._id?.toString?.() || value?.toString?.() || "";
const roomFor = (recipientId) => `user:${idOf(recipientId)}`;
const preferenceValue = (user, category) => user.notificationPreferences?.get?.(category) ?? user.notificationPreferences?.[category];
const preferencesFor = (user) => Object.fromEntries(["CONNECTIONS", "MESSAGES", "EXPENSES", "PAYMENTS", "SAFETY"].map((category) => [category, preferenceValue(user, category) !== false]));

const serialize = (item) => ({
  id: idOf(item._id), type: item.type, category: item.category, title: item.title, body: item.body,
  route: item.metadata.route, relatedEntityType: item.relatedEntityType || null,
  relatedEntityId: idOf(item.relatedEntityId) || null, readAt: item.readAt || null,
  createdAt: item.createdAt, expiresAt: item.expiresAt,
});

const persist = async (values, { session = null } = {}) => {
  const recipientId = values.recipient;
  if (!mongoose.isValidObjectId(recipientId)) return null;
  const userQuery = User.findById(recipientId).select("_id accountStatus notificationPreferences");
  if (session) userQuery.session(session);
  const user = await userQuery.lean();
  if (!user || (user.accountStatus && user.accountStatus !== "ACTIVE") || preferenceValue(user, values.category) === false) return null;
  if (values.actorId && await require("./safety.service").isInteractionBlocked(values.actorId, recipientId)) return null;
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const notification = new Notification({ ...values, recipient: recipientId, expiresAt });
  if (session) await notification.save({ session });
  else {
    try { await notification.save(); }
    catch (error) {
      if (error.code !== 11000 || !values.deduplicationKey) throw error;
      return null;
    }
  }
  return notification;
};

const notificationPayload = (item) => serialize(item.toObject ? item.toObject() : item);

const dispatch = async (item, io) => {
  if (!io || !item) return;
  const payload = notificationPayload(item);
  io.to(roomFor(item.recipient)).emit("notifications:new", payload);
  try {
    const count = await Notification.countDocuments({ recipient: item.recipient, readAt: null, dismissedAt: null, expiresAt: { $gt: new Date() } });
    io.to(roomFor(item.recipient)).emit("notifications:unread-count", { count });
  } catch { /* Persisted notifications remain available through REST. */ }
};

const create = async (values, { io = null, session = null } = {}) => {
  const item = await persist(values, { session });
  if (item && !session) await dispatch(item, io);
  return item ? serialize(item.toObject ? item.toObject() : item) : null;
};

const dispatchByDeduplicationKeys = async (keys, io) => {
  if (!io || !keys?.length) return;
  const items = await Notification.find({ deduplicationKey: { $in: keys } }).lean();
  for (const item of items) await dispatch(item, io);
};

const ioFor = (req) => { try { return req?.app?.get?.("io") || null; } catch { return null; } };

const notifyConnection = async ({ connection, recipientId, actorId, type, io, req }) => {
  const definitions = {
    CONNECTION_REQUEST: ["CONNECTIONS", "New connection request", "A traveller sent you a connection request.", "/connections/requests"],
    CONNECTION_ACCEPTED: ["CONNECTIONS", "Connection accepted", "Your connection request was accepted.", "/connections"],
    CONNECTION_REJECTED: ["CONNECTIONS", "Connection update", "Your connection request was declined.", "/connections"],
  };
  const [category, title, body, route] = definitions[type] || [];
  if (!category) return null;
  return create({ recipient: recipientId, actorId, type, category, title, body, metadata: { route }, relatedEntityType: "Connection", relatedEntityId: connection._id, deduplicationKey: `connection:${idOf(connection._id)}:${type}:${idOf(recipientId)}` }, { io: io || ioFor(req) });
};

const notifyMessage = async ({ conversationId, senderId, recipients, messageId, io, req }) => {
  const chatService = require("./chat.service");
  for (const recipientId of recipients) {
    try {
      await chatService.requireConversation(conversationId, recipientId);
      await create({ recipient: recipientId, actorId: senderId, type: "CHAT_MESSAGE", category: "MESSAGES", title: "New message", body: "You have a new message in a conversation.", metadata: { route: `/chat?conversation=${idOf(conversationId)}` }, relatedEntityType: "Conversation", relatedEntityId: conversationId, deduplicationKey: `message:${idOf(messageId)}:${idOf(recipientId)}` }, { io: io || ioFor(req) });
    } catch { /* Access may be revoked or blocked after message persistence. */ }
  }
};

const notifyExpense = async ({ expense, recipients, type = "EXPENSE_CREATED", actorId, io, req }) => {
  const tripId = idOf(expense.trip || expense.tripId);
  const definitions = {
    EXPENSE_CREATED: ["A trip expense was added", "Open the trip ledger to view the update."],
    EXPENSE_UPDATED: ["A trip expense was updated", "Open the trip ledger to review the change."],
    EXPENSE_VOIDED: ["A trip expense was voided", "Open the trip ledger to review the update."],
  };
  const [title, body] = definitions[type] || [];
  if (!title || !mongoose.isValidObjectId(tripId)) return;
  const active = await TripMember.find({ trip: tripId, user: { $in: recipients }, status: "ACTIVE", $or: [{ joinedAt: null }, { joinedAt: { $lte: new Date() } }] }).select("user").lean();
  for (const member of active) {
    if (idOf(member.user) === idOf(actorId) || await require("./safety.service").isInteractionBlocked(actorId, member.user)) continue;
    await create({ recipient: member.user, actorId, type, category: "EXPENSES", title, body, metadata: { route: `/trips/${tripId}/expenses` }, relatedEntityType: "Expense", relatedEntityId: expense._id || expense.id, deduplicationKey: `expense:${idOf(expense._id || expense.id)}:${expense.revision || 1}:${type}:${idOf(member.user)}` }, { io: io || ioFor(req) });
  }
};

const notifySettlement = async ({ settlement, io, req }) => create({
  recipient: settlement.toUser, actorId: settlement.fromUser, type: "SETTLEMENT_RECORDED", category: "EXPENSES",
  title: "Settlement update", body: "A trip settlement was recorded as reported.",
  metadata: { route: `/trips/${idOf(settlement.trip)}/expenses` }, relatedEntityType: "ExpenseSettlement", relatedEntityId: settlement._id,
  deduplicationKey: `settlement:${idOf(settlement._id)}:${idOf(settlement.toUser)}`,
}, { io: io || ioFor(req) });

const notifySafetyStatus = async ({ report, status, io, req }) => create({
  recipient: report.reporter, type: "SAFETY_REPORT_STATUS", category: "SAFETY", title: "Safety report update",
  body: status === "RESOLVED" ? "Your safety report has been resolved." : status === "DISMISSED" ? "Your safety report was reviewed and closed." : "Your safety report is under review.",
  metadata: { route: "/safety" }, relatedEntityType: "Report", relatedEntityId: report._id,
  deduplicationKey: `safety-report:${idOf(report._id)}:${status}`,
}, { io: io || ioFor(req) });

const getPreferences = async (userId) => {
  const user = await User.findById(userId).select("notificationPreferences").lean();
  return user ? { channels: { inApp: true, email: false, push: false }, categories: preferencesFor(user), securityNotices: true } : null;
};

const updatePreferences = async (userId, categories) => {
  const updates = Object.fromEntries(Object.entries(categories).map(([key, value]) => [`notificationPreferences.${key}`, value]));
  await User.updateOne({ _id: userId }, { $set: updates });
  return getPreferences(userId);
};

const list = async (recipientId, { page, limit }) => {
  const filter = { recipient: recipientId, dismissedAt: null, expiresAt: { $gt: new Date() } };
  const [rows, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Notification.countDocuments(filter),
  ]);
  return { items: rows.map(serialize), page, limit, total, totalPages: Math.ceil(total / limit) };
};

const unreadCount = (recipientId) => Notification.countDocuments({ recipient: recipientId, readAt: null, dismissedAt: null, expiresAt: { $gt: new Date() } });
const markRead = async (recipientId, notificationId, io) => {
  const item = await Notification.findOneAndUpdate({ _id: notificationId, recipient: recipientId, dismissedAt: null }, { $set: { readAt: new Date() } }, { new: true });
  if (!item) return null;
  const payload = { id: idOf(item._id), readAt: item.readAt };
  const count = await unreadCount(recipientId);
  io?.to(roomFor(recipientId)).emit("notifications:read", payload);
  io?.to(roomFor(recipientId)).emit("notifications:unread-count", { count });
  return { notification: serialize(item), unreadCount: count };
};

const markAllRead = async (recipientId, io) => {
  const readAt = new Date();
  const result = await Notification.updateMany({ recipient: recipientId, readAt: null, dismissedAt: null }, { $set: { readAt } });
  io?.to(roomFor(recipientId)).emit("notifications:read", { all: true, readAt });
  io?.to(roomFor(recipientId)).emit("notifications:unread-count", { count: 0 });
  return { modifiedCount: result.modifiedCount, readAt, unreadCount: 0 };
};

const dismiss = async (recipientId, notificationId, io) => {
  const item = await Notification.findOneAndUpdate({ _id: notificationId, recipient: recipientId, dismissedAt: null }, { $set: { dismissedAt: new Date() } }, { new: true });
  if (!item) return null;
  const count = await unreadCount(recipientId);
  io?.to(roomFor(recipientId)).emit("notifications:unread-count", { count });
  return { id: idOf(item._id), dismissedAt: item.dismissedAt, unreadCount: count };
};

module.exports = { RETENTION_DAYS, create, persist, dispatch, dispatchByDeduplicationKeys, notifyConnection, notifyMessage, notifyExpense, notifySettlement, notifySafetyStatus, getPreferences, updatePreferences, list, unreadCount, markRead, markAllRead, dismiss, serialize };
