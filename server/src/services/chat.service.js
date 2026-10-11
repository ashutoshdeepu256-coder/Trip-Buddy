const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Connection = require("../models/Connection");
const Trip = require("../models/Trip");
const TripMember = require("../models/TripMember");
const User = require("../models/User");
const Block = require("../models/Block");
const { HttpError } = require("../utils/http");
const { recordAudit } = require("./audit.service");
const { takeUserLimit } = require("./chat-rate-limit.service");

const idOf = (value) => value?._id?.toString?.() || value?.toString?.() || "";
const openTripStatuses = ["PUBLISHED", "PLANNING", "CONFIRMED", "ONGOING"];
const notFound = () => new HttpError(404, "Conversation was not found or is no longer available", "CONVERSATION_NOT_FOUND");

const ensureActive = async (userId) => {
  const user = await User.findById(userId).select("_id name accountStatus").lean();
  if (!user || (user.accountStatus && user.accountStatus !== "ACTIVE")) {
    throw new HttpError(403, "An active account is required", "ACCOUNT_INELIGIBLE");
  }
  return user;
};

const blockedIds = async (userId, counterpartIds) => {
  if (!counterpartIds.length) return [];
  const edges = await Block.find({ $or: [
    { blocker: userId, blocked: { $in: counterpartIds } },
    { blocked: userId, blocker: { $in: counterpartIds } },
  ] }).select("blocker blocked").lean();
  return edges.map((edge) => idOf(edge.blocker) === idOf(userId) ? idOf(edge.blocked) : idOf(edge.blocker));
};

const activeTripMember = (tripId, userId) => TripMember.findOne({ trip: tripId, user: userId, status: "ACTIVE" }).select("joinedAt role createdAt").lean();

const ensureTripAccess = async (tripId, userId) => {
  const [trip, membership] = await Promise.all([
    Trip.findById(tripId).select("_id creator title privacy status").lean(),
    activeTripMember(tripId, userId),
  ]);
  if (!trip || !openTripStatuses.includes(trip.status) || !membership) throw notFound();
  const joinedAt = membership.joinedAt || membership.createdAt;
  if (joinedAt && new Date(joinedAt) > new Date()) throw notFound();
  // The trip creator is an explicit ACTIVE OWNER TripMember under the existing trip workflow.
  return { trip, membership, joinedAt };
};

const requireConversation = async (conversationId, actorId) => {
  if (!mongoose.isValidObjectId(conversationId)) throw new HttpError(400, "Invalid conversation ID", "INVALID_CONVERSATION_ID");
  const conversation = await Conversation.findOne({ _id: conversationId, status: "ACTIVE" }).lean();
  if (!conversation) throw notFound();
  const user = await ensureActive(actorId);
  let joinedAt = null;
  if (conversation.type === "DIRECT") {
    const participant = conversation.participants.find((item) => idOf(item.user) === idOf(actorId) && item.status === "ACTIVE");
    if (!participant || !conversation.connection) throw notFound();
    const connection = await Connection.findOne({ _id: conversation.connection, status: "ACCEPTED" }).select("_id requester recipient").lean();
    if (!connection || ![idOf(connection.requester), idOf(connection.recipient)].includes(idOf(actorId))) throw notFound();
    const otherId = idOf(connection.requester) === idOf(actorId) ? connection.recipient : connection.requester;
    await ensureActive(otherId);
    if ((await blockedIds(actorId, [otherId])).length) throw notFound();
    joinedAt = participant.joinedAt;
  } else if (conversation.type === "TRIP" && conversation.trip) {
    const access = await ensureTripAccess(conversation.trip, actorId);
    joinedAt = access.joinedAt;
  } else {
    throw notFound();
  }
  return { conversation, user, joinedAt };
};

const participantPresentation = async (conversation, actorId) => {
  let ids = [];
  if (conversation.type === "DIRECT") {
    ids = conversation.participants.filter((item) => item.status === "ACTIVE").map((item) => idOf(item.user));
  } else {
    const members = await TripMember.find({ trip: conversation.trip, status: "ACTIVE" }).select("user").lean();
    ids = members.map((member) => idOf(member.user));
  }
  const blocked = new Set(await blockedIds(actorId, ids.filter((id) => id !== idOf(actorId))));
  const users = await User.find({ _id: { $in: ids.filter((id) => idOf(id) === idOf(actorId) || !blocked.has(idOf(id))) }, accountStatus: { $in: ["ACTIVE", null] } }).select("name").lean();
  return users.map((user) => ({ id: idOf(user), name: user.name }));
};

