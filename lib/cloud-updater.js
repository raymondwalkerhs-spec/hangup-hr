/**
 * Cloud (Supabase Storage) patch updater with GitHub Setup.exe fallback.
 * Patches swap resources/app.asar (+ changed unpacked natives). Never replace Hangup Portal.exe.
 * Same major.minor + matching from_version (installed or line baseline) → zip.
 * Otherwise GitHub latest Setup.exe. EPERM → NSIS. Never leave a half-written asar.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { getAppVersion, compareVersions, sameLineVersion, lineVersion } = require("./app-version");
const { extractZipSafe } = require("./zip-extract");
const { validateAsarHeader, sha256File } = require("./update-integrity");

function github() {
  return require("./github-updater");
}

function publicObjectUrl(storagePath) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const rel = String(storagePath || "").replace(/^\/+/, "");
  if (!base || !rel) return null;
  return `${base}/storage/v1/object/public/app-updates/${rel}`;
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function loadCurrentPolicy() {
  const { getSupabaseAdmin } = require("./supabase-client");
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("app_versions").select("*").eq("is_current", true);
  if (error) throw new Error(error.message);
  const rows = data || [];
  if (rows.length !== 1) {
    return { current: rows[0] || null, currentCount: rows.length };
  }
  return { current: rows[0], currentCount: 1 };
}

async function loadAssets(version, platform) {
  const { getSupabaseAdmin } = require("./supabase-client");
  const db = getSupabaseAdmin();
  let q = db.from("app_update_assets").select("*").eq("platform", platform);
  if (version) q = q.eq("version", version);
  const { data, error } = await q;
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return data || [];
}

async function loadInstallerBaseline(line) {
  const { getSupabaseAdmin } = require("./supabase-client");
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("app_update_assets")
    .select("*")
    .eq("platform", "win-x64")
    .eq("kind", "installer")
    .order("created_at", { ascending: false });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return (data || []).find((row) => lineVersion(row.version) === line) || null;
}

function findPatchForInstall(patches, installed, baselineVersion) {
  const list = (patches || []).filter((p) => sameLineVersion(p.version, installed));
  if (!list.length) return null;
  return (
    list.find((p) => String(p.from_version || "") === String(installed)) ||
    list.find((p) => baselineVersion && String(p.from_version || "") === String(baselineVersion)) ||
    null
  );
}

function patchPayload(asset, latest, current) {
  const url = publicObjectUrl(asset.storage_path);
  return {
    enabled: true,
    current,
    latest,
    updateAvailable: compareVersions(current, latest) < 0,
    installKind: "nsis",
    method: "cloud-patch",
    updateType: "patch",
    updateDescription: "Downloads a small update and restarts the app.",
    assetName: path.basename(asset.storage_path || "patch.zip"),
    assetUrl: url,
    assetId: null,
    assetSize: Number(asset.size_bytes) || 0,
    sha256: asset.sha256,
    fromVersion: asset.from_version,
    storagePath: asset.storage_path,
    releaseUrl: url,
    channel: "supabase",
  };
}

async function checkForCloudUpdate() {
  const current = getAppVersion();
  const { current: policy } = await loadCurrentPolicy();
  const latest = String(policy?.version || "").trim();
  if (!latest) return null;
  if (compareVersions(current, latest) >= 0) {
    return {
      enabled: true,
      current,
      latest,
      updateAvailable: false,
      method: "none",
      channel: "supabase",
    };
  }

  if (process.platform !== "win32") return null;
  if (!sameLineVersion(current, latest)) return null;

  const assets = await loadAssets(latest, "win-x64");
  const patches = assets.filter((a) => a.kind === "patch");
  const baseline = await loadInstallerBaseline(lineVersion(latest));
  const baselineVersion = baseline?.version || null;
  if (baselineVersion && compareVersions(current, baselineVersion) < 0) {
    return null;
  }
  const match = findPatchForInstall(patches, current, baselineVersion);
  if (!match || !match.storage_path || !match.sha256) return null;
  return patchPayload(match, latest, current);
}

async function checkForUpdate() {
  try {
    const cloud = await checkForCloudUpdate();
    if (cloud?.updateAvailable && cloud.method === "cloud-patch") return cloud;
  } catch (err) {
    console.warn("[cloud-updater] check failed, using GitHub:", err.message || err);
  }
  return github().checkForGitHubUpdate();
}

function findExtractedAsar(extractDir) {
  const candidates = [
    path.join(extractDir, "resources", "app.asar"),
    path.join(extractDir, "app.asar"),
    path.join(extractDir, "win-unpacked", "resources", "app.asar"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function collectUnpackedFiles(extractDir, asarPath) {
  const resourcesDir = path.dirname(asarPath);
  const unpacked = path.join(resourcesDir, "app.asar.unpacked");
  const files = [];
  if (!fs.existsSync(unpacked)) return files;
  function walk(dir, base) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = path.relative(base, full).replace(/\\/g, "/");
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, base);
        continue;
      }
      files.push({ abs: full, rel });
    }
  }
  walk(unpacked, unpacked);
  return files;
}

function isBlockedPatchPath(rel) {
  const norm = String(rel || "").replace(/\\/g, "/");
  const base = path.basename(norm);
  if (/\.exe$/i.test(base) && /^Hangup /i.test(base)) return true;
  if (/^Hangup Portal\.exe$/i.test(base)) return true;
  return false;
}

async function fallbackNsis(reason) {
  console.warn("[cloud-updater] falling back to GitHub Setup.exe:", reason);
  const info = await github().checkForGitHubUpdate();
  if (!info?.updateAvailable || (!info.assetUrl && !info.assetId)) {
    throw new Error(reason || "Patch failed and no GitHub installer is available");
  }
  return github().applyNsisInstallerUpdate(info);
}

function writeMultiSwapScript(items, exe) {
  const lines = ["@echo off", "ping 127.0.0.1 -n 4 >nul"];
  for (const item of items) {
    if (item.backup && item.target) {
      lines.push(`if exist "${item.backup}" del /f /q "${item.backup}"`);
      lines.push(`if exist "${item.target}" move /y "${item.target}" "${item.backup}"`);
    }
    lines.push(`if exist "${item.staged}" move /y "${item.staged}" "${item.target}"`);
  }
  lines.push(`start "" "${exe}"`);
  lines.push(`del /f /q "%~f0"`);
  const script = path.join(os.tmpdir(), `hangup-hr-cloud-swap-${Date.now()}.bat`);
  fs.writeFileSync(script, lines.join("\r\n"), "utf8");
  spawn("cmd.exe", ["/c", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function applyCloudPatch(info) {
  if (!info?.assetUrl) throw new Error("No patch URL");
  if (!github().isAllowedDownloadUrl(info.assetUrl)) {
    throw new Error(`Download blocked: untrusted host (${info.assetUrl})`);
  }
  if (compareVersions(getAppVersion(), info.latest) >= 0) {
    return { ok: true, method: "cloud-patch", alreadyCurrent: true };
  }
  if (!sameLineVersion(getAppVersion(), info.latest)) {
    return fallbackNsis("Patch is for a different version line");
  }
  if (info.fromVersion && info.fromVersion !== getAppVersion()) {
    const baseline = await loadInstallerBaseline(lineVersion(info.latest));
    if (!baseline || String(baseline.version) !== String(info.fromVersion)) {
      return fallbackNsis("Patch from_version does not match this install or the line baseline");
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hangup-hr-cloud-"));
  const zipPath = path.join(tmpDir, info.assetName || "patch.zip");
  const extractDir = path.join(tmpDir, "extracted");
  try {
    await github().downloadFile(info.assetUrl, zipPath);
    const actualSha = sha256File(zipPath);
    if (info.sha256 && actualSha.toLowerCase() !== String(info.sha256).toLowerCase()) {
      throw new Error("Patch checksum mismatch — not applying");
    }
    fs.mkdirSync(extractDir, { recursive: true });
    extractZipSafe(zipPath, extractDir);

    const asarSrc = findExtractedAsar(extractDir);
    if (!asarSrc) throw new Error("Patch zip missing resources/app.asar");
    validateAsarHeader(asarSrc);

    const liveAsar = github().getAsarPath();
    const stagedAsar = `${liveAsar}.hr-new`;
    try {
      if (fs.existsSync(stagedAsar)) fs.unlinkSync(stagedAsar);
      fs.copyFileSync(asarSrc, stagedAsar);
      validateAsarHeader(stagedAsar);
    } catch (err) {
      if (err.code === "EPERM" || err.code === "EACCES") {
        return fallbackNsis(`Could not stage app.asar (${err.code})`);
      }
      throw err;
    }

    const swapItems = [
      {
        staged: stagedAsar,
        target: liveAsar,
        backup: `${liveAsar}.hr-backup`,
      },
    ];

    const unpackedRoot = path.join(path.dirname(liveAsar), "app.asar.unpacked");
    for (const file of collectUnpackedFiles(extractDir, asarSrc)) {
      if (isBlockedPatchPath(file.rel)) continue;
      const target = path.join(unpackedRoot, file.rel.split("/").join(path.sep));
      const staged = `${target}.hr-new`;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        if (fs.existsSync(staged)) fs.unlinkSync(staged);
        fs.copyFileSync(file.abs, staged);
      } catch (err) {
        if (err.code === "EPERM" || err.code === "EACCES") {
          return fallbackNsis(`Could not stage unpacked file ${file.rel} (${err.code})`);
        }
        throw err;
      }
      swapItems.push({
        staged,
        target,
        backup: `${target}.hr-backup`,
      });
    }

    writeMultiSwapScript(swapItems, process.execPath);
    return {
      ok: true,
      method: "cloud-patch",
      needsQuit: true,
      needsRelaunch: true,
      version: info.latest,
    };
  } catch (err) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    if (err.code === "EPERM" || err.code === "EACCES") {
      return fallbackNsis(err.message);
    }
    throw err;
  }
}

async function applyUpdate(info) {
  if (!info?.updateAvailable) throw new Error("No update available");
  if (info.method === "cloud-patch") return applyCloudPatch(info);
  return github().applyGitHubUpdate(info);
}

module.exports = {
  checkForCloudUpdate,
  checkForUpdate,
  applyCloudPatch,
  applyUpdate,
  publicObjectUrl,
  loadInstallerBaseline,
  findPatchForInstall,
  sha256Buffer,
};
