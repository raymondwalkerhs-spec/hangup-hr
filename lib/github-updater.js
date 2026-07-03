/**
 * GitHub Releases updater — installer-primary (no in-app patch overlays).
 * Windows NSIS: silent Setup.exe. macOS: full .app bundle replace. Portable: full zip atomic swap.
 * Configure GITHUB_UPDATES_REPO=owner/repo in .env (packaged via extraResources).
 */
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { compareVersions, getAppVersion } = require("./app-version");
const { extractZipSafe } = require("./zip-extract");
const { validateAsarHeader } = require("./update-integrity");

const SWAP_MANIFEST = "hangup-hr-atomic-swap.json";
const BACKUP_SUFFIX = ".hr-backup";
const LEGACY_DEFER_MANIFEST = "hangup-hr-pending-update.json";

const UNINSTALLER_NAMES = [
  "Uninstall Hangup HR Beta.exe",
  "Uninstall Hangup HR.exe",
  "Uninstall Hangup HR System.exe",
  "Uninstall.exe",
];

function getRepo() {
  return String(process.env.GITHUB_UPDATES_REPO || "").trim();
}

function getInstallRoot() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (process.platform === "darwin" && process.execPath.includes(".app/")) {
    return process.execPath.split(".app/")[0] + ".app/Contents";
  }
  return path.dirname(process.execPath);
}

function getMacAppBundle() {
  if (process.platform !== "darwin" || !process.execPath.includes(".app/")) return null;
  return process.execPath.split(".app/")[0] + ".app";
}

function hasNsisUninstaller(exeDir) {
  return UNINSTALLER_NAMES.some((name) => fs.existsSync(path.join(exeDir, name)));
}