const serializeConversation = async (conversation, actorId, unreadCount = 0) => {
  let trip = null;
  if (conversation.trip) {
    trip = await Trip.findById(conversation.trip).select("title status").lean();
  }
  const participants = await participantPresentation(conversation, actorId);
  return {
    id: idOf(conversation), type: conversation.type,
    trip: trip ? { id: idOf(conversation.trip), title: trip.title, status: trip.status } : null,
    participants,
    lastMessageAt: conversation.lastMessageAt,
    lastMessage: conversation.lastMessage ? idOf(conversation.lastMessage) : null,
    unreadCount,
    createdAt: conversation.createdAt,
  };
};

const visibleSenderIds = async (conversation, actorId) => {
  const ids = conversation.type === "DIRECT"
    ? conversation.participants.filter((participant) => participant.status === "ACTIVE").map((participant) => participant.user)
    : (await TripMember.find({ trip: conversation.trip, status: "ACTIVE" }).select("user").lean()).map((member) => member.user);
  const hidden = new Set(await blockedIds(actorId, ids.filter((id) => idOf(id) !== idOf(actorId))));
  const eligible = await User.find({ _id: { $in: ids }, $or: [{ accountStatus: "ACTIVE" }, { accountStatus: { $exists: false } }] }).select("_id").lean();
  return eligible.map((user) => user._id).filter((id) => !hidden.has(idOf(id)));
};

const countUnread = async (conversation, actorId, joinedAt) => {
  const senders = await visibleSenderIds(conversation, actorId);
  if (!senders.length) return 0;
  return Message.countDocuments({
    conversation: conversation._id,
    sender: { $in: senders, $ne: actorId },
    readBy: { $ne: actorId },
    ...(joinedAt ? { createdAt: { $gte: joinedAt } } : {}),
  });
};

const ensureDirectConversation = async (actor, connectionId, req) => {
  await ensureActive(actor._id);
  if (!mongoose.isValidObjectId(connectionId)) throw new HttpError(400, "Invalid connection ID", "INVALID_CONNECTION_ID");
  const connection = await Connection.findOne({ _id: connectionId, status: "ACCEPTED", $or: [{ requester: actor._id }, { recipient: actor._id }] }).lean();
  if (!connection) throw notFound();
  const ids = [connection.requester, connection.recipient];
  const users = await User.find({ _id: { $in: ids } }).select("_id accountStatus").lean();
  if (users.length !== 2 || users.some((user) => user.accountStatus && user.accountStatus !== "ACTIVE")) throw notFound();
  if ((await blockedIds(actor._id, [ids.find((id) => idOf(id) !== idOf(actor._id))])).length) throw notFound();
  const activeKey = `DIRECT:${idOf(connection._id)}`;
  let conversation = await Conversation.findOne({ activeKey, status: "ACTIVE" });
  let created = false;
  if (!conversation) {
    try {
      conversation = await Conversation.create({
        type: "DIRECT", status: "ACTIVE", activeKey, connection: connection._id,
        createdBy: actor._id,
        participants: ids.map((user) => ({ user, status: "ACTIVE", joinedAt: new Date() })),
      });
      created = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
      conversation = await Conversation.findOne({ activeKey, status: "ACTIVE" });
    }
  }
  if (!conversation) throw notFound();
  if (created) await recordAudit(req, { action: "CHAT_CONVERSATION_CREATED", resourceType: "Conversation", resourceId: conversation._id });
  return serializeConversation(conversation.toObject(), actor._id);
};

