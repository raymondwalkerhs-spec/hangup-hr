const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const path = require("path");
const { assertSessionSecret } = require("./lib/assert-session-secret");

function createBackupApp() {
  assertSessionSecret();
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "hangup-backup-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true, sameSite: "lax" },
    })
  );
  app.use("/css", express.static(path.join(__dirname, "public", "css")));
  app.use("/js", express.static(path.join(__dirname, "public", "js")));
  app.use("/img", express.static(path.join(__dirname, "public", "img")));
  app.use("/api/backup", require("./routes/backup-api"));
  app.get("/login", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "backup", "login.html"));
  });
  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "backup", "index.html"));
  });
  app.use((err, _req, res) => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
  return app;
}

module.exports = { createBackupApp };
