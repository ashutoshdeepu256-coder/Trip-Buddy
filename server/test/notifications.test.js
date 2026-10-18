const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Notification = require("../src/models/Notification");
const notificationService = require("../src/services/notification.service");
const { pagination, preferences } = require("../src/validators/notification.validator");

test("Notification model indexes recipient timelines, unread state, dedupe and retention", () => {
  const indexes = Notification.schema.indexes();
  assert.ok(indexes.some(([fields]) => fields.recipient === 1 && fields.createdAt === -1));
  assert.ok(indexes.some(([fields]) => fields.recipient === 1 && fields.readAt === 1 && fields.dismissedAt === 1));
  assert.ok(indexes.some(([fields, options]) => fields.deduplicationKey === 1 && options.unique));
  assert.ok(indexes.some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0));
  assert.equal(Notification.schema.path("type").enumValues.includes("CHAT_MESSAGE"), true);
});

test("notification validators bound pagination and reject unsupported categories/channels", () => {
  assert.deepEqual(pagination.parse({ page: "2", limit: "30" }), { page: 2, limit: 30 });
  assert.equal(pagination.safeParse({ limit: "500" }).success, false);
  assert.equal(preferences.safeParse({ categories: { MESSAGES: false } }).success, true);
  assert.equal(preferences.safeParse({ categories: { PAYMENTS: "off" } }).success, false);
  assert.equal(preferences.safeParse({ categories: { UNKNOWN: false } }).success, false);
  assert.equal(preferences.safeParse({ categories: { MESSAGES: false }, channels: { email: true } }).success, false);
});

test("notification socket dispatch targets only its server-assigned recipient room", async (context) => {
  const recipient = new mongoose.Types.ObjectId();
  const events = [];
  context.mock.method(Notification, "countDocuments", async () => 1);
  const io = { to: (room) => ({ emit: (name, payload) => events.push({ room, name, payload }) }) };
  await notificationService.dispatch({
    _id: new mongoose.Types.ObjectId(), recipient, type: "CHAT_MESSAGE", category: "MESSAGES",
    title: "New message", body: "You have a new message in a conversation.",
    metadata: { route: "/chat?conversation=64b000000000000000000001" },
    createdAt: new Date(), expiresAt: new Date(Date.now() + 10000),
  }, io);
  assert.equal(events[0].room, `user:${recipient}`);
  assert.equal(events[0].name, "notifications:new");
  assert.equal(Object.hasOwn(events[0].payload, "recipient"), false);
  assert.equal(Object.hasOwn(events[0].payload, "messageText"), false);
});

const configuredUri = process.env.MONGODB_TEST_URI;
test("Notification persistence, owner scope, preferences and deduplication use a dedicated database", {
  skip: !configuredUri ? "Set MONGODB_TEST_URI to an isolated disposable test database" : false,
}, async (context) => {
  const uri = new URL(configuredUri);
  const sourceDatabase = uri.pathname.replace(/^\//, "").split("/")[0];
  assert.match(sourceDatabase, /test/i, "MONGODB_TEST_URI must name a dedicated test database");
  uri.pathname = `/${sourceDatabase}_phase22_notifications_${process.pid}`;
  await mongoose.connect(uri.toString(), { serverSelectionTimeoutMS: 3000 });
  const User = require("../src/models/User");
  const Connection = require("../src/models/Connection");
  const Conversation = require("../src/models/Conversation");
  const Message = require("../src/models/Message");
  const Block = require("../src/models/Block");
  await Promise.all([User, Notification, Connection, Conversation, Message, Block].map((model) => model.init()));
  const [owner, other] = await User.create([
    { name: "Notification owner", email: "phase22-owner@test.invalid", passwordHash: "integration-placeholder" },
    { name: "Other user", email: "phase22-other@test.invalid", passwordHash: "integration-placeholder" },
  ]);
  context.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  const payload = {
    recipient: owner._id, type: "CONNECTION_REQUEST", category: "CONNECTIONS", title: "New connection request",
    body: "A traveller sent you a connection request.", metadata: { route: "/connections/requests" },
    deduplicationKey: `test:${owner._id}`,
  };
  const created = await notificationService.create(payload);
  const repeated = await notificationService.create(payload);
  assert.ok(created);
  assert.equal(repeated, null);
  assert.equal(await Notification.countDocuments({ recipient: owner._id }), 1);
  assert.equal((await notificationService.list(owner._id, { page: 1, limit: 20 })).total, 1);
  assert.equal((await notificationService.list(other._id, { page: 1, limit: 20 })).total, 0);
  assert.equal(await notificationService.unreadCount(owner._id), 1);
  assert.equal(await notificationService.markRead(other._id, created.id), null);
  assert.equal((await notificationService.markRead(owner._id, created.id)).unreadCount, 0);

  const connection = await Connection.create({ requester: other._id, recipient: owner._id, pairKey: [owner._id.toString(), other._id.toString()].sort().join(":"), tripKey: "GLOBAL", activeKey: `accepted:${owner._id}:${other._id}`, status: "ACCEPTED", audit: { requestedBy: other._id } });
  const conversation = await Conversation.create({ type: "DIRECT", status: "ACTIVE", connection: connection._id, activeKey: `DIRECT:${connection._id}`, createdBy: other._id, participants: [{ user: other._id, status: "ACTIVE", joinedAt: new Date(0) }, { user: owner._id, status: "ACTIVE", joinedAt: new Date(0) }] });
  const chatService = require("../src/services/chat.service");
  const messageInput = { text: "Private chat body stays out of notification previews", idempotencyKey: "notification-chat-key-1" };
  const firstMessage = await chatService.createMessage(conversation._id, other._id, messageInput, null);
  const repeatedMessage = await chatService.createMessage(conversation._id, other._id, messageInput, null);
  assert.equal(firstMessage.duplicate, false);
  assert.equal(repeatedMessage.duplicate, true);
  assert.equal(await Notification.countDocuments({ recipient: owner._id, type: "CHAT_MESSAGE" }), 1);
  const messageAlert = await Notification.findOne({ recipient: owner._id, type: "CHAT_MESSAGE" }).lean();
  assert.equal(messageAlert.body.includes("Private chat body"), false);

  await notificationService.updatePreferences(owner._id, { MESSAGES: false });
  const optedOut = await notificationService.create({ ...payload, type: "CHAT_MESSAGE", category: "MESSAGES", deduplicationKey: `optout:${owner._id}` });
  assert.equal(optedOut, null);
  await chatService.createMessage(conversation._id, other._id, { text: "Second private message", idempotencyKey: "notification-chat-key-2" }, null);
  assert.equal(await Notification.countDocuments({ recipient: owner._id, type: "CHAT_MESSAGE" }), 1);
  assert.equal((await notificationService.getPreferences(owner._id)).categories.MESSAGES, false);
  await notificationService.dismiss(owner._id, created.id);
  assert.equal((await notificationService.list(owner._id, { page: 1, limit: 20 })).total, 0);
});
