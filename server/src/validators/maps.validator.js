const { z } = require("zod");

const coordinate = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
});

const geocodeQuerySchema = z.object({ query: z.string().trim().min(2).max(160) }).strict();
const reverseQuerySchema = coordinate.strict();
const routeBodySchema = z.object({
  profile: z.enum(["driving", "walking", "cycling"]).default("driving"),
  waypoints: z.array(coordinate).min(2).max(6),
}).strict();
const distanceBodySchema = z.object({ from: coordinate, to: coordinate }).strict();

module.exports = { geocodeQuerySchema, reverseQuerySchema, routeBodySchema, distanceBodySchema };
