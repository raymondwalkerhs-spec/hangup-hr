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

  // Google OAuth browser callback (public) — stores code for the Electron window to poll.
  const oauthPending = require("./lib/oauth-pending-store");
  app.get("/auth/callback", (req, res) => {
    const code = String(req.query.code || "").trim();
    const error = String(req.query.error_description || req.query.error || "").trim();
    const modeQ = String(req.query.mode || "").trim();
    const modeCookie = String(req.cookies?.hr_oauth_mode || "").trim();
    const mode = modeQ || modeCookie || oauthPending.getPendingMode() || "cold";
    if (code || error) {
      oauthPending.completeOauthFromCallback({ code, error, mode });
    }
    const already = error && /already linked/i.test(error);
    res.status(200).type("html").send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Hangup Portal</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;background:#1a1520;color:#f6f1ef;
  display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{max-width:28rem;padding:2rem;text-align:center;line-height:1.45}
</style></head><body><div class="box">
  <h1>${error && !already ? "Google sign-in failed" : "Return to Hangup Portal"}</h1>
  <p>${
    already
      ? "Google is already connected. Go back to the Hangup window — it will finish linking automatically."
      : error
        ? error
        : "Signed in with Google. Return to the Hangup Portal window — it should continue automatically. You can close this browser tab."
  }</p>
</div>
<script>try{window.close()}catch(e){}</script>
</body></html>`);
  });

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
    try {
      require("./lib/office-po-overdue-notify").startOfficePoOverdueNotifyLoop();
    } catch (err) {
      console.warn("[office-po-overdue] loop start failed:", err.message);
    }
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

  // SPA fallback for React Router paths (auth gates + app pages).
  // Keep this after static + /api so real files and APIs win first.
  if (hasReactBuild) {
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      if (path.extname(req.path)) return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return app;
}

module.exports = { createApp };