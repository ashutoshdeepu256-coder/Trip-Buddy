const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const controller = require("../controllers/expense.controller");
const {
  createSchema, updateSchema, pageQuerySchema, tripParamsSchema, expenseParamsSchema,
  voidSchema, settlementCreateSchema, settlementParamsSchema, settlementReverseSchema,
  settlementsQuerySchema,
} = require("../validators/expense.validator");

const routes = express.Router();
const perUserKey = (req) => req.user._id.toString();
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, keyGenerator: perUserKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
routes.use(requireAuth);
routes.get("/trips/:tripId/participants", validate(tripParamsSchema, "params"), asyncHandler(controller.participants));
routes.get("/trips/:tripId/summary", validate(tripParamsSchema, "params"), asyncHandler(controller.summary));
routes.get("/trips/:tripId/settlements/suggestions", validate(tripParamsSchema, "params"), asyncHandler(controller.suggestions));
routes.get("/trips/:tripId/settlements", validate(tripParamsSchema, "params"), validate(settlementsQuerySchema, "query"), asyncHandler(controller.settlements));
routes.post("/trips/:tripId/settlements", writeLimiter, validate(tripParamsSchema, "params"), validate(settlementCreateSchema), asyncHandler(controller.recordSettlement));
routes.post("/trips/:tripId/settlements/:settlementId/reverse", writeLimiter, validate(settlementParamsSchema, "params"), validate(settlementReverseSchema), asyncHandler(controller.reverseSettlement));
routes.get("/trips/:tripId", validate(tripParamsSchema, "params"), validate(pageQuerySchema, "query"), asyncHandler(controller.list));
routes.post("/trips/:tripId", writeLimiter, validate(tripParamsSchema, "params"), validate(createSchema), asyncHandler(controller.create));
routes.get("/trips/:tripId/:expenseId", validate(expenseParamsSchema, "params"), asyncHandler(controller.get));
routes.patch("/trips/:tripId/:expenseId", writeLimiter, validate(expenseParamsSchema, "params"), validate(updateSchema), asyncHandler(controller.update));
routes.post("/trips/:tripId/:expenseId/void", writeLimiter, validate(expenseParamsSchema, "params"), validate(voidSchema), asyncHandler(controller.voidExpense));

module.exports = routes;
