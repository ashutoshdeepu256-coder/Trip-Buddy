const { z } = require("zod");
const id = z.string().regex(/^[a-f\d]{24}$/i);
const pagination = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) });
const notificationParams = z.object({ notificationId: id }).strict();
const preferences = z.object({ categories: z.object({
  CONNECTIONS: z.boolean().optional(), MESSAGES: z.boolean().optional(), EXPENSES: z.boolean().optional(), PAYMENTS: z.boolean().optional(), SAFETY: z.boolean().optional(),
}).strict().refine((values) => Object.keys(values).length > 0) }).strict();
module.exports = { pagination, notificationParams, preferences };
