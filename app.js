const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");

const apiRoutes = require("./routes/api");
const { assertSessionSecret } = require("./lib/assert-session-secret");

function createApp() {
  assertSessionSecret();
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "50mb" }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "hangup-hr-desktop-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: "lax" },
    })
  );
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https://*.supabase.co",
        "media-src 'self' blob:",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
        "frame-ancestors 'none'",
      ].join("; ")
    );
    next();
  });
  app.use(express.static(path.join(__dirname, "public")));
  const distPath = path.join(__dirname, "public", "dist");
  const hasReactBuild = fs.existsSync(path.join(distPath, "index.html"));
  if (hasReactBuild) {
    app.use(express.static(distPath));
  } else {
    console.warn(
      "[startup] public/dist/index.html is missing. The login screen will fall back to the legacy page. Run npm run build:web."
    );
  }
  app.use("/api", apiRoutes);
  app.use("/api/supabase", require("./routes/supabase"));
  // Start the shared Supabase Realtime -> SSE subscription for live attendance
  // and payroll updates (graceful no-op when Supabase isn't configured).
  try {
    require("./lib/live-sync").ensureStarted();
  } catch (e) {
    console.warn("[startup] live-sync unavailable:", e?.message || e);
  }
  try {
    require("./lib/training-phase-outcome-notify").startTrainingPhaseOutcomeNotifyLoop();
  } catch (e) {
    console.warn("[startup] training phase outcome notify unavailable:", e?.message || e);
  }
  try {
    require("./lib/role-permissions")
      .loadOverrides()
      .catch((err) => console.warn("[startup] RBAC preload:", err.message || err));
    require("./lib/user-permissions")
      .loadOverrides()
      .catch((err) => console.warn("[startup] user-permissions preload:", err.message || err));
    require("./lib/sales-action-permissions")
      .loadMap()
      .catch((err) => console.warn("[startup] sales-action-permissions preload:", err.message || err));
    require("./lib/sales-rpm-action-permissions")
      .loadMap()
      .catch((err) => console.warn("[startup] rpm-action-permissions preload:", err.message || err));
  } catch {
    /* non-fatal */
  }
  app.use((err, req, res, next) => {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  app.get("/login", (_req, res) => {
    const reactLogin = path.join(__dirname, "public", "dist", "index.html");
    if (fs.existsSync(reactLogin)) {
      return res.sendFile(reactLogin);
    }
    const legacyLogin = path.join(__dirname, "public", "login.legacy.html");
    const loginHtml = path.join(__dirname, "public", "login.html");
    if (fs.existsSync(loginHtml)) {
      return res.sendFile(loginHtml);
    }
    if (fs.existsSync(legacyLogin)) {
      return res.sendFile(legacyLogin);
    }
    res.status(404).send("Login page not found. Run npm run build:web to build the React UI.");
  });

  app.get("/", (_req, res) => {
    const reactIndex = path.join(__dirname, "public", "dist", "index.html");
    if (fs.existsSync(reactIndex)) {
      return res.sendFile(reactIndex);
    }
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  // SPA fallback for client-side routes (React Router)
  if (hasReactBuild) {
    app.get(/^\/(dashboard|announcements|cats|employees|org|equipment|interviews|training|coaching|attendance|breaks|requests|meeting-requests|it-requests|payroll|salaries|bonuses|deductions|loans|loan-approvals|payslip|sales|team-dashboard|costs|reports|analytics|users|access-control|sales-permissions|sales-log-columns|rules|changes|settings|backup|offboarding|clearance|recycle)(\/.*)?$/, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return app;
}

module.exports = { createApp };