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

module.exports = { loadEnvironment, ensureCacheDirectory };
