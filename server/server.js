const dns = require("dns");

// Fix MongoDB Atlas SRV DNS resolution on local environment
dns.setServers([
  "8.8.8.8",
  "1.1.1.1"
]);

require("dotenv").config();

const http = require("http");
const app = require("./app");
const connectDB = require("./src/config/db");
const { createChatSocket } = require("./src/realtime/chat.socket");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error("JWT_SECRET must be configured with at least 32 characters");
    }
    await connectDB();

    const server = http.createServer(app);
    createChatSocket(server, app);

    server.listen(PORT, () => {
      console.log(`🚀 TripBuddy API running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to start TripBuddy:", error.message);
    process.exit(1);
  }
};

startServer();
