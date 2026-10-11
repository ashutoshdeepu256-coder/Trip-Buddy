const { z } = require("zod");

const recommendationIdParamsSchema = z.object({
  recommendationId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid recommendation ID"),
}).strict();

module.exports = { recommendationIdParamsSchema };
