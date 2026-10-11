const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ["INVITED", "ACTIVE", "DECLINED"], required: true },
  joinedAt: { type: Date, default: null },
  lastReadAt: { type: Date, default: null },
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  type: { type: String, enum: ["DIRECT", "TRIP"], required: true },
  status: { type: String, enum: ["PENDING", "ACTIVE", "DECLINED", "REVOKED"], required: true },
  participants: { type: [participantSchema], default: [] },
  connection: { type: mongoose.Schema.Types.ObjectId, ref: "Connection", default: null },
  trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", default: null },
  activeKey: { type: String, default: null, maxlength: 150 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  lastMessageAt: { type: Date, default: null },
}, { timestamps: true });

conversationSchema.index(
  { activeKey: 1 },
  { unique: true, partialFilterExpression: { activeKey: { $type: "string" } } },
);
conversationSchema.index({ "participants.user": 1, status: 1, lastMessageAt: -1, updatedAt: -1 });
conversationSchema.index({ trip: 1, status: 1 });
conversationSchema.index({ connection: 1, type: 1, status: 1 });

module.exports = mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
