const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { asyncHandler, rateLimitHandler } = require("../utils/http");
const controller = require("../controllers/itinerary.controller");
const {
  generateSchema, idParamsSchema, listQuerySchema, updateSchema, dayParamsSchema,
  collaborationPolicySchema, collaboratorSchema, revokeCollaboratorSchema,
  editActivitySchema, deleteActivitySchema, reorderSchema, dayOrderSchema,
  addDaySchema, updateDaySchema, deleteDaySchema,
  historyQuerySchema, restoreSchema,
} = require("../validators/itinerary.validator");

const routes = express.Router();
const perUserKey = (req) => req.user._id.toString();
const generationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, keyGenerator: perUserKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
const regenerationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, keyGenerator: perUserKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, keyGenerator: perUserKey, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
routes.use(requireAuth);
routes.post("/generate", generationLimiter, validate(generateSchema), asyncHandler(controller.generate));
routes.get("/", validate(listQuerySchema, "query"), asyncHandler(controller.list));
routes.get("/shared", asyncHandler(controller.listShared));
routes.get("/:itineraryId", validate(idParamsSchema, "params"), asyncHandler(controller.get));
routes.get("/:itineraryId/shared", validate(idParamsSchema, "params"), asyncHandler(controller.shared));
routes.put("/:itineraryId/collaboration", writeLimiter, validate(idParamsSchema, "params"), validate(collaborationPolicySchema), asyncHandler(controller.setCollaboration));
routes.get("/:itineraryId/collaborators", validate(idParamsSchema, "params"), asyncHandler(controller.collaborators));
routes.put("/:itineraryId/collaborators", writeLimiter, validate(idParamsSchema, "params"), validate(collaboratorSchema), asyncHandler(controller.grantCollaborator));
routes.delete("/:itineraryId/collaborators", writeLimiter, validate(idParamsSchema, "params"), validate(revokeCollaboratorSchema), asyncHandler(controller.revokeCollaborator));
routes.get("/:itineraryId/history", validate(idParamsSchema, "params"), validate(historyQuerySchema, "query"), asyncHandler(controller.history));
routes.post("/:itineraryId/restore", writeLimiter, validate(idParamsSchema, "params"), validate(restoreSchema), asyncHandler(controller.restore));
routes.post("/:itineraryId/activities", writeLimiter, validate(idParamsSchema, "params"), validate(editActivitySchema), asyncHandler(controller.addActivity));
routes.patch("/:itineraryId/activities/:activityId", writeLimiter, validate(idParamsSchema.extend({ activityId: require("zod").z.string().regex(/^[a-f\d]{24}$/i) }), "params"), validate(editActivitySchema), asyncHandler(controller.updateActivity));
routes.delete("/:itineraryId/activities/:activityId", writeLimiter, validate(idParamsSchema.extend({ activityId: require("zod").z.string().regex(/^[a-f\d]{24}$/i) }), "params"), validate(deleteActivitySchema), asyncHandler(controller.removeActivity));
routes.put("/:itineraryId/activities/order", writeLimiter, validate(idParamsSchema, "params"), validate(reorderSchema), asyncHandler(controller.reorderActivities));
routes.put("/:itineraryId/days/order", writeLimiter, validate(idParamsSchema, "params"), validate(dayOrderSchema), asyncHandler(controller.reorderDays));
routes.post("/:itineraryId/days", writeLimiter, validate(idParamsSchema, "params"), validate(addDaySchema), asyncHandler(controller.addDay));
routes.patch("/:itineraryId/days/:dayId", writeLimiter, validate(idParamsSchema.extend({ dayId: require("zod").z.string().regex(/^[a-f\d]{24}$/i) }), "params"), validate(updateDaySchema), asyncHandler(controller.updateDay));
routes.delete("/:itineraryId/days/:dayId", writeLimiter, validate(idParamsSchema.extend({ dayId: require("zod").z.string().regex(/^[a-f\d]{24}$/i) }), "params"), validate(deleteDaySchema), asyncHandler(controller.removeDay));
routes.patch("/:itineraryId", validate(idParamsSchema, "params"), validate(updateSchema), asyncHandler(controller.update));
routes.post("/:itineraryId/days/:day/regenerate", regenerationLimiter, validate(dayParamsSchema, "params"), asyncHandler(controller.regenerateDay));
routes.post("/:itineraryId/days/:day/:section/regenerate", regenerationLimiter, validate(dayParamsSchema, "params"), asyncHandler(controller.regenerateDay));
routes.post("/:itineraryId/duplicate", validate(idParamsSchema, "params"), asyncHandler(controller.duplicate));
routes.post("/:itineraryId/archive", validate(idParamsSchema, "params"), asyncHandler(controller.archive));
routes.delete("/:itineraryId", validate(idParamsSchema, "params"), asyncHandler(controller.remove));

module.exports = routes;
