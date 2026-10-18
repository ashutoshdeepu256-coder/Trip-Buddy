const { sendSuccess } = require("../utils/http");
const chatService = require("../services/chat.service");
const realtime = require("../realtime/chat.socket");

const list = async (req, res) => sendSuccess(res, await chatService.listConversations(req.user, req.validatedQuery));
const direct = async (req, res) => sendSuccess(res, { conversation: await chatService.ensureDirectConversation(req.user, req.body.connectionId, req) }, "Conversation ready", 200);
const trip = async (req, res) => sendSuccess(res, { conversation: await chatService.ensureTripConversation(req.user, req.params.tripId, req) }, "Conversation ready", 200);
const detail = async (req, res) => sendSuccess(res, { conversation: await chatService.getConversation(req.params.conversationId, req.user._id) });
const history = async (req, res) => sendSuccess(res, await chatService.history(req.params.conversationId, req.user._id, req.validatedQuery));
const send = async (req, res) => {
  const result = await chatService.createMessage(req.params.conversationId, req.user._id, req.body, req);
  const io = req.app.get("io");
  if (result.message && io) await realtime.broadcastMessage(io, result.message, result.recipients);
  return sendSuccess(res, result.held ? { held: true, detail: "Your message is held for safety review and was not delivered.", appealId: result.appealId } : { message: result.message }, result.held ? "Message held for review" : result.duplicate ? "Message already sent" : "Message sent", result.held ? 202 : result.duplicate ? 200 : 201);
};
const read = async (req, res) => {
  const result = await chatService.markRead(req.params.conversationId, req.user._id, req.body.upToMessageId);
  const io = req.app.get("io");
  if (io) await realtime.broadcastRead(io, result, req.user._id);
  return sendSuccess(res, result, "Messages marked as read");
};
const unread = async (req, res) => sendSuccess(res, await chatService.unreadCounts(req.user));

module.exports = { list, direct, trip, detail, history, send, read, unread };
