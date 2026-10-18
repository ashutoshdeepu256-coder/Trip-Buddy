const { z } = require("zod");

const id = z.string().regex(/^[a-f\d]{24}$/i);
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
const userQuery = pageQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]).optional(),
  role: z.enum(["USER", "MODERATOR", "ADMIN"]).optional(),
}).strict();
const tripQuery = pageQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "PLANNING", "CONFIRMED", "ONGOING", "COMPLETED", "CANCELLED"]).optional(),
}).strict();
const auditQuery = pageQuery.extend({
  action: z.string().trim().min(1).max(80).optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
}).strict();
const userParams = z.object({ userId: id }).strict();
const statusBody = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]),
  reason: z.string().trim().min(10).max(500),
}).strict();
const roleBody = z.object({
  role: z.enum(["USER", "MODERATOR", "ADMIN"]),
  reason: z.string().trim().min(10).max(500),
}).strict();

module.exports = { pageQuery, userQuery, tripQuery, auditQuery, userParams, statusBody, roleBody };
