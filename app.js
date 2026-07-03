const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const path = require("path");

const apiRoutes = require("./routes/api");

function createApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "20mb" }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "hangup-hr-desktop-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true },
    })
  );
  app.use(express.static(path.join(__dirname, "public")));
  app.use("/api", apiRoutes);
  app.use("/api/supabase", require("./routes/supabase"));
  try {
    require("./lib/role-permissions")
      .loadOverrides()
      .catch((err) => console.warn("[startup] RBAC preload:", err.message || err));
    require("./lib/user-permissions")
      .loadOverrides()
      .catch((err) => console.warn("[startup] user-permissions preload:", err.message || err));
  } catch {
    /* non-fatal */
  }
  app.use((err, req, res, next) => {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  app.get("/login", (req, res) => {
    if (req.session?.appSessionId) return res.redirect("/");
    res.sendFile(path.join(__dirname, "public", "login.html"));
  });

  app.get("/", (req, res) => {
    if (!req.session?.appSessionId) return res.redirect("/login");
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  return app;
}

module.exports = { createApp };
