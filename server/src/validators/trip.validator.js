const { z } = require("zod");

const tripStatuses = ["DRAFT", "PUBLISHED", "PLANNING", "CONFIRMED", "ONGOING", "COMPLETED", "CANCELLED"];
const privacyValues = ["PUBLIC", "COMMUNITY", "PRIVATE", "INVITE_ONLY"];
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Enter a valid destination");
const dateValue = z.coerce.date();
const optionalDate = dateValue.nullable().optional();
const stringList = (values, maximum = 20) =>
  z.array(z.string().trim().min(1).max(60))
    .max(maximum)
    .default([])
    .transform((items) => [...new Map(items.map((item) => [item.toLocaleLowerCase(), item])).values()]);

const budgetSchema = z.object({
  min: z.coerce.number().min(0).nullable().optional(),
  max: z.coerce.number().min(0).nullable().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("USD"),
}).superRefine((budget, context) => {
  if (budget.min != null && budget.max != null && budget.max < budget.min) {
    context.addIssue({ code: "custom", path: ["max"], message: "Maximum budget must be at least the minimum" });
  }
});

const groupSizeSchema = z.object({
  min: z.coerce.number().int().min(1).max(100).default(1),
  max: z.coerce.number().int().min(1).max(100).default(1),
}).superRefine((groupSize, context) => {
  if (groupSize.max < groupSize.min) {
    context.addIssue({ code: "custom", path: ["max"], message: "Maximum group size must be at least the minimum" });
  }
});

const tripFields = {
  destination: objectId.nullable().optional(),
  title: z.string().trim().max(120).default(""),
  description: z.string().trim().max(4000).default(""),
  startDate: optionalDate,
  endDate: optionalDate,
  budget: budgetSchema.default({}),
  groupSize: groupSizeSchema.default({}),
  travelStyle: stringList(),
  interests: stringList(),
  activities: stringList(),
  accommodationPreference: stringList(),
  transportPreference: stringList(),
  foodPreference: stringList(),
  languages: stringList(10),
  privacy: z.enum(privacyValues).default("PUBLIC"),
  location: z.object({
    type: z.literal("Point").default("Point"),
    coordinates: z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ]),
  }).optional(),
};

const createTripSchema = z.object(tripFields).superRefine(validateDateOrder);
const updateTripSchema = z.object({
  ...tripFields,
  title: tripFields.title.optional(),
  description: tripFields.description.optional(),
  budget: budgetSchema.optional(),
  groupSize: groupSizeSchema.optional(),
  travelStyle: stringList().optional(),
  interests: stringList().optional(),
  activities: stringList().optional(),
  accommodationPreference: stringList().optional(),
  transportPreference: stringList().optional(),
  foodPreference: stringList().optional(),
  languages: stringList(10).optional(),
  privacy: z.enum(privacyValues).optional(),
  location: tripFields.location.optional(),
}).partial().superRefine(validateDateOrder);

const publishTripSchema = z.object({
  destination: objectId,
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(20).max(4000),
  startDate: dateValue,
  endDate: dateValue,
  budget: z.object({
    min: z.number().min(0),
    max: z.number().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  groupSize: z.object({
    min: z.number().int().min(1).max(100),
    max: z.number().int().min(1).max(100),
  }),
  privacy: z.enum(privacyValues),
}).superRefine((trip, context) => {
  validateDateOrder(trip, context);
  if (trip.startDate < startOfToday()) {
    context.addIssue({ code: "custom", path: ["startDate"], message: "Published trips must start today or later" });
  }
  if (trip.budget.max < trip.budget.min) {
    context.addIssue({ code: "custom", path: ["budget", "max"], message: "Maximum budget must be at least the minimum" });
  }
  if (trip.groupSize.max < trip.groupSize.min) {
    context.addIssue({ code: "custom", path: ["groupSize", "max"], message: "Maximum group size must be at least the minimum" });
  }
});

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function validateDateOrder(trip, context) {
  if (trip.startDate && trip.endDate && trip.endDate <= trip.startDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after start date" });
  }
}

const statusChangeSchema = z.object({
  status: z.enum(tripStatuses),
});

const listMyTripsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  status: z.enum(tripStatuses).optional(),
});

const tripIdParamSchema = z.object({
  tripId: objectId,
});

module.exports = {
  tripStatuses,
  privacyValues,
  createTripSchema,
  updateTripSchema,
  publishTripSchema,
  statusChangeSchema,
  listMyTripsQuerySchema,
  tripIdParamSchema,
  startOfToday,
};
