const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const reviewParamsSchema = z.object({ reviewId: objectId });
const userParamsSchema = z.object({ userId: objectId });
const tripParamsSchema = z.object({ tripId: objectId });
const reportParamsSchema = z.object({ reportId: objectId });
const reviewBodySchema = z.object({
  tripId: objectId,
  revieweeId: objectId,
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().default(""),
}).strict();
const editBodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().default(""),
}).strict();
const reportBodySchema = z.object({
  reason: z.enum(["HARASSMENT", "SPAM", "PERSONAL_DATA", "FALSE_CLAIM", "OTHER"]),
  details: z.string().trim().max(1000).optional().default(""),
}).strict();
const moderateBodySchema = z.object({
  status: z.enum(["PUBLISHED", "HIDDEN", "REMOVED"]),
  reason: z.string().trim().min(1).max(500),
}).strict();
const reportListQuerySchema = pageQuerySchema.extend({ status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]).optional() });
const resolveReportBodySchema = z.object({
  status: z.enum(["RESOLVED", "DISMISSED"]),
  resolution: z.string().trim().min(1).max(1000),
}).strict();

module.exports = {
  pageQuerySchema, reviewParamsSchema, userParamsSchema, tripParamsSchema, reportParamsSchema,
  reviewBodySchema, editBodySchema, reportBodySchema, moderateBodySchema, reportListQuerySchema, resolveReportBodySchema,
};
