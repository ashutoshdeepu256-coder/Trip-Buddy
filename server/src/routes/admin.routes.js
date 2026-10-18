const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const controller = require("../controllers/admin.controller");
const schemas = require("../validators/admin.validator");

const router = express.Router();
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 10, keyGenerator: (req) => req.user._id.toString(), standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
router.use(requireAuth, requireAdmin);
router.get("/overview", asyncHandler(controller.overview));
router.get("/users", validate(schemas.userQuery, "query"), asyncHandler(controller.users));
router.patch("/users/:userId/status", writeLimiter, validate(schemas.userParams, "params"), validate(schemas.statusBody), asyncHandler(controller.changeStatus));
router.patch("/users/:userId/role", writeLimiter, validate(schemas.userParams, "params"), validate(schemas.roleBody), asyncHandler(controller.changeRole));
router.get("/trips", validate(schemas.tripQuery, "query"), asyncHandler(controller.trips));
router.get("/audit", validate(schemas.auditQuery, "query"), asyncHandler(controller.audits));

module.exports = router;
