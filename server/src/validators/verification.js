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
  reportedUserId: z.string().regex(/^[a-f\d]{24}$/i),
  reason: z.enum([
    "SPAM",
    "HARASSMENT",
    "SCAM",
    "FAKE_PROFILE",
    "INAPPROPRIATE_CONTENT",
    "SAFETY_CONCERN",
    "OTHER",
  ]),
  description: z.string().trim().max(3000).optional().default(""),
  tripId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  messageId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

const adminListQuerySchema = z.object({
  status: z.enum(["PENDING", "VERIFIED", "REJECTED", "EXPIRED", "REVOKED"]).optional(),
  type: z.enum(["EMAIL", "PHONE", "IDENTITY"]).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

module.exports = { sendOtpSchema, verifyOtpSchema, reviewSchema, reportSchema, adminListQuerySchema };
