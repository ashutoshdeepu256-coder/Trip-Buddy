const { sendSuccess } = require("../utils/http");
const verificationService = require("../services/verification.service");
const {
  streamIdentityDocument,
} = require("../services/identity-storage.service");

const list = async (req, res) =>
  sendSuccess(res, await verificationService.listAdminVerifications(req.validatedQuery));

const detail = async (req, res) =>
  sendSuccess(res, await verificationService.getAdminVerification(req.params.verificationId));

const approve = async (req, res) => {
  const result = await verificationService.reviewIdentity({
    id: req.params.verificationId,
    reviewer: req.user,
    decision: "VERIFIED",
    notes: req.body.notes,
    req,
  });
  return sendSuccess(res, result, "Identity verification approved");
};

const reject = async (req, res) => {
  const result = await verificationService.reviewIdentity({
    id: req.params.verificationId,
    reviewer: req.user,
    decision: "REJECTED",
    notes: req.body.notes,
    req,
  });
  return sendSuccess(res, result, "Identity verification rejected");
};

const revoke = async (req, res) => {
  const result = await verificationService.revokeVerification({
    id: req.params.verificationId,
    reviewer: req.user,
    notes: req.body.notes,
    req,
  });
  return sendSuccess(res, result, "Verification revoked");
};

const document = async (req, res) => {
  const assetId = await verificationService.getDocumentAssetId(req.params.verificationId);
  await streamIdentityDocument(assetId, res);
};

module.exports = { list, detail, approve, reject, revoke, document };
