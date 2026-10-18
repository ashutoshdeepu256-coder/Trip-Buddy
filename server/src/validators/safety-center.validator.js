const { z } = require("zod");
const id = z.string().regex(/^[a-f\d]{24}$/i);
const contact = z.object({
  name: z.string().trim().min(2).max(80),
  relationship: z.string().trim().min(2).max(40),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use an international phone number such as +14155552671"),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional().default(""),
  primary: z.boolean().optional().default(false),
}).strict();
const contactParams = z.object({ contactId: id });
const tripParams = z.object({ tripId: id });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
const reportQuery = pageQuery.extend({
  status: z.enum(["SUBMITTED", "OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"]).optional(),
  targetType: z.enum(["TRAVELLER", "TRIP", "MESSAGE", "REVIEW", "INCIDENT"]).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
}).strict().refine((value) => !value.createdFrom || !value.createdTo || value.createdFrom <= value.createdTo, { message: "Invalid date range" });
const moderatorUpdate = z.object({ status: z.enum(["UNDER_REVIEW", "RESOLVED", "DISMISSED"]), moderatorNotes: z.string().trim().max(2000).optional().default("") }).strict();
const preferences = z.object({ discoverable: z.boolean().optional(), allowConnectionRequests: z.boolean().optional() }).strict().refine((v) => Object.keys(v).length > 0);
const tripSafety = z.object({
  meetingPoint: z.string().trim().max(500).optional(),
  checklist: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  emergencyNotes: z.string().trim().max(2000).optional(),
}).strict().refine((v) => Object.keys(v).length > 0);
module.exports = { contact, contactParams, tripParams, pageQuery, reportQuery, moderatorUpdate, preferences, tripSafety };
