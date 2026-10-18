const { z } = require("zod");

const sendOtpSchema = z.object({
  phone: z.string().trim().min(8).max(30),
});

const verifyOtpSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const reviewSchema = z.object({
  notes: z.string().trim().max(2000).optional().default(""),
});

const reportSchema = z.object({
  targetType: z.enum(["TRAVELLER", "TRIP", "MESSAGE", "REVIEW", "INCIDENT"]).optional().default("TRAVELLER"),
  reportedUserId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  targetId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  reason: z.enum([
    "SPAM",
    "HARASSMENT",
    "SCAM",
    "FAKE_PROFILE",
    "INAPPROPRIATE_CONTENT",
    "THREATS",
    "DISCRIMINATION",
    "UNSAFE_MEETING",
    "EMERGENCY",
    "SAFETY_CONCERN",
    "OTHER",
  ]),
  description: z.string().trim().min(10).max(3000),
  tripId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  messageId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
}).strict().superRefine((value, context) => {
  if (value.targetType === "INCIDENT" && (value.targetId || value.reportedUserId || value.tripId || value.messageId)) context.addIssue({ code: "custom", path: ["targetId"], message: "General incidents must not include a target reference" });
  if (value.targetType === "TRAVELLER" && (value.targetId || value.tripId || value.messageId)) context.addIssue({ code: "custom", path: ["targetId"], message: "Only a traveller reference is allowed for this report type" });
  if (value.targetType === "TRAVELLER" && !value.reportedUserId) context.addIssue({ code: "custom", path: ["reportedUserId"], message: "A traveller is required" });
  if (["TRIP", "MESSAGE", "REVIEW"].includes(value.targetType)) {
    const ref = value.targetId || (value.targetType === "TRIP" ? value.tripId : value.targetType === "MESSAGE" ? value.messageId : null);
    if (!ref) context.addIssue({ code: "custom", path: ["targetId"], message: "A target reference is required" });
  }
  if (value.targetType === "TRIP" && (value.reportedUserId || value.messageId)) context.addIssue({ code: "custom", path: ["targetId"], message: "Only a trip reference is allowed for this report type" });
  if (value.targetType === "MESSAGE" && (value.reportedUserId || value.tripId)) context.addIssue({ code: "custom", path: ["targetId"], message: "Only a message reference is allowed for this report type" });
  if (value.targetType === "REVIEW" && (value.reportedUserId || value.tripId || value.messageId)) context.addIssue({ code: "custom", path: ["targetId"], message: "Only a review reference is allowed for this report type" });
});

const adminListQuerySchema = z.object({
  status: z.enum(["PENDING", "VERIFIED", "REJECTED", "EXPIRED", "REVOKED"]).optional(),
  type: z.enum(["EMAIL", "PHONE", "IDENTITY"]).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

module.exports = { sendOtpSchema, verifyOtpSchema, reviewSchema, reportSchema, adminListQuerySchema };