const ensureTripConversation = async (actor, tripId, req) => {
  await ensureActive(actor._id);
  const { trip } = await ensureTripAccess(tripId, actor._id);
  const activeKey = `TRIP:${idOf(trip._id)}`;
  let conversation = await Conversation.findOne({ activeKey, status: "ACTIVE" });
  let created = false;
  if (!conversation) {
    const members = await TripMember.find({ trip: trip._id, status: "ACTIVE" }).select("user joinedAt").lean();
    try {
      conversation = await Conversation.create({
        type: "TRIP", status: "ACTIVE", activeKey, trip: trip._id,
        createdBy: actor._id,
        participants: members.map((member) => ({ user: member.user, status: "ACTIVE", joinedAt: member.joinedAt || new Date() })),
      });
      created = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
      conversation = await Conversation.findOne({ activeKey, status: "ACTIVE" });
    }
  }
  if (created) await recordAudit(req, { action: "CHAT_CONVERSATION_CREATED", resourceType: "Conversation", resourceId: conversation._id });
  return serializeConversation(conversation.toObject(), actor._id);
};

const listConversations = async (actor, pagination) => {
  await ensureActive(actor._id);
  const memberships = await TripMember.find({ user: actor._id, status: "ACTIVE" }).select("trip").lean();
  const filter = { status: "ACTIVE", $or: [
    { type: "DIRECT", "participants.user": actor._id, "participants.status": "ACTIVE" },
    { type: "TRIP", trip: { $in: memberships.map((item) => item.trip) } },
  ] };
  const [rows, total] = await Promise.all([
    Conversation.find(filter).sort({ lastMessageAt: -1, _id: -1 }).skip((pagination.page - 1) * pagination.limit).limit(pagination.limit).lean(),
    Conversation.countDocuments(filter),
  ]);
  const items = await Promise.all(rows.map(async (conversation) => {
    try {
      const access = await requireConversation(conversation._id, actor._id);
      const unreadCount = await countUnread(conversation, actor._id, access.joinedAt);
      return await serializeConversation(conversation, actor._id, unreadCount);
    } catch { return null; }
  }));
  const totalPages = Math.ceil(total / pagination.limit);
  return { items: items.filter(Boolean), page: pagination.page, limit: pagination.limit, total: items.filter(Boolean).length, totalPages, hasNextPage: pagination.page < totalPages, hasPreviousPage: pagination.page > 1 };
};

const getConversation = async (conversationId, actorId) => {
  const { conversation, joinedAt } = await requireConversation(conversationId, actorId);
  const unreadCount = await countUnread(conversation, actorId, joinedAt);
  return serializeConversation(conversation, actorId, unreadCount);
};

const serializeMessage = (message) => ({
  id: idOf(message), conversationId: idOf(message.conversation), senderId: idOf(message.sender),
  text: message.text, createdAt: message.createdAt,
  deliveredTo: (message.deliveredTo || []).map(idOf), readBy: (message.readBy || []).map(idOf),
});

const history = async (conversationId, actorId, { limit, before }) => {
  const { conversation, joinedAt } = await requireConversation(conversationId, actorId);
  let cursorFilter = {};
  if (before) {
    if (!mongoose.isValidObjectId(before)) throw new HttpError(400, "Invalid message cursor", "INVALID_CURSOR");
    const cursor = await Message.findOne({ _id: before, conversation: conversation._id }).select("createdAt _id").lean();
    if (!cursor) throw new HttpError(400, "Message cursor was not found", "INVALID_CURSOR");
    cursorFilter = { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }] };
  }
  const senders = await visibleSenderIds(conversation, actorId);
  const query = { conversation: conversation._id, sender: { $in: senders }, ...(joinedAt ? { createdAt: { $gte: joinedAt } } : {}), ...cursorFilter };
  const rows = await Message.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).reverse().map(serializeMessage);
  return { items, nextCursor: hasMore ? idOf(rows[limit - 1]) : null, hasMore };
};

const messageRecipients = async (conversation, senderId) => {
  const ids = conversation.type === "DIRECT"
    ? conversation.participants.map((participant) => participant.user).filter((id) => idOf(id) !== idOf(senderId))
    : (await TripMember.find({ trip: conversation.trip, status: "ACTIVE" }).select("user").lean()).map((member) => member.user).filter((id) => idOf(id) !== idOf(senderId));
  if (!ids.length) return [];
  const [users, blocked] = await Promise.all([
    User.find({ _id: { $in: ids }, $or: [{ accountStatus: "ACTIVE" }, { accountStatus: { $exists: false } }] }).select("_id").lean(),
    blockedIds(senderId, ids),
  ]);
  const hidden = new Set(blocked);
  return users.map((user) => user._id).filter((id) => !hidden.has(idOf(id)));
};

