const mongoose = require("mongoose");

const adminOperationGuardSchema = new mongoose.Schema({
  _id: { type: String, default: "admin-role-invariant" },
  revision: { type: Number, default: 0 },
}, { versionKey: false });

module.exports = mongoose.models.AdminOperationGuard || mongoose.model("AdminOperationGuard", adminOperationGuardSchema);
