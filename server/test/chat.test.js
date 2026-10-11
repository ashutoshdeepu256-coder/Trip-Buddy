const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Conversation = require("../src/models/Conversation");
const Message = require("../src/models/Message");
const User = require("../src/models/User");
const Connection = require("../src/models/Connection");
const Trip = require("../src/models/Trip");
const TripMember = require("../src/models/TripMember");
const Block = require("../src/models/Block");
const chatService = require("../src/services/chat.service");
const { takeUserLimit } = require("../src/services/chat-rate-limit.service");
const chatSocket = require("../src/realtime/chat.socket");
const { io: createClient } = require("socket.io-client");
const { sendMessageSchema, directConversationSchema, socketMessageSchema } = require("../src/validators/chat.validator");

const secret = "chat-test-secret-with-at-least-thirty-two-characters";
const actorId = new mongoose.Types.ObjectId("64b000000000000000000001");
const otherId = new mongoose.Types.ObjectId("64b000000000000000000002");
const conversationId = new mongoose.Types.ObjectId("64b000000000000000000003");
const connectionId = new mongoose.Types.ObjectId("64b000000000000000000004");
const tripId = new mongoose.Types.ObjectId("64b000000000000000000005");
const query = (value) => ({ select() { return this; }, lean: async () => value });
const direct = () => ({
  _id: conversationId, type: "DIRECT", status: "ACTIVE", connection: connectionId,
  participants: [{ user: actorId, status: "ACTIVE", joinedAt: new Date(0) }, { user: otherId, status: "ACTIVE", joinedAt: new Date(0) }],
});
const mockActiveUsers = (context, users = [actorId, otherId]) => {
  context.mock.method(User, "findById", () => query({ _id: actorId, name: "Traveller", accountStatus: "ACTIVE", tokenVersion: 0 }));
  context.mock.method(User, "find", () => query(users.map((_id) => ({ _id }))));
  context.mock.method(Block, "find", () => query([]));
};

test("chat models have membership, cursor, unread, and idempotency indexes", () => {
  assert.ok(Conversation.schema.indexes().some(([fields, options]) => fields.activeKey === 1 && options.unique));
  assert.ok(Conversation.schema.indexes().some(([fields]) => fields["participants.user"] === 1 && fields.status === 1));
  assert.ok(Conversation.schema.indexes().some(([fields]) => fields.trip === 1 && fields.status === 1));
  assert.ok(Message.schema.indexes().some(([fields]) => fields.conversation === 1 && fields.createdAt === -1 && fields._id === -1));
  assert.ok(Message.schema.indexes().some(([fields, options]) => fields.sender === 1 && fields.idempotencyKey === 1 && options.unique));
  assert.ok(Message.schema.indexes().some(([fields]) => fields.conversation === 1 && fields.readBy === 1 && fields.sender === 1));
  assert.deepEqual(Conversation.schema.path("type").enumValues, ["DIRECT", "TRIP"]);
});

test("chat validators enforce identifiers, message limits, idempotency, and forbid client authorization fields", () => {
  const valid = { text: " A safe message ", idempotencyKey: "retry-key-123" };
  assert.deepEqual(sendMessageSchema.parse(valid), { text: "A safe message", idempotencyKey: "retry-key-123" });
  assert.equal(sendMessageSchema.safeParse({ ...valid, senderId: otherId.toString() }).success, false);
  assert.equal(sendMessageSchema.safeParse({ text: " ", idempotencyKey: "retry-key-123" }).success, false);
  assert.equal(sendMessageSchema.safeParse({ text: "x".repeat(4001), idempotencyKey: "retry-key-123" }).success, false);
  assert.equal(directConversationSchema.safeParse({ connectionId: connectionId.toString(), participants: [actorId.toString()] }).success, false);
  assert.equal(socketMessageSchema.safeParse({ conversationId: conversationId.toString(), ...valid, readBy: [actorId.toString()] }).success, false);
});

test("the shared message rate limit is per user across REST and socket sends", () => {
  const uniqueUserId = new mongoose.Types.ObjectId().toString();
  for (let index = 0; index < 20; index += 1) assert.equal(takeUserLimit(uniqueUserId, "message", 20, 60_000), true);
  assert.equal(takeUserLimit(uniqueUserId, "message", 20, 60_000), false);
});

