#!/usr/bin/env node
/**
 * One-time patch apply when in-app updater is broken (e.g. 1.2.0 adm-zip chmod bug).
 * Close Hangup Portal (or legacy Hangup HR) completely before running.
 *
 * Usage:
 *   node scripts/apply-github-patch-standalone.js --install-dir "C:\path\to\folder\with\exe"
 *   node scripts/apply-github-patch-standalone.js --auto-find
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawn } = require("child_process");
const https = require("https");
const http = require("http");

const REPO = process.env.GITHUB_UPDATES_REPO || "raymondwalkerhs-spec/hangup-hr";
const TARGET_VERSION = process.env.PATCH_TARGET_VERSION || "1.2.4";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { installDir: "", autoFind: false, fromVersion: "" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--install-dir" && args[i + 1]) out.installDir = path.resolve(args[++i]);
    else if (args[i] === "--auto-find") out.autoFind = true;
    else if (args[i] === "--from-version" && args[i + 1]) out.fromVersion = args[++i];
  }
  return out;
}

function readInstalledVersion(installDir) {
  const asar = path.join(installDir, "resources", "app.asar");
  if (!fs.existsSync(asar)) return null;
  try {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(asar);
    const entry = zip.getEntry("package.json");
    if (!entry) return null;
    const pkg = JSON.parse(entry.getData().toString("utf8"));
    return pkg.version || null;
  } catch {
    return null;
  }
}

function findInstallDirs() {
  const hits = [];
  const roots = [
    process.cwd(),
    path.join(process.cwd(), "dist-build2"),
    path.join(process.cwd(), "dist"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Hangup Portal"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Hangup HR Beta"),
    path.dirname(process.execPath),
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "Downloads"),
  ];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    try {
      const exeNames = ["Hangup Portal.exe", "Hangup HR Beta.exe", "Hangup HR.exe"];
      for (const exeName of exeNames) {
        const exe = path.join(root, exeName);
        if (fs.existsSync(exe) && fs.existsSync(path.join(root, "resources", "app.asar"))) {
          hits.push(root);
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return [...new Set(hits)];
}

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (!loc) return reject(new Error("Redirect without location"));
        return fetchJson(loc, headers).then(resolve).catch(reject);
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
  });
}

function downloadFile(url, dest, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dest);
    const req = lib.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlink(dest, () => {});
        return downloadFile(res.headers.location, dest, headers).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`Download HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve(dest)));
    });
    req.on("error", reject);
  });
}

function extractZipWindows(zipPath, extractDir) {
  const { extractZipSafe } = require("../lib/zip-extract");
  extractZipSafe(zipPath, extractDir);
}

function githubHeaders() {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "Hangup-HR-Standalone-Update" };
  const token = process.env.GITHUB_UPDATES_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function githubDownloadHeaders() {
  const headers = { Accept: "application/octet-stream", "User-Agent": "Hangup-HR-Standalone-Update" };
  const token = process.env.GITHUB_UPDATES_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function pickPatchAsset(fromVersion) {
  const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/tags/v${TARGET_VERSION}`, githubHeaders());
  const assets = release.assets || [];
  const exact = assets.find((a) =>
    new RegExp(`hangup-hr-${TARGET_VERSION.replace(/\./g, "\\.")}-win-x64-patch-from-${fromVersion.replace(/\./g, "\\.")}\\.zip$`, "i").test(
      a.name
    )
  );
  if (exact) return exact;
  const any = assets.find(
    (a) => new RegExp(`patch-from-${fromVersion.replace(/\./g, "\\.")}\\.zip$`, "i").test(a.name) && /win-x64/i.test(a.name)
  );
  if (any) return any;
  const full = assets.find(
    (a) =>
      new RegExp(`hangup-(portal|hr)-${TARGET_VERSION.replace(/\./g, "\\.")}-win-x64-full\\.zip$`, "i").test(a.name)
  );
  if (full) return full;
  throw new Error(`No patch or full zip for ${fromVersion} → ${TARGET_VERSION} on GitHub`);
}

async function applyToInstall(installDir, fromVersion) {
  const exeNames = ["Hangup Portal.exe", "Hangup HR Beta.exe", "Hangup HR.exe"];
  const exe = exeNames.map((name) => path.join(installDir, name)).find((p) => fs.existsSync(p));
  if (!exe) throw new Error(`No app executable found in ${installDir}`);
  console.log(`Install folder: ${installDir}`);
  console.log(`Current version (from asar): ${fromVersion || "unknown"}`);
  console.log(`Target: ${TARGET_VERSION}`);

  const asset = await pickPatchAsset(fromVersion || "1.2.0");
  console.log(`Downloading: ${asset.name} (${Math.round(asset.size / 1024 / 1024)} MB)`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hangup-hr-standalone-"));
  const zipPath = path.join(tmp, asset.name);
  const extractDir = path.join(tmp, "extracted");

  const downloadUrl = `https://api.github.com/repos/${REPO}/releases/assets/${asset.id}`;
  await downloadFile(downloadUrl, zipPath, githubDownloadHeaders());

  if (/full\.zip$/i.test(asset.name)) {
    extractZipWindows(zipPath, extractDir);
    const entries = fs.readdirSync(extractDir);
    const root =
      entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()
        ? path.join(extractDir, entries[0])
        : extractDir;
    for (const name of fs.readdirSync(root)) {
      const src = path.join(root, name);
      const dest = path.join(installDir, name);
      fs.cpSync(src, dest, { recursive: true, force: true });
    }
  } else {
    extractZipWindows(zipPath, extractDir);
    const updateInfoPath = path.join(extractDir, "update-info.json");
    if (fs.existsSync(updateInfoPath)) {
      const info = JSON.parse(fs.readFileSync(updateInfoPath, "utf8"));
      const { verifyExtractedPatch, copyFileVerified } = require("../lib/update-integrity");
      verifyExtractedPatch(extractDir, info);
      const hashes = info.fileHashes || {};
      for (const rel of info.files || []) {
        const src = path.join(extractDir, rel.replace(/\//g, path.sep));
        const dest = path.join(installDir, rel.replace(/\//g, path.sep));
        if (!fs.existsSync(src)) continue;
        copyFileVerified(src, dest, rel, hashes[rel]);
        console.log(`  updated ${rel}`);
      }
    } else {
      fs.cpSync(extractDir, installDir, { recursive: true, force: true });
    }
  }

  const newVer = readInstalledVersion(installDir);
  console.log(`Done. Installed version is now: ${newVer || TARGET_VERSION}`);
  console.log(`Start: ${exe}`);

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function main() {
  const opts = parseArgs();
  let installDir = opts.installDir;

  if (opts.autoFind || !installDir) {
    const found = findInstallDirs();
    if (found.length === 1) installDir = found[0];
    else if (found.length > 1) {
      console.log("Multiple installs found:");
      found.forEach((d, i) => console.log(`  [${i + 1}] ${d}`));
      throw new Error("Pass --install-dir with the folder containing Hangup Portal.exe");
    }
  }

  if (!installDir) {
    console.error("Usage: node scripts/apply-github-patch-standalone.js --install-dir \"C:\\path\\to\\app\"");
    console.error("       node scripts/apply-github-patch-standalone.js --auto-find");
    process.exit(1);
  }

  const fromVersion = opts.fromVersion || readInstalledVersion(installDir) || "1.2.0";
  if (fromVersion === TARGET_VERSION) {
    console.log(`Already at ${TARGET_VERSION}.`);
    process.exit(0);
  }

  console.log("\n*** Close Hangup Portal completely before continuing ***\n");
  await new Promise((r) => setTimeout(r, 3000));

  await applyToInstall(installDir, fromVersion);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
