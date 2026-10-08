const { z } = require("zod");

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

const verifyEmailSchema = z.object({
  token: z.string().min(32).max(256),
});

const preferenceList = z.array(z.string().trim().min(1).max(80)).max(30).optional();
const budgetRangeSchema = z.object({
  min: z.number().min(0).nullable(),
  max: z.number().min(0).nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
}).strict().superRefine((range, context) => {
  if ((range.min === null) !== (range.max === null)) {
    context.addIssue({ code: "custom", path: ["max"], message: "Provide both budget range values or clear both" });
  }
  if (range.min !== null && range.max !== null && range.max < range.min) {
    context.addIssue({ code: "custom", path: ["max"], message: "Maximum budget must be at least the minimum" });
  }
});
const groupSizeRangeSchema = z.object({
  min: z.number().int().min(1).max(100).nullable(),
  max: z.number().int().min(1).max(100).nullable(),
}).strict().superRefine((range, context) => {
  if ((range.min === null) !== (range.max === null)) {
    context.addIssue({ code: "custom", path: ["max"], message: "Provide both group sizes or clear both" });
  }
  if (range.min !== null && range.max !== null && range.max < range.min) {
    context.addIssue({ code: "custom", path: ["max"], message: "Maximum group size must be at least the minimum" });
  }
});
const availabilitySchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).strict().superRefine((range, context) => {
  if (range.endDate < range.startDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "Availability end date must be on or after its start date" });
  }
});

const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    bio: z.string().trim().max(1000).optional(),
    city: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).optional(),
    travelPreferences: z
      .object({
        destinations: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
        excludedDestinations: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
        interests: preferenceList,
        activities: preferenceList,
        travelStyle: z.string().trim().max(80).optional(),
        budget: z.string().trim().max(80).optional(),
        groupPreference: z.string().trim().max(80).optional(),
        budgetRange: budgetRangeSchema.optional(),
        groupSizeRange: groupSizeRangeSchema.nullable().optional(),
        availability: availabilitySchema.nullable().optional(),
        dateFlexibilityDays: z.number().int().min(0).max(31).optional(),
        accommodationPreference: preferenceList,
        transportPreference: preferenceList,
        foodPreference: preferenceList,
        languages: preferenceList,
        travelPace: z.enum(["RELAXED", "MODERATE", "FAST", ""]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

module.exports = { registerSchema, loginSchema, verifyEmailSchema, profileSchema };