test("direct history authorization rechecks accepted connection, account status, and block edges", async (context) => {
  process.env.JWT_SECRET = secret;
  const accepted = { _id: connectionId, requester: actorId, recipient: otherId };
  context.mock.method(Conversation, "findOne", () => query(direct()));
  context.mock.method(Connection, "findOne", () => query(accepted));
  mockActiveUsers(context);
  assert.equal((await chatService.requireConversation(conversationId, actorId)).conversation.type, "DIRECT");

  context.mock.restoreAll();
  context.mock.method(Conversation, "findOne", () => query(direct()));
  context.mock.method(Connection, "findOne", () => query(null));
  mockActiveUsers(context);
  await assert.rejects(chatService.requireConversation(conversationId, actorId), { code: "CONVERSATION_NOT_FOUND" });

  context.mock.restoreAll();
  context.mock.method(Conversation, "findOne", () => query(direct()));
  context.mock.method(Connection, "findOne", () => query(accepted));
  context.mock.method(User, "findById", (id) => query({ _id: id, name: "Traveller", accountStatus: "ACTIVE" }));
  context.mock.method(Block, "find", () => query([{ blocker: otherId, blocked: actorId }]));
  await assert.rejects(chatService.requireConversation(conversationId, actorId), { code: "CONVERSATION_NOT_FOUND" });

  context.mock.restoreAll();
  context.mock.method(Conversation, "findOne", () => query(direct()));
  context.mock.method(Connection, "findOne", () => query(accepted));
  context.mock.method(User, "findById", (id) => query({ _id: id, name: "Traveller", accountStatus: id.toString() === otherId.toString() ? "SUSPENDED" : "ACTIVE" }));
  context.mock.method(Block, "find", () => query([]));
  await assert.rejects(chatService.requireConversation(conversationId, actorId), { code: "ACCOUNT_INELIGIBLE", statusCode: 403 });
});

test("trip conversation access requires a current active TripMember and an open trip", async (context) => {
  const tripConversation = { _id: conversationId, type: "TRIP", status: "ACTIVE", trip: tripId, participants: [] };
  context.mock.method(Conversation, "findOne", () => query(tripConversation));
  context.mock.method(User, "findById", () => query({ _id: actorId, name: "Traveller", accountStatus: "ACTIVE" }));
  context.mock.method(Trip, "findById", () => query({ _id: tripId, creator: actorId, status: "PLANNING", privacy: "PRIVATE" }));
  context.mock.method(TripMember, "findOne", () => query({ trip: tripId, user: actorId, status: "ACTIVE", joinedAt: new Date(0) }));
  assert.equal((await chatService.requireConversation(conversationId, actorId)).conversation.type, "TRIP");

  context.mock.restoreAll();
  context.mock.method(Conversation, "findOne", () => query(tripConversation));
  context.mock.method(User, "findById", () => query({ _id: actorId, name: "Traveller", accountStatus: "ACTIVE" }));
  context.mock.method(Trip, "findById", () => query({ _id: tripId, creator: actorId, status: "PLANNING", privacy: "PRIVATE" }));
  context.mock.method(TripMember, "findOne", () => query(null));
  await assert.rejects(chatService.requireConversation(conversationId, actorId), { code: "CONVERSATION_NOT_FOUND" });
});

test("message send derives sender from the actor, persists once, and reconciles idempotent retries", async (context) => {
  const conversation = direct();
  const accepted = { _id: connectionId, requester: actorId, recipient: otherId };
  context.mock.method(Conversation, "findOne", () => query(conversation));
  context.mock.method(Connection, "findOne", () => query(accepted));
  mockActiveUsers(context, [otherId]);
  context.mock.method(Message, "findOne", () => query(null));
  let created = 0;
  const persisted = {
    _id: new mongoose.Types.ObjectId(), conversation: conversationId, sender: actorId,
    text: "Hello", idempotencyKey: "retry-key-123", deliveredTo: [], readBy: [], createdAt: new Date(),
    toObject() { return this; },
  };
  context.mock.method(Message, "create", async (values) => { created += 1; assert.equal(values.sender, actorId); return persisted; });
  context.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
  const first = await chatService.createMessage(conversationId, actorId, { text: "Hello", idempotencyKey: "retry-key-123" });
  assert.equal(first.duplicate, false);
  assert.equal(first.message.senderId, actorId.toString());
  assert.equal(created, 1);

  context.mock.restoreAll();
  context.mock.method(Conversation, "findOne", () => query(conversation));
  context.mock.method(Connection, "findOne", () => query(accepted));
  mockActiveUsers(context, [otherId]);
  context.mock.method(Message, "findOne", () => query({ ...persisted, conversation: conversationId }));
  context.mock.method(Message, "create", async () => { throw new Error("retry must not insert twice"); });
  const retry = await chatService.createMessage(conversationId, actorId, { text: "Hello", idempotencyKey: "retry-key-123" });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.message.id, persisted._id.toString());
});

