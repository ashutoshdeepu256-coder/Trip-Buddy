const { z } = require("zod");

const matchIdParamsSchema = z.object({
  matchId: z.string().regex(/^[a-f\d]{24}$/i, "Enter a valid match ID"),
}).strict();

const matchesQuerySchema = z.object({
  page: z.preprocess((value) => value === undefined ? 1 : value, z.coerce.number().int().min(1).max(10000)),
  limit: z.preprocess((value) => value === undefined ? 20 : value, z.coerce.number().int().min(1).max(50)),
  status: z.enum(["CALCULATED", "VIEWED", "CONNECTED", "DISMISSED", "EXPIRED"]).optional(),
}).strict();

module.exports = { matchIdParamsSchema, matchesQuerySchema };
