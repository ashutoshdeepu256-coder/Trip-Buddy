const crypto = require("crypto");

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

const hashValue = (value) =>
  crypto.createHash("sha256").update(value, "utf8").digest("hex");

const getVerificationSecret = () => {
  const secret = process.env.VERIFICATION_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("VERIFICATION_SECRET or a 32-character JWT_SECRET is required");
  }
  return secret;
};

const hmacValue = (value) =>
  crypto
    .createHmac("sha256", getVerificationSecret())
    .update(value, "utf8")
    .digest("hex");

const hashOtp = (otp, salt) => hmacValue(`${salt}:${otp}`);

const safeCompare = (left, right) => {
  const leftBuffer = Buffer.from(left || "", "hex");
  const rightBuffer = Buffer.from(right || "", "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const normalizePhone = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
};

module.exports = {
  randomToken,
  hashValue,
  hashOtp,
  safeCompare,
  normalizePhone,
  hmacValue,
};
