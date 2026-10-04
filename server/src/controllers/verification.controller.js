const { sendSuccess } = require("../utils/http");
const verificationService = require("../services/verification.service");
const { uploadIdentityDocument } = require("../services/identity-storage.service");

const status = async (req, res) =>
  sendSuccess(res, await verificationService.getVerificationStatus(req.user));

const history = async (req, res) =>
  sendSuccess(res, await verificationService.getVerificationHistory(req.user._id));

const sendPhoneOTP = async (req, res) => {
  const result = await verificationService.sendPhoneOTP(req.user, req.body.phone);
  const data = {
    expiresAt: result.expiresAt,
    resendAfterSeconds: result.resendAfterSeconds,
  };
  if (result.developmentCode) data.developmentCode = result.developmentCode;
  return sendSuccess(res, data, "Verification code sent", 202);
};

const verifyPhoneOTP = async (req, res) =>
  sendSuccess(
    res,
    await verificationService.verifyPhoneOTP(req.user, req.body.code, req),
    "Phone verified",
  );

const submitIdentity = async (req, res) =>
  sendSuccess(
    res,
    await verificationService.submitIdentityVerification(req.user, req),
    "Identity verification submitted for manual review",
    201,
  );

const identityStatus = async (req, res) =>
  sendSuccess(res, await verificationService.getIdentityStatus(req.user));

const uploadIdentity = async (req, res) => {
  if (!req.file) {
    const { HttpError } = require("../utils/http");
    throw new HttpError(400, "A supported identity document is required", "DOCUMENT_REQUIRED");
  }
  const file = req.file;
  const isPdf = file.mimetype === "application/pdf" && file.buffer.subarray(0, 5).toString() === "%PDF-";
  const isPng =
    file.mimetype === "image/png" &&
    file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg =
    file.mimetype === "image/jpeg" &&
    file.buffer[0] === 0xff &&
    file.buffer[1] === 0xd8 &&
    file.buffer[file.buffer.length - 2] === 0xff &&
    file.buffer[file.buffer.length - 1] === 0xd9;
  if (!isPdf && !isPng && !isJpeg) {
    const { HttpError } = require("../utils/http");
    throw new HttpError(400, "Only valid PDF, PNG, or JPEG documents are accepted", "INVALID_DOCUMENT_TYPE");
  }
  const result = await uploadIdentityDocument({ userId: req.user._id, file });
  return sendSuccess(res, result, "Identity document uploaded securely", 201);
};

module.exports = {
  status,
  history,
  sendPhoneOTP,
  verifyPhoneOTP,
  submitIdentity,
  identityStatus,
  uploadIdentity,
};
