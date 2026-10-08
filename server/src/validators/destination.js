const { z } = require("zod");

const positiveInteger = (fallback, maximum) =>
  z.coerce.number().int().min(1).max(maximum).default(fallback);

const listingQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  q: z.string().trim().max(120).optional(),
  page: positiveInteger(1, 10000),
  limit: positiveInteger(12, 50),
  month: z.coerce.number().int().min(1).max(12).optional(),
  maxBudget: z.coerce.number().min(0).max(1000000).optional(),
  activity: z.string().trim().max(80).optional(),
  category: z
    .enum(["ADVENTURE", "BEACH", "CULTURE", "NATURE", "CITY"])
    .optional(),
  seasonal: z.enum(["true", "false"]).optional(),
});

const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(20000).default(100),
  page: positiveInteger(1, 10000),
  limit: positiveInteger(12, 50),
});

module.exports = { listingQuerySchema, nearbyQuerySchema };
