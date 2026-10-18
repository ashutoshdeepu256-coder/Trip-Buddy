const mongoose = require("mongoose");

const emergencyContactSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  relationship: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
  phone: { type: String, required: true, trim: true, match: /^\+[1-9]\d{7,14}$/ },
  email: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
  primary: { type: Boolean, default: false },
}, { timestamps: true });

emergencyContactSchema.index({ user: 1, createdAt: 1 });

module.exports = mongoose.models.EmergencyContact || mongoose.model("EmergencyContact", emergencyContactSchema);
