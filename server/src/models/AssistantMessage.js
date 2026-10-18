const mongoose = require("mongoose");

const sourceSchema = new mongoose.Schema({ label: { type: String, required: true, maxlength: 100 }, route: { type: String, required: true, maxlength: 240 }, kind: { type: String, enum: ["DESTINATION", "TRIP", "ITINERARY", "EXPENSES", "COMPATIBILITY", "PLANNER", "SAFETY", "MAPS"], required: true } }, { _id: false });
const assistantMessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "AssistantConversation", required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  role: { type: String, enum: ["USER", "ASSISTANT"], required: true },
  content: { type: String, required: true, maxlength: 6000 },
  requestId: { type: String, default: null, maxlength: 80 },
  processingStartedAt: { type: Date, default: null },
  responseToRequestId: { type: String, default: null, maxlength: 80 },
  source: { type: String, enum: ["USER", "GEMINI", "DETERMINISTIC_FALLBACK"], required: true },
  references: { type: [sourceSchema], default: [] },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

assistantMessageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });
assistantMessageSchema.index({ conversation: 1, requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
assistantMessageSchema.index({ conversation: 1, responseToRequestId: 1 }, { unique: true, partialFilterExpression: { responseToRequestId: { $type: "string" } } });
assistantMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.AssistantMessage || mongoose.model("AssistantMessage", assistantMessageSchema);
