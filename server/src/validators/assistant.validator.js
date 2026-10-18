const { z } = require("zod");
const { generateSchema } = require("./itinerary.validator");

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const pagination = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
const plannerInputSchema = z.object({
  destination: z.string().trim().min(1).max(160), startDate: z.string().date(), endDate: z.string().date(), title: z.string().trim().max(120).optional(),
  budget: z.object({ amount: z.number().finite().min(0).max(100000000).nullable().optional(), currency: z.string().regex(/^[A-Za-z]{3}$/).optional() }).strict().optional(),
  preferences: z.object({ interests: z.array(z.string().trim().min(1).max(60)).max(20).optional(), pace: z.enum(["RELAXED", "MODERATE", "FAST"]).optional(), notes: z.string().trim().max(1000).optional() }).strict().optional(),
}).strict().superRefine((value, context) => {
  const parsed = generateSchema.safeParse(value);
  if (!parsed.success) context.addIssue({ code: "custom", path: ["endDate"], message: "The itinerary preview must meet the planner's date and input limits." });
});
const contextSchema = z.object({
  tripId: objectId.optional(),
  itineraryId: objectId.optional(),
  destinationQuery: z.string().trim().min(2).max(100).optional(),
  plannerInput: plannerInputSchema.optional(),
}).strict().optional();
const createConversation = z.object({ title: z.string().trim().min(1).max(100).optional() }).strict();
const conversationParams = z.object({ conversationId: objectId }).strict();
const sendMessage = z.object({
  content: z.string().trim().min(1).max(4000),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{12,80}$/),
  context: contextSchema,
}).strict();
const archiveConversation = z.object({ archived: z.boolean().default(true) }).strict();

module.exports = { pagination, contextSchema, createConversation, conversationParams, sendMessage, archiveConversation };