test("read receipts use the authenticated reader and reject cursors outside the conversation", async (context) => {
  const conversation = direct();
  const accepted = { _id: connectionId, requester: actorId, recipient: otherId };
  context.mock.method(Conversation, "findOne", () => query(conversation));
  context.mock.method(Connection, "findOne", () => query(accepted));
  mockActiveUsers(context);
  const cursorId = new mongoose.Types.ObjectId();
  context.mock.method(Message, "findOne", () => query({ _id: cursorId, createdAt: new Date() }));
  let messageFilter;
  let readUpdate;
  context.mock.method(Message, "updateMany", async (filter, update) => { messageFilter = filter; readUpdate = update; return { modifiedCount: 2 }; });
  let participantUpdate;
  context.mock.method(Conversation, "updateOne", async (_filter, update, options) => { participantUpdate = { update, options }; return { modifiedCount: 1 }; });
  const result = await chatService.markRead(conversationId, actorId, cursorId.toString());
  assert.equal(result.updatedCount, 2);
  assert.deepEqual(messageFilter.readBy, { $ne: actorId });
  assert.deepEqual(messageFilter.sender.$ne, actorId);
  assert.ok(messageFilter.sender.$in.includes(actorId));
  assert.deepEqual(readUpdate.$addToSet, { readBy: actorId });
  assert.deepEqual(participantUpdate.options.arrayFilters[0], { "participant.user": actorId, "participant.status": "ACTIVE" });
});

test("socket authenticates the existing JWT session and denies an unauthorized room join", async (context) => {
  process.env.JWT_SECRET = secret;
  const app = { set() {} };
  const httpServer = require("node:http").createServer();
  const token = jwt.sign({ v: 0 }, secret, { subject: actorId.toString(), issuer: "tripbuddy", audience: "tripbuddy-web", expiresIn: "1m" });
  context.mock.method(User, "findById", () => query({ _id: actorId, accountStatus: "ACTIVE", tokenVersion: 0 }));
  let canJoin = false;
  context.mock.method(chatService, "requireConversation", async () => {
    if (!canJoin) throw Object.assign(new Error("denied"), { code: "CONVERSATION_NOT_FOUND", statusCode: 404 });
    return { conversation: direct() };
  });
  context.mock.method(chatService, "createMessage", async (id, senderId, data) => ({
    message: { id: data.idempotencyKey, conversationId: id, senderId: senderId.toString(), text: data.text, createdAt: new Date().toISOString(), deliveredTo: [], readBy: [] },
    recipients: [], duplicate: false,
  }));
  context.mock.method(chatService, "messageRecipients", async () => []);
  const ioServer = chatSocket.createChatSocket(httpServer, app);
  context.after(async () => { await new Promise((resolve) => ioServer.close(resolve)); });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const client = createClient(`http://127.0.0.1:${httpServer.address().port}`, { auth: { token }, reconnection: false });
  context.after(() => client.close());
  await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
  const response = await new Promise((resolve) => client.emit("chat:join", { conversationId: conversationId.toString() }, resolve));
  assert.deepEqual(response, { success: false, error: { code: "CONVERSATION_NOT_FOUND", message: "denied" } });
  canJoin = true;
  const malformed = await new Promise((resolve) => client.emit("chat:message:send", { conversationId: conversationId.toString(), senderId: otherId.toString(), text: "hello", idempotencyKey: "retry-key-123" }, resolve));
  assert.equal(malformed.error.code, "VALIDATION_ERROR");
  for (let index = 0; index < 30; index += 1) {
    const typing = await new Promise((resolve) => client.emit("chat:typing", { conversationId: conversationId.toString(), active: true }, resolve));
    assert.equal(typing.success, true);
  }
  const limitedTyping = await new Promise((resolve) => client.emit("chat:typing", { conversationId: conversationId.toString(), active: true }, resolve));
  assert.equal(limitedTyping.error.code, "RATE_LIMITED");
  client.disconnect();
  const reconnect = createClient(`http://127.0.0.1:${httpServer.address().port}`, { auth: { token }, reconnection: false });
  context.after(() => reconnect.close());
  await new Promise((resolve, reject) => { reconnect.once("connect", resolve); reconnect.once("connect_error", reject); });
  assert.equal(reconnect.connected, true);
  const expiredToken = jwt.sign({ v: 0 }, secret, { subject: actorId.toString(), issuer: "tripbuddy", audience: "tripbuddy-web", expiresIn: "-1s" });
  const expiredClient = createClient(`http://127.0.0.1:${httpServer.address().port}`, { auth: { token: expiredToken }, reconnection: false });
  context.after(() => expiredClient.close());
  const expiredError = await new Promise((resolve) => expiredClient.once("connect_error", resolve));
  assert.equal(expiredError.message, "UNAUTHENTICATED");
});

