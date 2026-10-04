class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const sendSuccess = (res, data, message = "Success", status = 200) =>
  res.status(status).json({ success: true, message, data });

const rateLimitHandler = (_req, res) =>
  res.status(429).json({
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
  });

module.exports = { HttpError, asyncHandler, sendSuccess, rateLimitHandler };
