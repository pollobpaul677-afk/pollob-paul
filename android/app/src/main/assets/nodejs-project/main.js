/**
 * Embedded On-Device Node.js Engine for Android (nodejs-mobile / Capacitor)
 * Runs natively on the Android device using the phone's local network / cellular IP.
 */
const path = require("path");
const fs = require("fs");

console.log("[Android Node Engine] Initializing On-Device WhatsApp Backend...");

// Process environment configuration for Android sandbox
process.env.PORT = "3000";
process.env.NODE_ENV = "production";

// Locate bundled server or run main backend
try {
  // Check if bundled server exists
  const serverPath = path.join(__dirname, "server.cjs");
  if (fs.existsSync(serverPath)) {
    console.log("[Android Node Engine] Starting bundled server.cjs...");
    require(serverPath);
  } else {
    console.log("[Android Node Engine] Ready. Server bundle will execute on device boot.");
  }
} catch (err) {
  console.error("[Android Node Engine] Error launching server:", err);
}
