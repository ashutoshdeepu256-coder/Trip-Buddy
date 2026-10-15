const Razorpay = require("razorpay");

const timeoutMs = 9000;
let cached;

const configuration = () => ({
  keyId: process.env.RAZORPAY_KEY_ID?.trim() || "",
  keySecret: process.env.RAZORPAY_KEY_SECRET || "",
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  mode: process.env.RAZORPAY_MODE?.trim().toLowerCase() || "test",
  routeEnabled: process.env.RAZORPAY_ROUTE_ENABLED === "true",
});

const isConfigured = () => {
  const config = configuration();
  return Boolean(config.keyId && config.keySecret && ["test", "live"].includes(config.mode) && (config.mode !== "live" || process.env.NODE_ENV === "production"));
};

const getProvider = () => {
  if (!isConfigured()) {
    const config = configuration();
    if (config.mode === "live" && process.env.NODE_ENV !== "production") throw new Error("Live Razorpay mode is disabled outside production");
    throw new Error("Razorpay credentials or a valid provider mode are not configured");
  }
  if (!cached) {
    const config = configuration();
    cached = new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
    // The SDK currently exposes its Axios client here; pin a bounded timeout for outbound calls.
    cached.api.rq.defaults.timeout = timeoutMs;
  }
  return cached;
};

const resetProvider = () => { cached = undefined; };
module.exports = { configuration, isConfigured, getProvider, resetProvider, timeoutMs };