const createMessage = async (conversationId, actorId, { text, idempotencyKey }, req) => {
  const { conversation, joinedAt } = await requireConversation(conversationId, actorId);
  const normalizedText = text.trim();
  if (!normalizedText || normalizedText.length > 4000) throw new HttpError(400, "Message must contain 1 to 4000 characters", "INVALID_MESSAGE");
  const existing = await Message.findOne({ sender: actorId, idempotencyKey }).lean();
  if (existing) {
    if (idOf(existing.conversation) !== idOf(conversation._id)) throw new HttpError(409, "Idempotency key was already used", "IDEMPOTENCY_CONFLICT");
    return { message: serializeMessage(existing), recipients: await messageRecipients(conversation, actorId), duplicate: true };
  }
  if (!takeUserLimit(actorId, "message", 20, 60_000)) {
    throw new HttpError(429, "Message rate limit reached", "RATE_LIMITED");
  }
  if (joinedAt && new Date() < joinedAt) throw notFound();
  let message;
  try {
    message = await Message.create({ conversation: conversation._id, sender: actorId, text: normalizedText, idempotencyKey });
  } catch (error) {
    if (error.code !== 11000) throw error;
    message = await Message.findOne({ sender: actorId, idempotencyKey }).lean();
    if (!message || idOf(message.conversation) !== idOf(conversation._id)) throw new HttpError(409, "Idempotency key was already used", "IDEMPOTENCY_CONFLICT");
    return { message: serializeMessage(message), recipients: await messageRecipients(conversation, actorId), duplicate: true };
  }
  await Conversation.updateOne({ _id: conversation._id, status: "ACTIVE" }, { $set: { lastMessage: message._id, lastMessageAt: message.createdAt } });
  if (req) await recordAudit(req, { action: "CHAT_MESSAGE_SENT", resourceType: "Message", resourceId: message._id });
  return { message: serializeMessage(message.toObject()), recipients: await messageRecipients(conversation, actorId), duplicate: false };
};

const markRead = async (conversationId, actorId, upToMessageId) => {
  const { conversation, joinedAt } = await requireConversation(conversationId, actorId);
  let cutoff = new Date();
  if (upToMessageId) {
    const target = await Message.findOne({ _id: upToMessageId, conversation: conversation._id }).select("createdAt").lean();
    if (!target) throw new HttpError(400, "Read cursor must be a message in this conversation", "INVALID_READ_CURSOR");
    cutoff = target.createdAt;
  }
  const senders = await visibleSenderIds(conversation, actorId);
  const filter = { conversation: conversation._id, sender: { $in: senders, $ne: actorId }, createdAt: { $lte: cutoff }, readBy: { $ne: actorId }, ...(joinedAt ? { createdAt: { $gte: joinedAt, $lte: cutoff } } : {}) };
  const updated = await Message.updateMany(filter, { $addToSet: { readBy: actorId } });
  await Conversation.updateOne({ _id: conversation._id }, { $set: { "participants.$[participant].lastReadAt": cutoff } }, { arrayFilters: [{ "participant.user": actorId, "participant.status": "ACTIVE" }] });
  return { conversationId: idOf(conversation._id), upToMessageId: upToMessageId || null, updatedCount: updated.modifiedCount, readAt: new Date() };
};

const unreadCounts = async (actor) => {
  await ensureActive(actor._id);
  const memberships = await TripMember.find({ user: actor._id, status: "ACTIVE" }).select("trip").lean();
  const rows = await Conversation.find({ status: "ACTIVE", $or: [
    { type: "DIRECT", "participants.user": actor._id, "participants.status": "ACTIVE" },
    { type: "TRIP", trip: { $in: memberships.map((item) => item.trip) } },
  ] }).select("_id type participants trip").lean();
  const items = [];
  for (const row of rows) {
    try {
      const { joinedAt } = await requireConversation(row._id, actor._id);
      const count = await countUnread(row, actor._id, joinedAt);
      if (count) items.push({ conversationId: idOf(row), count });
    } catch { /* Ignore conversations whose authorization has been revoked. */ }
  }
  return { total: items.reduce((sum, item) => sum + item.count, 0), items };
};

module.exports = { ensureActive, requireConversation, ensureDirectConversation, ensureTripConversation, listConversations, getConversation, history, createMessage, markRead, unreadCounts, messageRecipients, serializeMessage };
