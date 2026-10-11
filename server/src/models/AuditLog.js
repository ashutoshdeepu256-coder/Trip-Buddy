const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    action: {
      type: String,
      enum: [
        "EMAIL_VERIFIED",
        "PHONE_VERIFIED",
        "IDENTITY_SUBMITTED",
        "IDENTITY_APPROVED",
        "IDENTITY_REJECTED",
        "IDENTITY_REVOKED",
        "USER_BLOCKED",
        "USER_UNBLOCKED",
        "USER_REPORTED",
        "GROUP_RECOMMENDATION_GENERATED",
        "GROUP_RECOMMENDATION_ACCEPTED",
        "GROUP_RECOMMENDATION_REJECTED",
        "CONNECTION_REQUESTED",
        "CONNECTION_ACCEPTED",
        "CONNECTION_REJECTED",
        "CONNECTION_CANCELLED",
        "CONNECTION_UNMATCHED",
        "CHAT_CONVERSATION_CREATED",
        "CHAT_MESSAGE_SENT",
        "ITINERARY_GENERATED",
        "ITINERARY_UPDATED",
        "ITINERARY_ARCHIVED",
        "ITINERARY_DELETED",
        "ITINERARY_DUPLICATED",
        "ITINERARY_COLLABORATION_ENABLED",
        "ITINERARY_COLLABORATION_DISABLED",
        "ITINERARY_COLLABORATOR_GRANTED",
        "ITINERARY_COLLABORATOR_REVOKED",
        "ITINERARY_ACTIVITY_ADDED",
        "ITINERARY_ACTIVITY_UPDATED",
        "ITINERARY_ACTIVITY_REMOVED",
        "ITINERARY_DAY_ADDED",
        "ITINERARY_DAY_UPDATED",
        "ITINERARY_DAY_REMOVED",
        "ITINERARY_ACTIVITIES_REORDERED",
        "ITINERARY_DAYS_REORDERED",
        "ITINERARY_REVISION_RESTORED",
        "ADMIN_ACTION",
      ],
      required: true,
    },
    resourceType: { type: String, required: true, maxlength: 80 },
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    ip: { type: String, maxlength: 64, default: null },
    userAgent: { type: String, maxlength: 500, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
