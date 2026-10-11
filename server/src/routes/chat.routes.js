const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/chat.controller");
const { requireAuth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const {
  conversationParamsSchema, directConversationSchema, tripConversationParamsSchema,
  messageParamsSchema, paginationSchema, sendMessageSchema, readSchema, listQuerySchema,
} = require("../validators/chat.validator");

const routes = express.Router();
const messageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
routes.use(requireAuth);
routes.get("/conversations", validate(listQuerySchema, "query"), asyncHandler(controller.list));
routes.post("/conversations/direct", validate(directConversationSchema), asyncHandler(controller.direct));
routes.post("/trips/:tripId/conversation", validate(tripConversationParamsSchema, "params"), asyncHandler(controller.trip));
routes.get("/unread", asyncHandler(controller.unread));
routes.get("/conversations/:conversationId", validate(conversationParamsSchema, "params"), asyncHandler(controller.detail));
routes.get("/conversations/:conversationId/messages", validate(messageParamsSchema, "params"), validate(paginationSchema, "query"), asyncHandler(controller.history));
routes.post("/conversations/:conversationId/messages", messageLimiter, validate(messageParamsSchema, "params"), validate(sendMessageSchema), asyncHandler(controller.send));
routes.post("/conversations/:conversationId/read", validate(messageParamsSchema, "params"), validate(readSchema), asyncHandler(controller.read));

module.exports = routes;
