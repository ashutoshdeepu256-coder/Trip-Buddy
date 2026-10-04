const { HttpError } = require("../utils/http");

const sendThroughWebhook = async ({ url, apiKey, payload }) => {
  if (!url) return false;
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    throw new HttpError(503, "Verification delivery provider URL is invalid", "DELIVERY_NOT_CONFIGURED");
  }
  const localDevelopmentEndpoint =
    process.env.NODE_ENV !== "production" &&
    endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !localDevelopmentEndpoint) {
    throw new HttpError(503, "Verification delivery provider must use HTTPS", "DELIVERY_NOT_CONFIGURED");
  }
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new HttpError(502, "Verification delivery provider is unavailable", "DELIVERY_FAILED");
  }
  if (!response.ok) {
    throw new HttpError(502, "Verification delivery provider rejected the request", "DELIVERY_FAILED");
  }
  return true;
};

const sendEmailVerification = async ({ to, token }) => {
  const sent = await sendThroughWebhook({
    url: process.env.EMAIL_PROVIDER_WEBHOOK_URL,
    apiKey: process.env.EMAIL_PROVIDER_API_KEY,
    payload: {
      type: "email_verification",
      to,
      token,
      verificationUrl: `${process.env.CLIENT_URL || "http://localhost:5173"}/verify-email?token=${encodeURIComponent(token)}`,
    },
  });
  if (sent) return {};
  if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_VERIFICATION_CODES === "true") {
    return { developmentToken: token };
  }
  throw new HttpError(503, "Email delivery is not configured", "DELIVERY_NOT_CONFIGURED");
};

const sendPhoneOtp = async ({ to, otp }) => {
  const sent = await sendThroughWebhook({
    url: process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL,
    apiKey: process.env.PHONE_OTP_PROVIDER_API_KEY,
    payload: { type: "phone_otp", to, code: otp },
  });
  if (sent) return {};
  if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_VERIFICATION_CODES === "true") {
    return { developmentCode: otp };
  }
  throw new HttpError(503, "Phone OTP delivery is not configured", "DELIVERY_NOT_CONFIGURED");
};

module.exports = { sendEmailVerification, sendPhoneOtp };
