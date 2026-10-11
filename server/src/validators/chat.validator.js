const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Enter a valid ID");
const conversationParamsSchema = z.object({ conversationId: objectId }).strict();
const directConversationSchema = z.object({ connectionId: objectId }).strict();
const tripConversationParamsSchema = z.object({ tripId: objectId }).strict();
const messageParamsSchema = z.object({ conversationId: objectId }).strict();
const paginationSchema = z.object({
  limit: z.preprocess((value) => value === undefined ? 30 : value, z.coerce.number().int().min(1).max(100)),
  before: objectId.optional(),
}).strict();
const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  idempotencyKey: z.string().trim().min(8).max(100).regex(/^[\w-]+$/),
}).strict();
const readSchema = z.object({ upToMessageId: objectId.optional() }).strict();
const listQuerySchema = z.object({
  page: z.preprocess((value) => value === undefined ? 1 : value, z.coerce.number().int().min(1).max(100000)),
  limit: z.preprocess((value) => value === undefined ? 20 : value, z.coerce.number().int().min(1).max(50)),
}).strict();
const socketMessageSchema = z.object({
  conversationId: objectId,
  text: z.string().trim().min(1).max(4000),
  idempotencyKey: z.string().trim().min(8).max(100).regex(/^[\w-]+$/),
}).strict();
const socketConversationSchema = z.object({ conversationId: objectId }).strict();
const socketReadSchema = socketConversationSchema.extend({ upToMessageId: objectId.optional() }).strict();
const typingSchema = socketConversationSchema.extend({ active: z.boolean() }).strict();

module.exports = {
  conversationParamsSchema,
  directConversationSchema,
  tripConversationParamsSchema,
  messageParamsSchema,
  paginationSchema,
  sendMessageSchema,
  readSchema,
  listQuerySchema,
  socketMessageSchema,
  socketConversationSchema,
  socketReadSchema,
  typingSchema,
};
