const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Enter a valid ID");
const connectionIdParamsSchema = z.object({ connectionId: objectId }).strict();
const createConnectionSchema = z.object({
  recipientId: objectId,
  tripId: objectId.optional(),
}).strict();
const connectionsQuerySchema = z.object({
  page: z.preprocess((value) => value === undefined ? 1 : value, z.coerce.number().int().min(1).max(10000)),
  limit: z.preprocess((value) => value === undefined ? 20 : value, z.coerce.number().int().min(1).max(50)),
}).strict();

module.exports = { connectionIdParamsSchema, createConnectionSchema, connectionsQuerySchema };
