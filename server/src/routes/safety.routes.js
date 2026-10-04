const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/safety.controller");
const validate = require("../middleware/validate");
const { requireAuth, requireModerator } = require("../middleware/auth");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const { reportSchema } = require("../validators/verification");

const router = express.Router();
const reportLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const reportReviewSchema = require("zod").z.object({
  status: require("zod").z.enum(["UNDER_REVIEW", "RESOLVED", "DISMISSED"]),
  resolution: require("zod").z.string().trim().max(2000).optional().default(""),
});
const reportQuerySchema = require("zod").z.object({
  status: require("zod").z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"]).optional(),
  page: require("zod").z.coerce.number().int().min(1).max(10000).default(1),
  limit: require("zod").z.coerce.number().int().min(1).max(100).default(25),
});

router.use(requireAuth);
router.post("/block/:userId", asyncHandler(controller.block));
router.delete("/block/:userId", asyncHandler(controller.unblock));
router.get("/blocked-users", asyncHandler(controller.listBlocked));
router.post("/reports", reportLimiter, validate(reportSchema), asyncHandler(controller.report));
router.get(
  "/admin/reports",
  requireModerator,
  validate(reportQuerySchema, "query"),
  asyncHandler(controller.listReports),
);
router.patch(
  "/admin/reports/:reportId",
  requireModerator,
  validate(reportReviewSchema),
  asyncHandler(controller.reviewReport),
);

module.exports = router;
