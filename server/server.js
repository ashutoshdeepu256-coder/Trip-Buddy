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

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    const server = http.createServer(app);

    server.listen(PORT, () => {
      console.log(`🚀 TripBuddy API running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to start TripBuddy:", error.message);
    process.exit(1);
  }
};

startServer();