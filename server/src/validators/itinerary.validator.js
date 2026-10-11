const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const shortText = (max) => z.string().trim().min(1).max(max);
const costSchema = z.object({
  amount: z.number().finite().min(0).max(100000000).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();
const activitySchema = z.object({
  title: shortText(120),
  description: z.string().trim().max(500).default(""),
  durationMinutes: z.number().int().min(15).max(720),
  estimatedCost: costSchema,
  location: z.string().trim().max(160).default(""),
}).strict();
const sectionSchema = z.object({
  activities: z.array(activitySchema).max(5),
}).strict();
const daySchema = z.object({
  day: z.number().int().min(1).max(31),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  morning: sectionSchema,
  afternoon: sectionSchema,
  evening: sectionSchema,
  estimatedTotal: costSchema,
}).strict();
const planSchema = z.object({
  days: z.array(daySchema).min(1).max(31),
  budgetBreakdown: z.array(z.object({ category: shortText(60), estimatedCost: costSchema }).strict()).max(10),
  suggestions: z.array(z.string().trim().min(1).max(300)).max(10),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(10),
  unknowns: z.array(z.string().trim().min(1).max(300)).max(10),
  safetyNotes: z.array(z.string().trim().min(1).max(300)).max(10),
}).strict();
const preferences = z.object({
  interests: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  pace: z.enum(["RELAXED", "MODERATE", "FAST"]).default("MODERATE"),
  notes: z.string().trim().max(1000).default(""),
}).strict().default({});
const generateSchema = z.object({
  destination: shortText(160).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  title: z.string().trim().max(120).default(""),
  budget: z.object({ amount: z.number().finite().min(0).max(100000000).nullable().default(null), currency: z.string().regex(/^[A-Za-z]{3}$/).default("USD") }).strict().default({}),
  preferences,
  tripId: objectId.nullable().optional(),
}).strict().superRefine((input, context) => {
  if (!input.tripId && (!input.destination || !input.startDate || !input.endDate)) {
    context.addIssue({ code: "custom", path: ["destination"], message: "Destination and travel dates are required unless generating from an owned trip" });
    return;
  }
  if (!input.startDate || !input.endDate) return;
  const start = new Date(`${input.startDate}T00:00:00Z`);
  const end = new Date(`${input.endDate}T00:00:00Z`);
  const days = Math.round((end - start) / 86400000) + 1;
  if (end < start || days > 31) context.addIssue({ code: "custom", path: ["endDate"], message: "Choose a valid trip of 1 to 31 days" });
});
const idParamsSchema = z.object({ itineraryId: objectId });
const listQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(12), archived: z.enum(["true", "false"]).default("false") });
const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  budget: z.object({ amount: z.number().finite().min(0).max(100000000).nullable(), currency: z.string().regex(/^[A-Za-z]{3}$/) }).strict().optional(),
  preferences: preferences.optional(),
  plan: planSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
const dayParamsSchema = z.object({ itineraryId: objectId, day: z.coerce.number().int().min(1).max(31), section: z.enum(["morning", "afternoon", "evening"]).optional() });
const dayUpdateSchema = z.object({ day: daySchema }).strict();

module.exports = { generateSchema, idParamsSchema, listQuerySchema, updateSchema, dayParamsSchema, dayUpdateSchema, planSchema, daySchema };
