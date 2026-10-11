const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const User = require("../models/User");
const Message = require("../models/Message");
const chatService = require("../services/chat.service");
const { socketMessageSchema, socketConversationSchema, socketReadSchema, typingSchema } = require("../validators/chat.validator");
const collaboration = require("../services/collaborativeItinerary.service");
const { z } = require("zod");
const collabValidators = require("../validators/itinerary.validator");

const userRoom = (id) => `user:${id}`;
const rateWindows = new Map();
const parseCookieToken = (header = "") => {
  const value = header.split(";").map((part) => part.trim()).find((part) => part.startsWith("tripbuddy_session="));
  return value ? decodeURIComponent(value.slice("tripbuddy_session=".length)) : null;
};

const verifyToken = (token) => {
  if (!token || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("Authentication required");
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"], issuer: "tripbuddy", audience: "tripbuddy-web" });
};

const refreshSocketActor = async (socket) => {
  let payload;
  try { payload = verifyToken(socket.data.sessionToken); }
  catch {
    const error = new Error("Session is no longer valid");
    error.code = "UNAUTHENTICATED";
    throw error;
  }
  const user = await User.findById(payload.sub).select("_id accountStatus +tokenVersion").lean();
  if (!user || (user.accountStatus && user.accountStatus !== "ACTIVE") || (payload.v || 0) !== (user.tokenVersion || 0)) {
    const error = new Error("Session is no longer valid");
    error.code = "UNAUTHENTICATED";
    throw error;
  }
  socket.data.userId = user._id;
  return user;
};

const rateLimitEvent = (userId, key, limit, windowMs) => {
  const now = Date.now();
  const bucketKey = `${userId}:${key}`;
  const bucket = rateWindows.get(bucketKey);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    rateWindows.set(bucketKey, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  if (rateWindows.size > 10000) {
    for (const [key, value] of rateWindows) if (now - value.startedAt >= windowMs) rateWindows.delete(key);
  }
  return true;
};

const errorAck = (error) => ({ success: false, error: { code: error.issues ? "VALIDATION_ERROR" : error.code || "CHAT_EVENT_FAILED", message: error.issues ? "Event payload is invalid" : error.statusCode && error.statusCode < 500 ? error.message : error.code === "UNAUTHENTICATED" ? error.message : "The chat request could not be completed" } });
const ackRun = (socket, ack, action) => Promise.resolve().then(action).then((data) => {
  if (typeof ack === "function") ack({ success: true, data });
}).catch((error) => {
  if (error.code === "UNAUTHENTICATED") socket.disconnect(true);
  if (typeof ack === "function") ack(errorAck(error));
});

const emitAuthorized = async (io, userId, event, payload, conversationId) => {
  const sockets = await io.in(userRoom(userId.toString())).fetchSockets();
  let delivered = false;
  for (const socket of sockets) {
    try {
      const actor = await refreshSocketActor(socket);
      if (actor._id.toString() !== userId.toString()) continue;
      if (conversationId) await chatService.requireConversation(conversationId, actor._id);
      socket.emit(event, payload);
      delivered = true;
    } catch {
      socket.disconnect(true);
    }
  }
  return delivered;
};

const broadcastMessage = async (io, message, recipients) => {
  const delivered = [];
  for (const recipientId of recipients) {
    try {
      await chatService.requireConversation(message.conversationId, recipientId);
      if (await emitAuthorized(io, recipientId, "chat:message:new", message, message.conversationId)) delivered.push(recipientId);
    } catch { /* Authorization may have been revoked after persistence. */ }
  }
  if (delivered.length) {
    await Message.updateOne({ _id: message.id }, { $addToSet: { deliveredTo: { $each: delivered } } });
    await emitAuthorized(io, message.senderId, "chat:message:delivered", { conversationId: message.conversationId, messageId: message.id, deliveredTo: delivered.map((id) => id.toString()) }, message.conversationId);
  }
};

const broadcastRead = async (io, receipt, readerId) => {
  let conversation;
  try { conversation = await chatService.requireConversation(receipt.conversationId, readerId); } catch { return; }
  const others = await chatService.messageRecipients(conversation.conversation, readerId);
  for (const userId of others) {
    try {
      await chatService.requireConversation(receipt.conversationId, userId);
      await emitAuthorized(io, userId, "chat:message:read", { ...receipt, readerId: readerId.toString() }, receipt.conversationId);
    } catch { /* Recheck each recipient before receipt delivery. */ }
  }
};

const createChatSocket = (httpServer, app) => {
  const io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true },
    maxHttpBufferSize: 32 * 1024,
  });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || parseCookieToken(socket.handshake.headers.cookie);
      const payload = verifyToken(token);
      const user = await User.findById(payload.sub).select("_id accountStatus +tokenVersion").lean();
      if (!user || (user.accountStatus && user.accountStatus !== "ACTIVE") || (payload.v || 0) !== (user.tokenVersion || 0)) return next(new Error("UNAUTHENTICATED"));
      socket.data.sessionToken = token;
      socket.data.userId = user._id;
      return next();
    } catch { return next(new Error("UNAUTHENTICATED")); }
  });
  io.on("connection", (socket) => {
    const actorId = socket.data.userId.toString();
    socket.join(userRoom(actorId));
    socket.on("chat:join", (payload, ack) => ackRun(socket, ack, async () => {
      await refreshSocketActor(socket);
      const data = socketConversationSchema.parse(payload);
      await chatService.requireConversation(data.conversationId, socket.data.userId);
      await socket.join(`conversation:${data.conversationId}`);
      return { conversationId: data.conversationId, joined: true };
    }));
    socket.on("chat:leave", (payload, ack) => ackRun(socket, ack, async () => {
      await refreshSocketActor(socket);
      const data = socketConversationSchema.parse(payload);
      await socket.leave(`conversation:${data.conversationId}`);
      return { conversationId: data.conversationId, left: true };
    }));
    socket.on("chat:message:send", (payload, ack) => ackRun(socket, ack, async () => {
      const actor = await refreshSocketActor(socket);
      const data = socketMessageSchema.parse(payload);
      const auditRequest = {
        user: actor,
        ip: socket.handshake.address,
        get: (name) => socket.handshake.headers[name.toLowerCase()],
      };
      const result = await chatService.createMessage(data.conversationId, actor._id, data, auditRequest);
      await broadcastMessage(io, result.message, result.recipients);
      return { message: result.message, duplicate: result.duplicate };
    }));
    socket.on("chat:read", (payload, ack) => ackRun(socket, ack, async () => {
      const actor = await refreshSocketActor(socket);
      const data = socketReadSchema.parse(payload);
      const receipt = await chatService.markRead(data.conversationId, actor._id, data.upToMessageId);
      await broadcastRead(io, receipt, actor._id);
      return receipt;
    }));
    socket.on("chat:typing", (payload, ack) => ackRun(socket, ack, async () => {
      const actor = await refreshSocketActor(socket);
      const data = typingSchema.parse(payload);
      if (!rateLimitEvent(actor._id, "typing", 30, 60_000)) throw Object.assign(new Error("Typing rate limit reached"), { code: "RATE_LIMITED", statusCode: 429 });
      const { conversation } = await chatService.requireConversation(data.conversationId, actor._id);
      const recipients = await chatService.messageRecipients(conversation, actor._id);
      for (const userId of recipients) {
        try {
          await chatService.requireConversation(data.conversationId, userId);
          await emitAuthorized(io, userId, "chat:typing", { conversationId: data.conversationId, userId: actor._id.toString(), active: data.active }, data.conversationId);
        } catch { /* Authorization can be revoked while the socket is connected. */ }
      }
      return { conversationId: data.conversationId, active: data.active };
    }));
    const itineraryIdSchema = z.object({ itineraryId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
    const itineraryRoom = (id) => `itinerary:${id}`;
    const collabRequest = (actor) => ({
      user: actor,
      ip: socket.handshake.address,
      get: (name) => socket.handshake.headers[name.toLowerCase()],
    });
    const emitItineraryChange = async (itineraryId, event) => {
      const sockets = await io.in(itineraryRoom(itineraryId)).fetchSockets();
      for (const recipient of sockets) {
        try {
          const actor = await refreshSocketActor(recipient);
          await collaboration.authorizeSocket(itineraryId, actor._id);
          recipient.emit("itinerary:changed", event);
        } catch {
          await recipient.leave(itineraryRoom(itineraryId));
        }
      }
    };
    const runItineraryWrite = (eventName, validator, operation, write = true) => {
      socket.on(eventName, (payload, ack) => ackRun(socket, ack, async () => {
        const actor = await refreshSocketActor(socket);
        const raw = { ...payload };
        const { itineraryId, activityId, ...values } = raw;
        const identity = itineraryIdSchema.parse({ itineraryId });
        await collaboration.authorizeSocket(identity.itineraryId, actor._id, write);
        const data = validator.parse(values);
        const request = collabRequest(actor);
        const result = await operation(request, identity.itineraryId, data, activityId || data.dayId);
        const event = { itineraryId: identity.itineraryId, revision: result.revision, operation: eventName, actorId: actor._id.toString() };
        if (!result.duplicate) await emitItineraryChange(identity.itineraryId, event);
        return { ...event, duplicate: Boolean(result.duplicate) };
      }));
    };
    socket.on("itinerary:join", (payload, ack) => ackRun(socket, ack, async () => {
      await refreshSocketActor(socket);
      const { itineraryId } = itineraryIdSchema.parse(payload);
      await collaboration.authorizeSocket(itineraryId, socket.data.userId);
      await socket.join(itineraryRoom(itineraryId));
      return { itineraryId, joined: true };
    }));
    socket.on("itinerary:leave", (payload, ack) => ackRun(socket, ack, async () => {
      await refreshSocketActor(socket);
      const { itineraryId } = itineraryIdSchema.parse(payload);
      await socket.leave(itineraryRoom(itineraryId));
      return { itineraryId, left: true };
    }));
    runItineraryWrite("itinerary:activity:add", collabValidators.editActivitySchema, (req, id, data) => collaboration.addActivity(req, id, data));
    runItineraryWrite("itinerary:activity:update", collabValidators.editActivitySchema, (req, id, data, activityId) => collaboration.updateActivity(req, id, activityId, data));
    runItineraryWrite("itinerary:activity:remove", collabValidators.deleteActivitySchema, (req, id, data, activityId) => collaboration.removeActivity(req, id, activityId, data));
    runItineraryWrite("itinerary:activities:reorder", collabValidators.reorderSchema, (req, id, data) => collaboration.reorderActivities(req, id, data));
    runItineraryWrite("itinerary:days:reorder", collabValidators.dayOrderSchema, (req, id, data) => collaboration.reorderDays(req, id, data));
    runItineraryWrite("itinerary:day:add", collabValidators.addDaySchema, (req, id, data) => collaboration.addDay(req, id, data));
    runItineraryWrite("itinerary:day:update", collabValidators.updateDaySchema, (req, id, data, dayId) => collaboration.updateDay(req, id, dayId, data));
    runItineraryWrite("itinerary:day:remove", collabValidators.deleteDaySchema, (req, id, data, dayId) => collaboration.removeDay(req, id, dayId, data));
    socket.on("disconnect", () => {
      // Presence is not persisted; disconnecting removes this socket from all rooms.
    });
  });
  app.set("io", io);
  return io;
};

module.exports = { createChatSocket, broadcastMessage, broadcastRead };
