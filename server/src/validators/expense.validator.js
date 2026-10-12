const { z } = require("zod");
const { supportedCurrencies, MAX_MINOR_UNITS } = require("../utils/money");
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const minorUnits = z.number().int().safe().min(1).max(MAX_MINOR_UNITS);
const category = z.enum(["ACCOMMODATION", "TRANSPORT", "FOOD", "ACTIVITY", "OTHER"]);
const splitMethod = z.enum(["EQUAL", "EXACT", "PERCENTAGE", "WEIGHTED"]);
const splitParticipant = z.object({
  userId: objectId,
  amountMinorUnits: z.number().int().safe().min(0).max(MAX_MINOR_UNITS).optional(),
  basisPoints: z.number().int().min(1).max(10000).optional(),
  shares: z.number().int().min(1).max(1000000).optional(),
}).strict();
const createBody = z.object({
  description: z.string().trim().min(1).max(160),
  category,
  amountMinorUnits: minorUnits,
  currency: z.enum(supportedCurrencies),
  expenseDate: z.string().date(),
  splitMethod,
  participants: z.array(splitParticipant).min(1).max(100),
  privateNote: z.string().trim().max(1000).default(""),
}).strict();
const checkSplitShape = (input, context) => {
  const expected = { EQUAL: [], EXACT: ["amountMinorUnits"], PERCENTAGE: ["basisPoints"], WEIGHTED: ["shares"] }[input.splitMethod];
  input.participants.forEach((participant, index) => {
    for (const field of ["amountMinorUnits", "basisPoints", "shares"]) {
      if (expected.includes(field) !== (participant[field] !== undefined)) context.addIssue({ code: "custom", path: ["participants", index, field], message: "Split fields must match the selected method" });
    }
  });
};
const createSchema = createBody.superRefine(checkSplitShape);
const updateBody = z.object({
  expectedRevision: z.number().int().min(1),
  description: z.string().trim().min(1).max(160),
  category,
  amountMinorUnits: minorUnits,
  currency: z.enum(supportedCurrencies),
  expenseDate: z.string().date(),
  splitMethod,
  participants: z.array(splitParticipant).min(1).max(100),
  privateNote: z.string().trim().max(1000).default(""),
}).strict().superRefine(checkSplitShape);
const updateSchema = updateBody;
const pageQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20), includeVoided: z.enum(["true", "false"]).default("false") });
const tripParamsSchema = z.object({ tripId: objectId });
const expenseParamsSchema = z.object({ tripId: objectId, expenseId: objectId });
const voidSchema = z.object({ expectedRevision: z.number().int().min(1), reason: z.string().trim().min(1).max(240) }).strict();
const settlementCreateSchema = z.object({ toUserId: objectId, amountMinorUnits: minorUnits, currency: z.enum(supportedCurrencies), note: z.string().trim().max(240).default("") }).strict();
const settlementParamsSchema = z.object({ tripId: objectId, settlementId: objectId });
const settlementReverseSchema = z.object({ reason: z.string().trim().min(1).max(240) }).strict();
const settlementsQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) });
module.exports = { createSchema, updateSchema, pageQuerySchema, tripParamsSchema, expenseParamsSchema, voidSchema, settlementCreateSchema, settlementParamsSchema, settlementReverseSchema, settlementsQuerySchema };
