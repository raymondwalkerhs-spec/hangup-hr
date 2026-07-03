const path = require("path");
const fs = require("fs");

function loadEnvironment() {
  const candidates = [];

  if (process.env.HR_APP_ROOT) {
    candidates.push(path.join(process.env.HR_APP_ROOT, ".env"));
  }

  candidates.push(
    path.join(__dirname, "..", ".env"),
    path.join(process.cwd(), ".env")
  );

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, ".env"));
  }

  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, ".env"));
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, "HangupHR-data", ".env"));
  }

  const execDir = path.dirname(process.execPath || "");
  if (execDir) {
    candidates.push(path.join(execDir, ".env"));
  }

  try {
    const { app } = require("electron");
    if (app?.getAppPath) {
      candidates.push(path.join(app.getAppPath(), ".env"));
    }
  } catch {
    /* not in electron */
  }

  for (const envPath of candidates) {
    if (envPath && fs.existsSync(envPath)) {
      require("dotenv").config({ path: envPath });
      return envPath;
    }
  }

  return null;
}

function ensureCacheDirectory(explicitDir) {
  let dir = explicitDir || process.env.HR_CACHE_DIR;
  if (!dir) {
    dir = path.join(__dirname, "..", ".cache");
  }
  fs.mkdirSync(dir, { recursive: true });
  process.env.HR_CACHE_DIR = dir;
  return dir;
}

function assertSupabaseConfigured() {
  const { getBackendName } = require("./backend");
  const backend = getBackendName();
  if (backend === "sheets") {
    throw new Error(
      "DATA_BACKEND=sheets is no longer supported. Set DATA_BACKEND=supabase in .env. See LEGACY_GOOGLE_SHEETS.md."
    );
  }
  const { isSupabaseConfigured } = require("./supabase-client");
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL, SUPABASE_SECRET_KEY, and SUPABASE_PUBLISHABLE_KEY in .env."
    );
  }
}

module.exports = { loadEnvironment, ensureCacheDirectory, assertSupabaseConfigured };
