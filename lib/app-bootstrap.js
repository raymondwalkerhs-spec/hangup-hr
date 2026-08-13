const path = require("path");
const fs = require("fs");
const os = require("os");

const PRODUCT_NAME = "Hangup Portal";
const USER_DATA_SUBDIR = "HangupHR-data";

function resolveUserEnvDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, USER_DATA_SUBDIR);
  }

  try {
    const { app } = require("electron");
    if (app?.getPath) {
      return path.join(app.getPath("userData"), USER_DATA_SUBDIR);
    }
  } catch {
    /* not in electron */
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, PRODUCT_NAME, USER_DATA_SUBDIR);
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      PRODUCT_NAME,
      USER_DATA_SUBDIR
    );
  }
  return path.join(os.homedir(), ".config", PRODUCT_NAME, USER_DATA_SUBDIR);
}

function getUserEnvPath() {
  return path.join(resolveUserEnvDir(), ".env");
}

function readEnvValue(raw, key) {
  const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)\\s*$`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function isUsableEnvFile(envPath) {
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    const url = readEnvValue(raw, "SUPABASE_URL");
    const secret = readEnvValue(raw, "SUPABASE_SECRET_KEY");
    const publishable = readEnvValue(raw, "SUPABASE_PUBLISHABLE_KEY");
    if (!url || (!secret && !publishable)) return false;
    const combined = `${url} ${secret} ${publishable}`.toLowerCase();
    const placeholders = [
      "your-project",
      "your_sb_",
      "change-this-to-a-long-random-string",
      "your_personal_access_token",
    ];
    return !placeholders.some((token) => combined.includes(token));
  } catch {
    return false;
  }
}

function listBundledEnvSources() {
  const sources = [];
  if (process.resourcesPath) {
    sources.push(path.join(process.resourcesPath, ".env"));
    sources.push(path.join(process.resourcesPath, ".env.example"));
  }
  try {
    const { app } = require("electron");
    if (app?.getAppPath) {
      sources.push(path.join(app.getAppPath(), ".env"));
      sources.push(path.join(app.getAppPath(), ".env.example"));
    }
  } catch {
    /* not in electron */
  }
  sources.push(path.join(__dirname, "..", ".env"));
  sources.push(path.join(__dirname, "..", ".env.example"));
  return [...new Set(sources.filter(Boolean))];
}

function listLegacyEnvSources(userEnvPath) {
  const sources = [];
  if (process.resourcesPath) {
    sources.push(path.join(process.resourcesPath, ".env"));
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    sources.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, ".env"));
    sources.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, USER_DATA_SUBDIR, ".env"));
  }
  try {
    const { app } = require("electron");
    if (app?.getPath) {
      sources.push(path.join(app.getPath("userData"), ".env"));
    }
  } catch {
    /* not in electron */
  }
  const execDir = path.dirname(process.execPath || "");
  if (execDir) {
    sources.push(path.join(execDir, ".env"));
  }
  return [...new Set(sources.filter((p) => p && p !== userEnvPath && fs.existsSync(p)))];
}

function copyEnvFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return target;
}

function ensureUserEnvFile() {
  const userEnvPath = getUserEnvPath();
  fs.mkdirSync(path.dirname(userEnvPath), { recursive: true });

  if (fs.existsSync(userEnvPath)) {
    return userEnvPath;
  }

  for (const legacyPath of listLegacyEnvSources(userEnvPath)) {
    if (isUsableEnvFile(legacyPath)) {
      return copyEnvFile(legacyPath, userEnvPath);
    }
  }

  const bundled = listBundledEnvSources().filter((p) => fs.existsSync(p));
  for (const source of bundled) {
    if (isUsableEnvFile(source)) {
      return copyEnvFile(source, userEnvPath);
    }
  }
  for (const source of bundled) {
    return copyEnvFile(source, userEnvPath);
  }

  return null;
}

function loadEnvironment() {
  ensureUserEnvFile();

  const candidates = [];

  if (process.env.HR_APP_ROOT) {
    candidates.push(path.join(process.env.HR_APP_ROOT, ".env"));
  }

  candidates.push(getUserEnvPath());

  try {
    const { app } = require("electron");
    if (app?.getPath) {
      candidates.push(path.join(app.getPath("userData"), USER_DATA_SUBDIR, ".env"));
    }
  } catch {
    /* not in electron */
  }

  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, USER_DATA_SUBDIR, ".env"));
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, ".env"));
  }

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, ".env"));
  }

  const execDir = path.dirname(process.execPath || "");
  if (execDir) {
    candidates.push(path.join(execDir, ".env"));
  }

  candidates.push(
    path.join(__dirname, "..", ".env"),
    path.join(process.cwd(), ".env")
  );

  try {
    const { app } = require("electron");
    if (app?.getAppPath) {
      candidates.push(path.join(app.getAppPath(), ".env"));
    }
  } catch {
    /* not in electron */
  }

  const seen = new Set();
  for (const envPath of candidates) {
    if (!envPath || seen.has(envPath)) continue;
    seen.add(envPath);
    if (fs.existsSync(envPath)) {
      require("dotenv").config({ path: envPath });
      return envPath;
    }
  }

  return null;
}

function ensureCacheDirectory(explicitDir) {
  let dir = explicitDir || process.env.HR_CACHE_DIR;
  if (!dir) {
    try {
      const { app } = require("electron");
      if (app?.getPath) {
        dir = path.join(app.getPath("userData"), USER_DATA_SUBDIR, "cache");
      }
    } catch {
      /* not in electron */
    }
  }
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
    const envPath = getUserEnvPath();
    throw new Error(
      `Supabase is not configured. Set SUPABASE_URL, SUPABASE_SECRET_KEY, and SUPABASE_PUBLISHABLE_KEY in:\n${envPath}\n\nOn first install the app copies settings from the installer when available. If you still see this message, paste your Supabase keys into that file and restart.`
    );
  }
}

module.exports = {
  loadEnvironment,
  ensureUserEnvFile,
  getUserEnvPath,
  ensureCacheDirectory,
  assertSupabaseConfigured,
};
