const express = require("express");
const controller = require("../controllers/review.controller");
const { requireAuth, requireModerator } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler } = require("../utils/http");
const { reviewParamsSchema, reportParamsSchema, reportListQuerySchema, moderateBodySchema, resolveReportBodySchema } = require("../validators/review.validator");

const router = express.Router();
router.use(requireAuth, requireModerator);
router.get("/reports", validate(reportListQuerySchema, "query"), asyncHandler(controller.listReports));
router.patch("/reports/:reportId", validate(reportParamsSchema, "params"), validate(resolveReportBodySchema), asyncHandler(controller.resolveReport));
router.patch("/:reviewId", validate(reviewParamsSchema, "params"), validate(moderateBodySchema), asyncHandler(controller.moderate));

module.exports = router;
