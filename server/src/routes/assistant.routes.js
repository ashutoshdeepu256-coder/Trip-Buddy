const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const controller = require("../controllers/assistant.controller");
const schemas = require("../validators/assistant.validator");

const routes = express.Router();
const perUserKey = (req) => req.user._id.toString();
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: perUserKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
const messageLimiter = rateLimit({ windowMs: 60_000, limit: 8, keyGenerator: perUserKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
routes.use(requireAuth);
routes.get("/usage", asyncHandler(controller.usage));
routes.post("/conversations", writeLimiter, validate(schemas.createConversation), asyncHandler(controller.create));
routes.get("/conversations", validate(schemas.pagination, "query"), asyncHandler(controller.list));
routes.get("/conversations/:conversationId/messages", validate(schemas.conversationParams, "params"), validate(schemas.pagination, "query"), asyncHandler(controller.history));
routes.post("/conversations/:conversationId/messages", messageLimiter, validate(schemas.conversationParams, "params"), validate(schemas.sendMessage), asyncHandler(controller.sendMessage));
routes.patch("/conversations/:conversationId/archive", writeLimiter, validate(schemas.conversationParams, "params"), validate(schemas.archiveConversation), asyncHandler(controller.archive));
routes.delete("/conversations/:conversationId", writeLimiter, validate(schemas.conversationParams, "params"), asyncHandler(controller.remove));

module.exports = routes;