function detectInstallKind() {
  if (process.platform === "darwin" && process.execPath.includes(".app/")) return "mac";
  if (process.env.PORTABLE_EXECUTABLE_DIR) return "portable";
  if (process.platform === "win32") {
    const exeDir = path.dirname(process.execPath);
    if (hasNsisUninstaller(exeDir)) return "nsis";
    const norm = process.execPath.replace(/\\/g, "/").toLowerCase();
    if (
      norm.includes("/programs/") ||
      norm.includes("/program files/") ||
      norm.includes("/appdata/local/programs/")
    ) {
      return "nsis";
    }
    return "portable";
  }
  return "portable";
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

function updateDescriptionFor(kind) {
  if (kind === "nsis") {
    return "Downloads the installer and upgrades silently. The app will close so the installer can finish.";
  }
  if (kind === "mac") {
    return "Downloads the full app and replaces it. The app will restart when finished.";
  }
  return "Downloads the full update package and applies it. The app will restart when finished.";
}

function methodForKind(kind) {
  if (kind === "nsis") return "nsis";
  if (kind === "mac") return "mac-swap";
  return "portable-swap";
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

function githubApiHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Hangup-HR-Updater",
  };
  const token = process.env.GITHUB_UPDATES_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function githubDownloadHeaders() {
  const headers = {
    Accept: "application/octet-stream",
    "User-Agent": "Hangup-HR-Updater",
  };
  const token = process.env.GITHUB_UPDATES_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function githubHeaders() {
  return githubApiHeaders();
}

function resolveDownloadUrl(info) {
  const repo = getRepo();
  if (info.assetId && repo) {
    return `https://api.github.com/repos/${repo}/releases/assets/${info.assetId}`;
  }
  return info.assetUrl;
}

function pickReleaseAsset(release, latestVersion, installKind) {
  const assets = release.assets || [];
  const latestEsc = escVersion(latestVersion);

  if (installKind === "nsis") {
    const patterns = [
      new RegExp(`hangup-hr-beta.*setup.*${latestEsc}.*\\.exe$`, "i"),
      new RegExp(`setup.*${latestEsc}.*\\.exe$`, "i"),
      new RegExp(`hangup-hr.*${latestEsc}.*setup.*\\.exe$`, "i"),
    ];
    for (const re of patterns) {
      const hit = assets.find((a) => re.test(a.name) && !/uninstall/i.test(a.name));
      if (hit) {
        return { asset: hit, updateType: "installer", method: "nsis" };
      }
    }
    return { asset: null, updateType: null, method: null };
  }

  const suffix = platformAssetSuffix();
  const fullPatterns = [
    new RegExp(`hangup-hr-${latestEsc}-${suffix}-full\\.zip$`, "i"),
    new RegExp(`hangup-hr-${latestEsc}-${suffix}\\.zip$`, "i"),
  ];
  for (const re of fullPatterns) {
    const hit = assets.find((a) => re.test(a.name) && !/patch/i.test(a.name));
    if (hit) {
      return {
        asset: hit,
        updateType: "full",
        method: installKind === "mac" ? "mac-swap" : "portable-swap",
      };
    }
  }

  return { asset: null, updateType: null, method: null };
}

async function checkForGitHubUpdate() {
  const repo = getRepo();
  if (!repo) {
    return { enabled: false, reason: "GITHUB_UPDATES_REPO not configured" };
  }

  const installKind = detectInstallKind();
  const current = getAppVersion();
  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`, githubHeaders());
  const latest = String(release.tag_name || release.name || "").replace(/^v/i, "").trim();
  if (!latest) return { enabled: true, current, latest: null, updateAvailable: false, installKind };

  const picked = pickReleaseAsset(release, latest, installKind);
  const updateAvailable = compareVersions(current, latest) < 0;
  const method = picked.method || methodForKind(installKind);

  return {
    enabled: true,
    current,
    latest,
    updateAvailable,
    installKind,
    method,
    updateType: picked.updateType,
    updateDescription: updateDescriptionFor(installKind),
    releaseNotes: release.body || "",
    assetName: picked.asset?.name || null,
    assetId: picked.asset?.id || null,
    assetUrl: picked.asset?.browser_download_url || null,
    assetSize: picked.asset?.size || 0,
    publishedAt: release.published_at || null,
  };
}

function findPayloadRoot(extractDir) {
  const entries = fs.readdirSync(extractDir);
  const soleDir =
    entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()
      ? path.join(extractDir, entries[0])
      : null;

  if (soleDir && soleDir.endsWith(".app")) return soleDir;

  const contentsDir = path.join(extractDir, "Contents");
  if (fs.existsSync(contentsDir) && fs.statSync(contentsDir).isDirectory()) {
    return extractDir;
  }

  if (soleDir) {
    const nestedContents = path.join(soleDir, "Contents");
    if (fs.existsSync(nestedContents)) return soleDir;
    const nestedAsar = path.join(soleDir, "resources", "app.asar");
    if (fs.existsSync(nestedAsar)) return soleDir;
  }

  const asar = path.join(extractDir, "resources", "app.asar");
  if (fs.existsSync(asar)) return extractDir;

  return soleDir || extractDir;
}

function validatePayloadAsar(payloadRoot, installKind) {
  if (installKind === "mac") {
    const asar = path.join(payloadRoot, "Contents", "Resources", "app.asar");
    if (!fs.existsSync(asar)) {
      throw new Error("Update package missing Contents/Resources/app.asar");
    }
    validateAsarHeader(asar);
    return;
  }
  const asar = path.join(payloadRoot, "resources", "app.asar");
  if (!fs.existsSync(asar)) {
    throw new Error("Update package missing resources/app.asar");
  }
  validateAsarHeader(asar);
  const exeName = path.basename(process.execPath);
  const exePath = path.join(payloadRoot, exeName);
  if (!fs.existsSync(exePath)) {
    throw new Error(`Update package missing main executable (${exeName})`);
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getManifestPath() {
  if (process.platform === "darwin") {
    const bundle = getMacAppBundle();
    if (bundle) return path.join(bundle, SWAP_MANIFEST);
  }
  return path.join(getInstallRoot(), SWAP_MANIFEST);
}

function writeSwapManifest({ stagedPath, targetPath, exe, version }) {
  const manifestPath = getManifestPath();
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      type: "atomic-swap",
      stagedPath,
      targetPath,
      backupPath: targetPath + BACKUP_SUFFIX,
      exe,
      version,
    })
  );
}

async function downloadReleaseAsset(info, destPath) {
  await downloadFile(resolveDownloadUrl(info), destPath, githubDownloadHeaders());
}

const HANGUP_PROCESS_NAMES = [
  "Hangup HR Beta.exe",
  "Hangup HR.exe",
  "Hangup HR System.exe",
];

async function applyNsisInstallerUpdate(info) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hangup-hr-setup-"));
  const setupPath = path.join(tmpDir, info.assetName || "Hangup-HR-Setup.exe");
  try {
    await downloadReleaseAsset(info, setupPath);
    const stat = fs.statSync(setupPath);
    if (stat.size < 1024 * 1024) {
      throw new Error("Downloaded installer is too small — file may be corrupt");
    }

    const installScript = path.join(os.tmpdir(), `hangup-hr-nsis-${Date.now()}.bat`);
    const lines = [
      "@echo off",
      "ping 127.0.0.1 -n 4 >nul",
      ...HANGUP_PROCESS_NAMES.map((name) => `taskkill /F /IM "${name}" /T 2>nul`),
      `"${setupPath}" /S`,
      `if exist "${tmpDir}" rd /s /q "${tmpDir}"`,
      `del /f /q "%~f0"`,
    ];
    fs.writeFileSync(installScript, lines.join("\r\n"), "utf8");
    spawn("cmd.exe", ["/c", installScript], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();

    return { ok: true, method: "nsis", needsQuit: true, version: info.latest };
  } catch (err) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function stageMacPayload(extractDir, version) {
  const payloadRoot = findPayloadRoot(extractDir);
  validatePayloadAsar(payloadRoot, "mac");

  const appName = path.basename(getMacAppBundle() || "Hangup HR Beta.app");
  const stagedApp = path.join(os.tmpdir(), `hangup-hr-staged-${version}-${Date.now()}`, appName);
  fs.mkdirSync(path.dirname(stagedApp), { recursive: true });

  if (payloadRoot.endsWith(".app")) {
    copyDirRecursive(payloadRoot, stagedApp);
  } else {
    fs.mkdirSync(stagedApp, { recursive: true });
    copyDirRecursive(payloadRoot, stagedApp);
  }

  validatePayloadAsar(stagedApp, "mac");
  return stagedApp;
}

function stagePortablePayload(extractDir, version) {
  const payloadRoot = findPayloadRoot(extractDir);
  validatePayloadAsar(payloadRoot, "portable");

  const stagedDir = path.join(os.tmpdir(), `hangup-hr-staged-${version}-${Date.now()}`);
  copyDirRecursive(payloadRoot, stagedDir);
  validatePayloadAsar(stagedDir, "portable");
  return stagedDir;
}

async function applyMacFullAppUpdate(info) {
  const bundle = getMacAppBundle();
  if (!bundle) throw new Error("Could not locate .app bundle for update");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hangup-hr-update-"));
  const zipPath = path.join(tmpDir, info.assetName || "update.zip");
  const extractDir = path.join(tmpDir, "extracted");

  try {
    await downloadReleaseAsset(info, zipPath);
    fs.mkdirSync(extractDir, { recursive: true });
    extractZipSafe(zipPath, extractDir);

    const stagedApp = stageMacPayload(extractDir, info.latest);
    writeSwapManifest({
      stagedPath: stagedApp,
      targetPath: bundle,
      exe: process.execPath,
      version: info.latest,
    });

    return {
      ok: true,
      method: "mac-swap",
      needsRelaunch: true,
      version: info.latest,
      installRoot: bundle,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* staged app lives outside tmpDir */
    }
  }
}

async function applyPortableFullUpdate(info) {
  const installDir = getInstallRoot();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hangup-hr-update-"));
  const zipPath = path.join(tmpDir, info.assetName || "update.zip");
  const extractDir = path.join(tmpDir, "extracted");

  try {
    await downloadReleaseAsset(info, zipPath);
    fs.mkdirSync(extractDir, { recursive: true });
    extractZipSafe(zipPath, extractDir);

    const stagedDir = stagePortablePayload(extractDir, info.latest);
    writeSwapManifest({
      stagedPath: stagedDir,
      targetPath: installDir,
      exe: process.execPath,
      version: info.latest,
    });

    return {
      ok: true,
      method: "portable-swap",
      needsRelaunch: true,
      version: info.latest,
      installRoot: installDir,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* staged dir lives outside tmpDir */
    }
  }
}

async function applyGitHubUpdate(info) {
  if (!info?.assetUrl && !info?.assetId) throw new Error("No update package found for this platform");

  const kind = info.installKind || detectInstallKind();
  if (kind === "nsis") return applyNsisInstallerUpdate(info);
  if (kind === "mac") return applyMacFullAppUpdate(info);
  return applyPortableFullUpdate(info);
}

function runAtomicSwapScript(manifest) {
  const { stagedPath, targetPath, backupPath, exe } = manifest;
  if (!stagedPath || !targetPath || !fs.existsSync(stagedPath)) return false;

  const archivedBackup = backupPath ? `${backupPath}.archived-${Date.now()}` : null;

  if (process.platform === "win32") {
    const manifestPath = getManifestPath();
    const lines = [
      "@echo off",
      "ping 127.0.0.1 -n 4 >nul",
    ];
    if (backupPath && archivedBackup) {
      lines.push(`if exist "${backupPath}" move /y "${backupPath}" "${archivedBackup}"`);
    }
    lines.push(
      `if exist "${targetPath}" move /y "${targetPath}" "${backupPath}"`,
      `move /y "${stagedPath}" "${targetPath}"`,
      `if exist "${manifestPath}" del /f /q "${manifestPath}"`,
      `start "" "${exe}"`
    );
    const script = path.join(os.tmpdir(), `hangup-hr-swap-${Date.now()}.bat`);
    fs.writeFileSync(script, lines.join("\r\n"), "utf8");
    spawn("cmd.exe", ["/c", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  }

  if (process.platform === "darwin") {
    const manifestPath = getManifestPath();
    const lines = ["#!/bin/bash", "sleep 3"];
    if (backupPath && archivedBackup) {
      lines.push(`if [ -e "${backupPath}" ]; then mv "${backupPath}" "${archivedBackup}"; fi`);
    }
    lines.push(
      `if [ -e "${targetPath}" ]; then mv "${targetPath}" "${backupPath}"; fi`,
      `mv "${stagedPath}" "${targetPath}"`,
      `rm -f "${manifestPath}"`,
      `open "${exe}"`
    );
    const script = path.join(os.tmpdir(), `hangup-hr-swap-${Date.now()}.sh`);
    fs.writeFileSync(script, lines.join("\n"), { mode: 0o755 });
    spawn("/bin/bash", [script], { detached: true, stdio: "ignore" }).unref();
    return true;
  }

  return false;
}

function completeLegacyDeferredSwap() {
  const installRoot = getInstallRoot();
  const manifestPath = path.join(installRoot, LEGACY_DEFER_MANIFEST);
  if (!fs.existsSync(manifestPath)) return false;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return false;
  }

  const deferred = manifest.deferred || [];
  const exe = manifest.exe || process.execPath;
  if (!deferred.length) return false;

  if (process.platform === "win32") {
    const lines = ["@echo off", "ping 127.0.0.1 -n 3 >nul"];
    for (const item of deferred) {
      if (!item.pending || !item.target) continue;
      lines.push(`if exist "${item.target}" del /f /q "${item.target}"`);
      lines.push(`if exist "${item.pending}" move /y "${item.pending}" "${item.target}"`);
    }
    lines.push(`if exist "${manifestPath}" del /f /q "${manifestPath}"`);
    lines.push(`start "" "${exe}"`);
    const script = path.join(os.tmpdir(), `hangup-hr-legacy-${Date.now()}.bat`);
    fs.writeFileSync(script, lines.join("\r\n"), "utf8");
    spawn("cmd.exe", ["/c", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    process.exit(0);
    return true;
  }

  if (process.platform === "darwin") {
    const lines = ["#!/bin/bash", "sleep 2"];
    for (const item of deferred) {
      if (!item.pending || !item.target) continue;
      lines.push(`rm -f "${item.target}"`);
      lines.push(`mv "${item.pending}" "${item.target}"`);
    }
    lines.push(`rm -f "${manifestPath}"`);
    lines.push(`open "${exe}"`);
    const script = path.join(os.tmpdir(), `hangup-hr-legacy-${Date.now()}.sh`);
    fs.writeFileSync(script, lines.join("\n"), { mode: 0o755 });
    spawn("/bin/bash", [script], { detached: true, stdio: "ignore" }).unref();
    process.exit(0);
    return true;
  }

  return false;
}

function checkInstallHealth() {
  try {
    const { app } = require("electron");
    if (app) {
      if (app.isPackaged === false) {
        return { ok: true, code: "dev-mode" };
      }
      const appPath = app.getAppPath();
      if (appPath && fs.existsSync(appPath)) {
        return { ok: true, code: "running-packaged" };
      }
    }
  } catch {
    /* not in electron — fall through to file check */
  }
  const asarPath = getAsarPath();
  if (!fs.existsSync(asarPath)) {
    return {
      ok: false,
      code: "missing-asar",
      message:
        "The app installation is incomplete (app.asar missing). Reinstall using Update now or the latest Setup.exe from GitHub.",
    };
  }
  try {
    validateAsarHeader(asarPath);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: "invalid-asar",
      message:
        "A recent update may have left the install in a bad state (Invalid package app.asar). Use Update now to reinstall — your data is not affected.",
      detail: err.message || String(err),
    };
  }
}

function getAsarPath() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "app.asar");
    if (fs.existsSync(packaged)) return packaged;
  }
  const root = getInstallRoot();
  if (process.platform === "darwin") {
    return path.join(root, "Resources", "app.asar");
  }
  return path.join(root, "resources", "app.asar");
}

let cachedInstallHealth = null;

function getInstallHealth() {
  try {
    const { app } = require("electron");
    if (app?.isPackaged) {
      return checkInstallHealth();
    }
  } catch {
    /* ignore */
  }
  return cachedInstallHealth || checkInstallHealth();
}

/**
 * Called on startup before bootstrap — finish interrupted swaps; never block launch.
 * Returns { action: 'exit' } if the process should quit (swap script launched).
 */
function recoverOrCompleteUpdate() {
  completeLegacyDeferredSwap();

  const manifestPath = getManifestPath();
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.type === "atomic-swap") {
        if (manifest.stagedPath && fs.existsSync(manifest.stagedPath) && runAtomicSwapScript(manifest)) {
          process.exit(0);
          return { action: "exit" };
        }
        if (manifest.stagedPath && !fs.existsSync(manifest.stagedPath)) {
          try {
            fs.unlinkSync(manifestPath);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* continue */
    }
  }

  cachedInstallHealth = checkInstallHealth();
  if (!cachedInstallHealth.ok) {
    return { action: "continue", installHealth: cachedInstallHealth };
  }
  return { action: "continue" };
}

function relaunchAppDirect() {
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

function relaunchApp() {
  const manifestPath = getManifestPath();
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.type === "atomic-swap" && runAtomicSwapScript(manifest)) {
        process.exit(0);
        return;
      }
    } catch {
      /* fall through */
    }
  }
  relaunchAppDirect();
}

function relaunchWithDeferredSwap() {
  relaunchApp();
}

module.exports = {
  getRepo,
  getInstallRoot,
  getMacAppBundle,
  detectInstallKind,
  platformAssetSuffix,
  checkForGitHubUpdate,
  applyGitHubUpdate,
  applyNsisInstallerUpdate,
  applyMacFullAppUpdate,
  applyPortableFullUpdate,
  recoverOrCompleteUpdate,
  checkInstallHealth,
  getInstallHealth,
  relaunchApp,
  relaunchWithDeferredSwap,
};
