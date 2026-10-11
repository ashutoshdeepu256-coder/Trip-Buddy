const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 },
  idempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 100 },
  deliveredTo: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  readBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
}, { timestamps: { createdAt: true, updatedAt: false } });

messageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });
messageSchema.index({ conversation: 1, sender: 1, createdAt: -1 });
messageSchema.index({ sender: 1, idempotencyKey: 1 }, { unique: true });
messageSchema.index({ conversation: 1, readBy: 1, sender: 1, createdAt: -1 });

module.exports = mongoose.models.Message || mongoose.model("Message", messageSchema);
