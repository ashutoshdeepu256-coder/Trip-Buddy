const express = require("express");
const controller = require("../controllers/profile.controller");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../utils/http");
const { profileSchema } = require("../validators/auth");

const router = express.Router();

router.get("/me", requireAuth, asyncHandler(controller.currentProfile));
router.patch("/me", requireAuth, validate(profileSchema), asyncHandler(controller.updateProfile));
router.get("/:userId", asyncHandler(controller.publicProfile));

module.exports = router;
