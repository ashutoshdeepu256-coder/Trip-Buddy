const express = require("express");
const controller = require("../controllers/admin-verification.controller");
const validate = require("../middleware/validate");
const { requireAuth, requireModerator } = require("../middleware/auth");
const { asyncHandler } = require("../utils/http");
const {
  reviewSchema,
  adminListQuerySchema,
} = require("../validators/verification");

const router = express.Router();

router.use(requireAuth, requireModerator);
router.get(
  "/",
  validate(adminListQuerySchema, "query"),
  asyncHandler(controller.list),
);
router.get("/:verificationId/document", asyncHandler(controller.document));
router.get("/:verificationId", asyncHandler(controller.detail));
router.post("/:verificationId/approve", validate(reviewSchema), asyncHandler(controller.approve));
router.post("/:verificationId/reject", validate(reviewSchema), asyncHandler(controller.reject));
router.post("/:verificationId/revoke", validate(reviewSchema), asyncHandler(controller.revoke));

module.exports = router;
