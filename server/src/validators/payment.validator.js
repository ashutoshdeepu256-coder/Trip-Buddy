const { z } = require("zod");
const { MAX_MINOR_UNITS } = require("../utils/money");

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const createSchema = z.object({
  tripId: objectId,
  recipientUserId: objectId,
  amountMinorUnits: z.number().int().safe().min(100).max(MAX_MINOR_UNITS),
  currency: z.literal("INR"),
}).strict();
const paymentParamsSchema = z.object({ paymentId: objectId });
const verifySchema = z.object({
  razorpay_order_id: z.string().trim().min(8).max(80),
  razorpay_payment_id: z.string().trim().min(8).max(80),
  razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i),
}).strict();
const listSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) });
const refundSchema = z.object({ reason: z.string().trim().min(1).max(240) }).strict();

module.exports = { createSchema, paymentParamsSchema, verifySchema, listSchema, refundSchema };
