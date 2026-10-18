const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/safety.controller");
const validate = require("../middleware/validate");
const { requireAuth, requireModerator } = require("../middleware/auth");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const { reportSchema } = require("../validators/verification");
const safetySchemas = require("../validators/safety-center.validator");

const router = express.Router();
const reportLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const userRateKey = (req) => req.user._id.toString();
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: userRateKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
const reportReviewSchema = require("zod").z.object({
  status: require("zod").z.enum(["UNDER_REVIEW", "RESOLVED", "DISMISSED"]),
  moderatorNotes: require("zod").z.string().trim().max(2000).optional().default(""),
});
router.use(requireAuth);
router.post("/block/:userId", writeLimiter, asyncHandler(controller.block));
router.delete("/block/:userId", writeLimiter, asyncHandler(controller.unblock));
router.get("/blocked-users", asyncHandler(controller.listBlocked));
router.post("/reports", reportLimiter, validate(reportSchema), asyncHandler(controller.report));
router.get("/reports/mine", validate(safetySchemas.pageQuery, "query"), asyncHandler(controller.myReports));
router.get("/settings", asyncHandler(controller.settings));
router.patch("/settings", writeLimiter, validate(safetySchemas.preferences), asyncHandler(controller.updateSettings));
router.get("/emergency-contacts", asyncHandler(controller.listContacts));
router.post("/emergency-contacts", writeLimiter, validate(safetySchemas.contact), asyncHandler(controller.addContact));
router.patch("/emergency-contacts/:contactId", writeLimiter, validate(safetySchemas.contactParams, "params"), validate(safetySchemas.contact), asyncHandler(controller.updateContact));
router.delete("/emergency-contacts/:contactId", writeLimiter, validate(safetySchemas.contactParams, "params"), asyncHandler(controller.removeContact));
router.get("/trips/:tripId", validate(safetySchemas.tripParams, "params"), asyncHandler(controller.tripSafety));
router.patch("/trips/:tripId", writeLimiter, validate(safetySchemas.tripParams, "params"), validate(safetySchemas.tripSafety), asyncHandler(controller.updateTripSafety));
router.get(
  "/admin/reports",
  requireModerator,
  validate(safetySchemas.reportQuery, "query"),
  asyncHandler(controller.listReports),
);
router.patch(
  "/admin/reports/:reportId",
  requireModerator,
  validate(require("zod").z.object({ reportId: require("zod").z.string().regex(/^[a-f\d]{24}$/i) }), "params"),
  validate(reportReviewSchema),
  asyncHandler(controller.reviewReport),
);

module.exports = router;
