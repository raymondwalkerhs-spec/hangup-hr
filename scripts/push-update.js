#!/usr/bin/env node
/**
 * Hangup Portal update pipeline — see PUSH_UPDATE.md.
 *   npm run push:update              patch zip → Supabase (same major.minor)
 *   npm run push:update -- --major   GitHub Setup.exe
 *   npm run push:update -- --dry-run
 */
require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { getAppVersion, lineVersion } = require("../lib/app-version");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { publicObjectUrl, loadInstallerBaseline } = require("../lib/cloud-updater");

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    major: args.includes("--major"),
    skipTest: args.includes("--skip-test"),
    breaking: args.includes("--breaking"),
    skipBuild: args.includes("--skip-build"),
  };
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed (${r.status})`);
  }
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function walkFiles(rootDir) {
  const files = {};
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = path.relative(rootDir, full).replace(/\\/g, "/");
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (["hanguphr-data", "hangup hr-data", "hr-cache", ".cache"].includes(name.toLowerCase())) continue;
        walk(full);
        continue;
      }
      if (name === ".env") continue;
      files[rel] = { sha256: hashFile(full), size: stat.size };
    }
  }
  walk(rootDir);
  return files;
}

function unpackedVersion(unpackedDir) {
  const yml = path.join(unpackedDir, "resources", "app-update.yml");
  if (fs.existsSync(yml)) {
    const m = fs.readFileSync(yml, "utf8").match(/^version:\s*(\S+)/m);
    if (m) return m[1].replace(/^['"]|['"]$/g, "");
  }
  const latest = path.join(__dirname, "../dist/latest.yml");
  if (fs.existsSync(latest)) {
    const m = fs.readFileSync(latest, "utf8").match(/^version:\s*(\S+)/m);
    if (m) return m[1].replace(/^['"]|['"]$/g, "");
  }
  return "";
}

function findExeRel(files) {
  return Object.keys(files).find((rel) => /Hangup Portal\.exe$/i.test(rel));
}

function loadBaselineManifest(fromVersion) {
  const dir = path.join(__dirname, "../dist/update-manifests");
  const named = path.join(dir, `win-x64-${fromVersion}.json`);
  if (fs.existsSync(named)) return JSON.parse(fs.readFileSync(named, "utf8"));
  const latest = path.join(dir, "win-x64-latest.json");
  if (fs.existsSync(latest)) {
    const data = JSON.parse(fs.readFileSync(latest, "utf8"));
    if (data.version === fromVersion) return data;
  }
  return null;
}

function buildPatchZip({ unpackedDir, fromVersion, version, baselineFiles }) {
  const AdmZip = require("adm-zip");
  const nextFiles = walkFiles(unpackedDir);
  const exeRel = findExeRel(nextFiles);
  if (exeRel && baselineFiles[exeRel] && nextFiles[exeRel].sha256 !== baselineFiles[exeRel].sha256) {
    throw new Error("Hangup Portal.exe hash changed vs baseline — use --major");
  }
  const asarRel = "resources/app.asar";
  const asarPath = path.join(unpackedDir, asarRel.split("/").join(path.sep));
  if (!fs.existsSync(asarPath)) throw new Error("win-unpacked missing resources/app.asar — run npm run pack");

  const zip = new AdmZip();
  zip.addFile(asarRel, fs.readFileSync(asarPath));
  let unpackedChanged = 0;
  for (const rel of Object.keys(nextFiles)) {
    if (!rel.includes("app.asar.unpacked/")) continue;
    const prev = baselineFiles[rel];
    if (prev && prev.sha256 === nextFiles[rel].sha256) continue;
    zip.addFile(rel, fs.readFileSync(path.join(unpackedDir, rel.split("/").join(path.sep))));
    unpackedChanged += 1;
  }
  const outDir = path.join(__dirname, "../dist");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `Hangup-Portal-${version}-win-x64-patch-from-${fromVersion}.zip`);
  zip.writeZip(outPath);
  return { outPath, unpackedChanged, sha256: hashFile(outPath), size: fs.statSync(outPath).size };
}

async function assertOneCurrent(db) {
  const { data, error } = await db.from("app_versions").select("version").eq("is_current", true);
  if (error) throw new Error(error.message);
  if ((data || []).length !== 1) {
    throw new Error(`Expected exactly one is_current app_versions row, found ${(data || []).length}`);
  }
}

async function uploadPatch({ storagePath, zipPath, sha256, size, dryRun }) {
  const url = publicObjectUrl(storagePath);
  if (dryRun) {
    console.log("[dry-run] would upload", storagePath, size, sha256, url);
    return url;
  }
  const db = getSupabaseAdmin();
  const buf = fs.readFileSync(zipPath);
  const { error } = await db.storage.from("app-updates").upload(storagePath, buf, {
    contentType: "application/zip",
    upsert: false,
  });
  if (error && /already exists|Duplicate/i.test(error.message)) {
    throw new Error(`Refusing to overwrite existing ${storagePath}: ${error.message}`);
  }
  if (error) throw new Error(`upload: ${error.message}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET after upload failed HTTP ${res.status} — not flipping live`);
  const got = Buffer.from(await res.arrayBuffer());
  const gotSha = crypto.createHash("sha256").update(got).digest("hex");
  if (got.length !== size || gotSha !== sha256) {
    throw new Error("Uploaded object size/sha256 mismatch — not flipping live");
  }
  return url;
}

async function upsertAsset(row, dryRun) {
  if (dryRun) {
    console.log("[dry-run] would upsert app_update_assets", row);
    return;
  }
  const db = getSupabaseAdmin();
  const { error } = await db.from("app_update_assets").upsert(row, {
    onConflict: "version,platform,kind,from_version",
  });
  if (error) throw new Error(`app_update_assets: ${error.message}`);
}

function publishVersion({ version, breaking, dryRun }) {
  const args = ["scripts/publish-app-version.js", "--version", version, "--min-compatible", "1.0.0"];
  if (breaking) args.push("--breaking");
  if (dryRun) args.push("--dry-run");
  run(process.execPath, args);
}

async function runPatch(opts) {
  const version = getAppVersion();
  const line = lineVersion(version);
  const baseline = await loadInstallerBaseline(line);
  if (!baseline) {
    throw new Error(
      `No installer baseline in app_update_assets for line ${line}. Ship GitHub Setup.exe with --major first (2.4.1).`
    );
  }
  const fromVersion = baseline.version;
  if (fromVersion === version) {
    throw new Error(`Refusing to patch ${version} onto itself. Bump package.json or use --major.`);
  }

  const unpackedDir = path.join(__dirname, "../dist/win-unpacked");
  if (!fs.existsSync(unpackedDir)) {
    console.log("Packing win-unpacked…");
    if (!opts.dryRun) run("npm", ["run", "pack"]);
  }
  const packedVer = unpackedVersion(unpackedDir);
  if (packedVer && packedVer !== version) {
    throw new Error(`win-unpacked version ${packedVer} ≠ package.json ${version} — refuse dirty pack`);
  }

  const manifest = loadBaselineManifest(fromVersion);
  if (!manifest?.files) {
    throw new Error(`Missing baseline manifest dist/update-manifests/win-x64-${fromVersion}.json`);
  }

  const built = buildPatchZip({
    unpackedDir,
    fromVersion,
    version,
    baselineFiles: manifest.files,
  });
  const storagePath = `win-x64/${version}/patch-from-${fromVersion}.zip`;
  const url = await uploadPatch({
    storagePath,
    zipPath: built.outPath,
    sha256: built.sha256,
    size: built.size,
    dryRun: opts.dryRun,
  });
  await upsertAsset(
    {
      version,
      platform: "win-x64",
      kind: "patch",
      from_version: fromVersion,
      storage_path: storagePath,
      sha256: built.sha256,
      size_bytes: built.size,
    },
    opts.dryRun
  );
  publishVersion({ version, breaking: false, dryRun: opts.dryRun });
  if (!opts.dryRun) await assertOneCurrent(getSupabaseAdmin());
  console.log("\nPublished patch", {
    version,
    fromVersion,
    bytes: built.size,
    sha256: built.sha256,
    url,
    unpackedChanged: built.unpackedChanged,
  });
}

async function runMajor(opts) {
  const version = getAppVersion();
  if (opts.breaking && !opts.major) throw new Error("--breaking is only allowed with --major");
  if (!opts.dryRun) {
    run("npm", ["run", "dist:installer"]);
    run("npm", ["run", "dist:web-installer"]);
    run("npm", ["run", "package:github"]);
    const ps = path.join(__dirname, "publish-installer-only.ps1");
    run("powershell", ["-ExecutionPolicy", "Bypass", "-File", ps]);
  } else {
    console.log("[dry-run] would dist:installer, dist:web-installer, package:github, publish-installer-only");
  }

  const setup = path.join(__dirname, "../dist", `Hangup-Portal-Setup-${version}.exe`);
  const sha256 = fs.existsSync(setup) ? hashFile(setup) : "";
  const size = fs.existsSync(setup) ? fs.statSync(setup).size : 0;
  await upsertAsset(
    {
      version,
      platform: "win-x64",
      kind: "installer",
      from_version: "",
      storage_path: `github:Hangup-Portal-Setup-${version}.exe`,
      sha256: sha256 || "pending",
      size_bytes: size,
    },
    opts.dryRun
  );
  publishVersion({ version, breaking: opts.breaking, dryRun: opts.dryRun });
  if (!opts.dryRun) await assertOneCurrent(getSupabaseAdmin());
  console.log("\nPublished major", { version, setup, sha256, size });
}

async function main() {
  const opts = parseArgs();
  if (opts.breaking && !opts.major) {
    throw new Error("--breaking is only allowed with --major");
  }
  if (!opts.skipBuild) {
    run("npm", ["run", "build:web"]);
  }
  if (opts.skipTest) {
    console.warn("WARNING: --skip-test used. PUSH_UPDATE.md forbids this except a broken Playwright env.");
  } else {
    run("npm", ["run", "test:pages"]);
  }
  if (opts.major) await runMajor(opts);
  else await runPatch(opts);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
