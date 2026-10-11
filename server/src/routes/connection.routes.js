const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/connection.controller");
const { requireAuth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const { connectionIdParamsSchema, createConnectionSchema, connectionsQuerySchema } = require("../validators/connection.validator");

const routes = express.Router();
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

routes.use("/connections", requireAuth);
routes.post("/connections", requestLimiter, validate(createConnectionSchema), asyncHandler(controller.create));
routes.get("/connections", validate(connectionsQuerySchema, "query"), asyncHandler(controller.list));
routes.get("/connections/requests/received", validate(connectionsQuerySchema, "query"), asyncHandler(controller.received));
routes.get("/connections/requests/sent", validate(connectionsQuerySchema, "query"), asyncHandler(controller.sent));
routes.get("/connections/:connectionId", validate(connectionIdParamsSchema, "params"), asyncHandler(controller.detail));
routes.post("/connections/:connectionId/accept", validate(connectionIdParamsSchema, "params"), asyncHandler(controller.accept));
routes.post("/connections/:connectionId/reject", validate(connectionIdParamsSchema, "params"), asyncHandler(controller.reject));
routes.post("/connections/:connectionId/cancel", validate(connectionIdParamsSchema, "params"), asyncHandler(controller.cancel));
routes.post("/connections/:connectionId/unmatch", validate(connectionIdParamsSchema, "params"), asyncHandler(controller.unmatch));

module.exports = routes;
