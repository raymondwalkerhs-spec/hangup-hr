/**
 * GitHub Releases updater — prefers patch zips (changed files only), falls back to full zip.
 * Configure GITHUB_UPDATES_REPO=owner/repo in .env (packaged via extraResources).
 */
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { compareVersions, getAppVersion } = require("./app-version");

const SKIP_DIRS = new Set(["hanguphr-data", "hangup hr-data", "hr-cache", ".cache"]);
const SKIP_FILES = new Set([".env", "update-info.json"]);

function getRepo() {
  return String(process.env.GITHUB_UPDATES_REPO || "").trim();
}

function getInstallRoot() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (process.platform === "darwin" && process.execPath.includes(".app/")) {
    const contents = process.execPath.split(".app/")[0] + ".app/Contents";
    return contents;
  }
  return path.dirname(process.execPath);
}

function platformAssetSuffix() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return `mac-${arch}`;
  if (process.platform === "win32") return "win-x64";
  return `${process.platform}-${arch}`;
}

function escVersion(v) {
  return String(v || "").replace(/\./g, "\\.");
}

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (!loc) return reject(new Error("Redirect without location"));
        fetchJson(loc, headers).then(resolve).catch(reject);
        return;
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("Request timeout")));
  });
}

function downloadFile(url, destPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    const req = lib.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlink(destPath, () => {});
        const loc = res.headers.location;
        if (!loc) return reject(new Error("Redirect without location"));
        downloadFile(loc, destPath, headers).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`Download failed HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve(destPath)));
    });
    req.on("error", (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function githubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Hangup-HR-Updater",
  };
  const token = process.env.GITHUB_UPDATES_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function pickReleaseAsset(release, latestVersion, currentVersion) {
  const suffix = platformAssetSuffix();
  const assets = release.assets || [];
  const latestEsc = escVersion(latestVersion);
  const currentEsc = escVersion(currentVersion);

  const patchExact = assets.find((a) =>
    new RegExp(`hangup-hr-${latestEsc}-${suffix}-patch-from-${currentEsc}\\.zip$`, "i").test(a.name)
  );
  if (patchExact) {
    return {
      asset: patchExact,
      updateType: "patch",
      fromVersion: currentVersion,
    };
  }

  const patchAny = assets.find(
    (a) =>
      new RegExp(`hangup-hr-.*-${suffix}-patch-from-${currentEsc}\\.zip$`, "i").test(a.name) &&
      !/full\.zip$/i.test(a.name)
  );
  if (patchAny) {
    const m = patchAny.name.match(/patch-from-(.+)\.zip$/i);
    return {
      asset: patchAny,
      updateType: "patch",
      fromVersion: m ? m[1] : currentVersion,
    };
  }

  const fullPatterns = [
    new RegExp(`hangup-hr-${latestEsc}-${suffix}-full\\.zip$`, "i"),
    new RegExp(`hangup-hr-${latestEsc}-${suffix}\\.zip$`, "i"),
  ];
  for (const re of fullPatterns) {
    const hit = assets.find((a) => re.test(a.name) && !/patch/i.test(a.name));
    if (hit) return { asset: hit, updateType: "full", fromVersion: null };
  }

  const legacy = assets.find(
    (a) => new RegExp(`${suffix}\\.zip$`, "i").test(a.name) && !/patch/i.test(a.name)
  );
  if (legacy) return { asset: legacy, updateType: "full", fromVersion: null };

  return { asset: null, updateType: null, fromVersion: null };
}

async function checkForGitHubUpdate() {
  const repo = getRepo();
  if (!repo) {
    return { enabled: false, reason: "GITHUB_UPDATES_REPO not configured" };
  }

  const current = getAppVersion();
  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`, githubHeaders());
  const latest = String(release.tag_name || release.name || "").replace(/^v/i, "").trim();
  if (!latest) return { enabled: true, current, latest: null, updateAvailable: false };

  const picked = pickReleaseAsset(release, latest, current);
  const updateAvailable = compareVersions(current, latest) < 0;

  return {
    enabled: true,
    current,
    latest,
    updateAvailable,
    updateType: picked.updateType,
    fromVersion: picked.fromVersion,
    releaseNotes: release.body || "",
    assetName: picked.asset?.name || null,
    assetUrl: picked.asset?.browser_download_url || null,
    assetSize: picked.asset?.size || 0,
    publishedAt: release.published_at || null,
  };
}

function shouldSkipEntry(name, relPath) {
  const lower = String(name || "").toLowerCase();
  if (SKIP_DIRS.has(lower)) return true;
  if (SKIP_FILES.has(lower)) return true;
  if (relPath.toLowerCase().includes(`${path.sep}hanguphr-data${path.sep}`)) return true;
  if (relPath.toLowerCase().includes(`${path.sep}hr-cache${path.sep}`)) return true;
  return false;
}

function copyRecursive(src, dest, rel = "") {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (shouldSkipEntry(path.basename(src), rel)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry), path.join(rel, entry));
    }
    return;
  }
  if (shouldSkipEntry(path.basename(src), rel)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function applyRemovedFiles(installRoot, removed) {
  for (const rel of removed || []) {
    const normalized = String(rel).replace(/\//g, path.sep);
    const target = path.join(installRoot, normalized);
    try {
      fs.rmSync(target, { force: true });
    } catch {
      /* ignore */
    }
  }
}

async function applyGitHubUpdate(info) {
  if (!info?.assetUrl) throw new Error("No update package found for this platform");

  let AdmZip;
  try {
    AdmZip = require("adm-zip");
  } catch {
    throw new Error("adm-zip is required for in-app updates");
  }

  const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "hangup-hr-update-"));
  const zipPath = path.join(tmpDir, info.assetName || "update.zip");
  const extractDir = path.join(tmpDir, "extracted");

  try {
    await downloadFile(info.assetUrl, zipPath, githubHeaders());
    fs.mkdirSync(extractDir, { recursive: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    const installRoot = getInstallRoot();
    const updateInfoPath = path.join(extractDir, "update-info.json");
    let updateType = info.updateType || "full";

    if (fs.existsSync(updateInfoPath)) {
      const patchInfo = JSON.parse(fs.readFileSync(updateInfoPath, "utf8"));
      updateType = "patch";
      applyRemovedFiles(installRoot, patchInfo.removed);
      for (const entry of fs.readdirSync(extractDir)) {
        if (entry === "update-info.json") continue;
        copyRecursive(path.join(extractDir, entry), path.join(installRoot, entry), entry);
      }
    } else {
      const entries = fs.readdirSync(extractDir);
      const payloadRoot =
        entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()
          ? path.join(extractDir, entries[0])
          : extractDir;
      copyRecursive(payloadRoot, installRoot);
    }

    return { ok: true, installRoot, version: info.latest, updateType };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function relaunchApp() {
  const exe = process.execPath;
  const cwd = path.dirname(exe);
  const child = spawn(exe, [], {
    detached: true,
    stdio: "ignore",
    cwd,
    env: process.env,
  });
  child.unref();
  process.exit(0);
}

module.exports = {
  getRepo,
  getInstallRoot,
  platformAssetSuffix,
  checkForGitHubUpdate,
  applyGitHubUpdate,
  relaunchApp,
};
