const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const controller = require("../controllers/payment.controller");
const { createSchema, paymentParamsSchema, verifySchema, listSchema, refundSchema } = require("../validators/payment.validator");

const routes = express.Router();
const webhookRoutes = express.Router();
const keyGenerator = (req) => req.user._id.toString();
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 12, keyGenerator, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
const webhookLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });

routes.use(requireAuth);
routes.get("/", validate(listSchema, "query"), asyncHandler(controller.list));
routes.post("/", writeLimiter, validate(createSchema), asyncHandler(controller.create));
routes.get("/:paymentId", validate(paymentParamsSchema, "params"), asyncHandler(controller.get));
routes.post("/:paymentId/verify", writeLimiter, validate(paymentParamsSchema, "params"), validate(verifySchema), asyncHandler(controller.verify));
routes.post("/:paymentId/reconcile", writeLimiter, validate(paymentParamsSchema, "params"), asyncHandler(controller.reconcile));
routes.post("/:paymentId/refund", writeLimiter, validate(paymentParamsSchema, "params"), validate(refundSchema), asyncHandler(controller.refund));

webhookRoutes.post("/", webhookLimiter, asyncHandler(controller.webhook));

module.exports = { routes, webhookRoutes };
