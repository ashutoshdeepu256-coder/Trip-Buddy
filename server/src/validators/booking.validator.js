const { z } = require("zod");
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const date = z.string().date();
const idParamsSchema = z.object({ bookingId: objectId });
const listQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20), status: z.enum(["USER_RECORDED", "EXTERNAL_HANDOFF", "CANCELLED"]).optional() });
const categoryQuerySchema = z.object({ category: z.enum(["ACCOMMODATION", "TRANSPORT", "ACTIVITY"]).optional() });
const createSchema = z.object({
  serviceId: z.enum(["accommodation-search", "transport-search", "activity-search"]),
  mode: z.enum(["USER_RECORDED", "EXTERNAL_HANDOFF"]),
  serviceName: z.string().trim().min(1).max(160),
  destination: z.string().trim().min(1).max(160),
  startDate: date,
  endDate: date,
  travellers: z.number().int().min(1).max(20),
  tripId: objectId.nullable().optional(),
  itineraryId: objectId.nullable().optional(),
  userEstimate: z.object({ amount: z.number().finite().min(0).max(100000000), currency: z.string().regex(/^[A-Za-z]{3}$/) }).strict().nullable().optional(),
  travellerNote: z.string().trim().max(1000).default(""),
}).strict().superRefine((input, context) => {
  if (input.endDate < input.startDate) context.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after start date" });
  if (input.mode === "EXTERNAL_HANDOFF" && input.userEstimate) context.addIssue({ code: "custom", path: ["userEstimate"], message: "An external handoff cannot include a quoted price" });
});
const updateSchema = z.object({ travellerNote: z.string().trim().max(1000) }).strict();
module.exports = { idParamsSchema, listQuerySchema, categoryQuerySchema, createSchema, updateSchema };
