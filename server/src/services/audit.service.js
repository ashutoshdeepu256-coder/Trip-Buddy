const AuditLog = require("../models/AuditLog");

const recordAudit = (req, { action, resourceType, resourceId, metadata = {}, session = null }) =>
  AuditLog.create({
    actor: req.user?._id || null,
    action,
    resourceType,
    resourceId: resourceId || null,
    metadata,
    ip: req.ip,
    userAgent: req.get("user-agent")?.slice(0, 500) || null,
  }, session ? { session } : undefined);

module.exports = { recordAudit };