if (!process.env.MONGODB_TEST_URI) {
  test("chat MongoDB lifecycle and cross-user REST integration", { skip: "Set MONGODB_TEST_URI to an isolated disposable test database" }, () => {});
} else {
  test("chat MongoDB lifecycle, REST authorization, pagination, read state, blocks, and trip membership", async (context) => {
    const uri = process.env.MONGODB_TEST_URI;
    let databaseName = "";
    try { databaseName = new URL(uri).pathname.replace(/^\//, "").split("/")[0]; } catch { /* Mongoose will report malformed URIs. */ }
    assert.match(databaseName, /test/i, "MONGODB_TEST_URI must name a dedicated test database");
    process.env.JWT_SECRET = secret;
    const http = require("node:http");
    const app = require("../app");
    const authService = require("../src/services/auth.service");
    const ConversationModel = require("../src/models/Conversation");
    const TripModel = require("../src/models/Trip");
    const TripMemberModel = require("../src/models/TripMember");
    const AuditLog = require("../src/models/AuditLog");
    const mongo = mongoose.connection;
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User, Connection, Block, TripModel, TripMemberModel, ConversationModel, Message, AuditLog].map((model) => model.init()));
    const users = await User.create([
      { name: "Chat One", email: `chat-one-${Date.now()}@example.test`, passwordHash: "test-hash", accountStatus: "ACTIVE" },
      { name: "Chat Two", email: `chat-two-${Date.now()}@example.test`, passwordHash: "test-hash", accountStatus: "ACTIVE" },
      { name: "Chat Outsider", email: `chat-outsider-${Date.now()}@example.test`, passwordHash: "test-hash", accountStatus: "ACTIVE" },
    ]);
    const [one, two, outsider] = users;
    let trip;
    let tripMembers = [];
    let connection;
    const httpServer = http.createServer(app);
    context.after(async () => {
      httpServer.closeAllConnections();
      if (httpServer.listening) await new Promise((resolve) => httpServer.close(() => resolve()));
      await Promise.all([
        Message.deleteMany({ sender: { $in: users.map((user) => user._id) } }),
        ...(connection ? [ConversationModel.deleteMany({ connection: connection._id }), Connection.deleteOne({ _id: connection._id })] : []),
        ...(trip ? [ConversationModel.deleteMany({ trip: trip._id }), TripMemberModel.deleteMany({ trip: trip._id }), TripModel.deleteOne({ _id: trip._id })] : []),
        Block.deleteMany({ $or: [{ blocker: { $in: users.map((user) => user._id) } }, { blocked: { $in: users.map((user) => user._id) } }] }),
        AuditLog.deleteMany({ actor: { $in: users.map((user) => user._id) } }),
        User.deleteMany({ _id: { $in: users.map((user) => user._id) } }),
      ]);
      await mongoose.disconnect();
    });
    trip = await TripModel.create({ creator: one._id, title: "Private member chat", status: "PLANNING", privacy: "PRIVATE" });
    tripMembers = await TripMemberModel.create([
      { trip: trip._id, user: one._id, role: "OWNER", status: "ACTIVE", joinedAt: new Date(Date.now() - 60000) },
      { trip: trip._id, user: two._id, role: "MEMBER", status: "ACTIVE", joinedAt: new Date(Date.now() - 60000) },
    ]);
    const pairKey = [one._id.toString(), two._id.toString()].sort().join(":");
    connection = await Connection.create({ requester: one._id, recipient: two._id, pairKey, tripKey: "GLOBAL", activeKey: `${pairKey}:GLOBAL`, status: "ACCEPTED", audit: { requestedBy: one._id, acceptedBy: two._id }, respondedAt: new Date() });
    await new Promise((resolve, reject) => { httpServer.once("listening", resolve); httpServer.once("error", reject); httpServer.listen(0, "127.0.0.1"); });
    const origin = `http://127.0.0.1:${httpServer.address().port}`;
    const tokens = users.map((user) => authService.createSessionToken(user._id, user.tokenVersion));
    const call = async (token, method, path, body) => {
      const response = await fetch(`${origin}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { response, payload: await response.json() };
    };

    const directFirst = await call(tokens[0], "POST", "/api/v1/chat/conversations/direct", { connectionId: connection._id.toString() });
    const directSecond = await call(tokens[0], "POST", "/api/v1/chat/conversations/direct", { connectionId: connection._id.toString() });
    assert.equal(directFirst.response.status, 200);
    assert.equal(directFirst.payload.data.conversation.id, directSecond.payload.data.conversation.id);
    assert.equal(await ConversationModel.countDocuments({ connection: connection._id, status: "ACTIVE" }), 1);

    const messageOne = await call(tokens[0], "POST", `/api/v1/chat/conversations/${directFirst.payload.data.conversation.id}/messages`, { text: "First", idempotencyKey: "mongo-retry-key-1", senderId: outsider._id.toString() });
    assert.equal(messageOne.response.status, 400, "client sender identity must be rejected");
    const sentOne = await call(tokens[0], "POST", `/api/v1/chat/conversations/${directFirst.payload.data.conversation.id}/messages`, { text: "First", idempotencyKey: "mongo-retry-key-1" });
    const retryOne = await call(tokens[0], "POST", `/api/v1/chat/conversations/${directFirst.payload.data.conversation.id}/messages`, { text: "First", idempotencyKey: "mongo-retry-key-1" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const sentTwo = await call(tokens[0], "POST", `/api/v1/chat/conversations/${directFirst.payload.data.conversation.id}/messages`, { text: "Second", idempotencyKey: "mongo-retry-key-2" });
    assert.equal(sentOne.response.status, 201);
    assert.equal(retryOne.response.status, 200);
    assert.equal(retryOne.payload.data.message.id, sentOne.payload.data.message.id);
    assert.equal(await Message.countDocuments({ conversation: directFirst.payload.data.conversation.id }), 2);
    const unauthorizedHistory = await call(tokens[2], "GET", `/api/v1/chat/conversations/${directFirst.payload.data.conversation.id}/messages?limit=1`);
    assert.equal(unauthorizedHistory.response.status, 404);
    const historyOne = await call(tokens[1], "GET", `/api/v1/chat/conversations/${directFirst.payload.data.conversation.id}/messages?limit=1`);
    assert.equal(historyOne.payload.data.items.length, 1);
    assert.equal(historyOne.payload.data.items[0].id, sentTwo.payload.data.message.id);
    assert.ok(historyOne.payload.data.nextCursor);
    const historyTwo = await call(tokens[1], "GET", `/api/v1/chat/conversations/${directFirst.payload.data.conversation.id}/messages?limit=1&before=${historyOne.payload.data.nextCursor}`);
    assert.equal(historyTwo.payload.data.items[0].id, sentOne.payload.data.message.id);
    const unread = await call(tokens[1], "GET", "/api/v1/chat/unread");
    assert.equal(unread.payload.data.total, 2);
    const read = await call(tokens[1], "POST", `/api/v1/chat/conversations/${directFirst.payload.data.conversation.id}/read`, { upToMessageId: sentTwo.payload.data.message.id });
    assert.equal(read.payload.data.updatedCount, 2);
    assert.equal((await call(tokens[1], "GET", "/api/v1/chat/unread")).payload.data.total, 0);

    const tripConversation = await call(tokens[1], "POST", `/api/v1/chat/trips/${trip._id}/conversation`, {});
    assert.equal(tripConversation.response.status, 200, "active membership grants private trip chat");
    const outsiderTrip = await call(tokens[2], "POST", `/api/v1/chat/trips/${trip._id}/conversation`, {});
    assert.equal(outsiderTrip.response.status, 404);
    const block = await Block.create({ blocker: one._id, blocked: two._id });
    assert.ok(block);
    const blockedHistory = await call(tokens[1], "GET", `/api/v1/chat/conversations/${directFirst.payload.data.conversation.id}/messages`);
    assert.equal(blockedHistory.response.status, 404);
    two.accountStatus = "SUSPENDED";
    await two.save();
    const suspendedUnread = await call(tokens[1], "GET", "/api/v1/chat/unread");
    assert.equal(suspendedUnread.response.status, 403);
    assert.equal(await TripMemberModel.countDocuments({ trip: trip._id, user: outsider._id }), 0, "chat never infers or creates membership");
    assert.equal(tripMembers.length, 2);
    assert.ok(mongo.readyState === 1);
  });
}
