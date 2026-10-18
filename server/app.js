const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const { HttpError, rateLimitHandler } = require("./src/utils/http");
const authRoutes = require("./src/routes/auth.routes");
const profileRoutes = require("./src/routes/profile.routes");
const verificationRoutes = require("./src/routes/verification.routes");
const adminVerificationRoutes = require("./src/routes/admin-verification.routes");
const safetyRoutes = require("./src/routes/safety.routes");
const destinationRoutes = require("./src/routes/destination.routes");
const tripRoutes = require("./src/routes/trip.routes");
const tripDiscoveryRoutes = require("./src/routes/tripDiscovery.routes");
const matchRoutes = require("./src/routes/match.routes");
const groupRecommendationRoutes = require("./src/routes/groupRecommendation.routes");
const connectionRoutes = require("./src/routes/connection.routes");
const chatRoutes = require("./src/routes/chat.routes");
const itineraryRoutes = require("./src/routes/itinerary.routes");
const mapsRoutes = require("./src/routes/maps.routes");
const bookingRoutes = require("./src/routes/booking.routes");
const expenseRoutes = require("./src/routes/expense.routes");
const paymentRoutes = require("./src/routes/payment.routes");
const reviewRoutes = require("./src/routes/review.routes");
const adminReviewRoutes = require("./src/routes/admin-review.routes");
const notificationRoutes = require("./src/routes/notification.routes");

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "https://checkout.razorpay.com"],
      "frame-src": ["'self'", "https://api.razorpay.com", "https://*.razorpay.com"],
      "connect-src": ["'self'", "https://api.razorpay.com", "https://*.razorpay.com"],
      "form-action": ["'self'", "https://api.razorpay.com", "https://*.razorpay.com"],
    },
  },
}));

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);

// Razorpay signs exact bytes; consume its webhook before any JSON body parser.
app.use("/api/v1/payments/webhooks/razorpay", express.raw({ type: "application/json", limit: "64kb" }), paymentRoutes.webhookRoutes);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

app.use("/api", apiLimiter);

app.get("/api/v1/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "TripBuddy API is running",
    data: {
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    }
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", profileRoutes);
app.use("/api/v1/verifications", verificationRoutes);
app.use("/api/v1/admin/verifications", adminVerificationRoutes);
app.use("/api/v1/safety", safetyRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/destinations", destinationRoutes);
app.use("/api/v1/maps", mapsRoutes);
app.use("/api/v1", matchRoutes);
app.use("/api/v1", groupRecommendationRoutes);
app.use("/api/v1", connectionRoutes);
app.use("/api/v1/chat", chatRoutes);
app.use("/api/v1/itineraries", itineraryRoutes);
app.use("/api/v1/bookings", bookingRoutes);
app.use("/api/v1/expenses", expenseRoutes);
app.use("/api/v1/payments", paymentRoutes.routes);
app.use("/api/v1/reviews", reviewRoutes);
app.use("/api/v1/admin/reviews", adminReviewRoutes);
app.use("/api/v1", tripDiscoveryRoutes);
app.use("/api/v1", tripRoutes);

app.use((req, _res, next) => {
  next(new HttpError(404, "Route was not found", "NOT_FOUND"));
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  const statusCode =
    error.statusCode ||
    (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error.name)
      ? 401
      : error.name === "MulterError"
        ? error.code === "LIMIT_FILE_SIZE"
          ? 413
          : 400
        : error.name === "CastError"
          ? 400
          : error.code === 11000
            ? 409
            : 500);
  const code =
    error.code && typeof error.code === "string"
      ? error.code
      : error.name === "CastError"
        ? "INVALID_ID"
        : error.code === 11000
          ? "DUPLICATE_RESOURCE"
          : "INTERNAL_ERROR";
  const message =
    statusCode >= 500 ? "An unexpected server error occurred" : error.message;
  if (statusCode >= 500 && !(error instanceof HttpError)) {
    console.error("API request failed:", { name: error.name, code });
  }
  res.status(statusCode).json({
    success: false,
    error: { code, message, ...(error.details ? { details: error.details } : {}) },
  });
});

module.exports = app;
