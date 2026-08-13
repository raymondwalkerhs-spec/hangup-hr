const WEAK_SECRETS = new Set(["hangup-hr-desktop-secret", "hangup-backup-secret", ""]);

function assertSessionSecret() {
  const secret = String(process.env.SESSION_SECRET || "").trim();
  let packaged = false;
  try {
    const { app } = require("electron");
    packaged = Boolean(app?.isPackaged);
  } catch {
    packaged = process.env.NODE_ENV === "production";
  }
  if (!packaged || process.env.HR_ALLOW_DEV_SECRETS === "1") return;
  if (WEAK_SECRETS.has(secret)) {
    throw new Error(
      "SESSION_SECRET must be set to a strong random value in .env before running a packaged build."
    );
  }
}

module.exports = { assertSessionSecret, WEAK_SECRETS };
