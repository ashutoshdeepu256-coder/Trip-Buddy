const mongoose = require("mongoose");

const assistantConversationSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, trim: true, maxlength: 100, default: "New travel conversation" },
  messageCount: { type: Number, min: 0, max: 100, default: 0 },
  archivedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
  lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true });

assistantConversationSchema.index({ owner: 1, archivedAt: 1, lastMessageAt: -1, _id: -1 });
assistantConversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.AssistantConversation || mongoose.model("AssistantConversation", assistantConversationSchema);
