/**
 * Package GitHub release assets: patch zip (changed files only) + optional full zip.
 * Usage: node scripts/package-github-release.js [--full] [--from-version=1.0.8-beta.1]
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const SKIP_DIRS = new Set(["hanguphr-data", "hangup hr-data", "hr-cache", ".cache"]);
const SKIP_FILES = new Set([".env"]);

function shouldSkip(relPath) {
  const parts = String(relPath || "").replace(/\\/g, "/").split("/");
  const base = parts[parts.length - 1]?.toLowerCase() || "";
  if (SKIP_FILES.has(base)) return true;
  return parts.some((p) => SKIP_DIRS.has(p.toLowerCase()));
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function walkManifest(rootDir) {
  const manifest = {};
  function walk(dir, base) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const rel = path.relative(base, full).replace(/\\/g, "/");
      if (shouldSkip(rel)) continue;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, base);
        continue;
      }
      manifest[rel] = { sha256: hashFile(full), size: stat.size };
    }
  }
  walk(rootDir, rootDir);
  return manifest;
}

function loadPreviousManifest(manifestDir, platform, fromVersion) {
  const candidates = [];
  if (fromVersion) {
    candidates.push(path.join(manifestDir, `${platform}-${fromVersion}.json`));
  }
  candidates.push(path.join(manifestDir, `${platform}-latest.json`));
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data?.files && Object.keys(data.files).length) return data;
  }
  return null;
}

function diffManifests(prevFiles, nextFiles) {
  const changed = [];
  const added = [];
  const removed = [];
  for (const rel of Object.keys(nextFiles)) {
    if (!prevFiles[rel]) added.push(rel);
    else if (prevFiles[rel].sha256 !== nextFiles[rel].sha256) changed.push(rel);
  }
  for (const rel of Object.keys(prevFiles)) {
    if (!nextFiles[rel]) removed.push(rel);
  }
  const files = [...new Set([...changed, ...added])].sort();
  return { changed, added, removed, files };
}

function copyFileToStaging(srcRoot, rel, stagingRoot) {
  const src = path.join(srcRoot, rel);
  const dest = path.join(stagingRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function zipDirectory(sourceDir, outZip) {
  const zip = new AdmZip();
  zip.addLocalFolder(sourceDir);
  zip.writeZip(outZip);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * electron-builder outputs mac apps under dist/mac-arm64/, dist/mac-x64/, or dist/*.app
 */
function findMacAppBundles(dist) {
  const results = [];
  if (!fs.existsSync(dist)) return results;

  const seen = new Set();

  function addApp(appPath, platformHint) {
    const resolved = path.resolve(appPath);
    if (seen.has(resolved)) return;
    if (!fs.existsSync(resolved) || !resolved.endsWith(".app")) return;
    seen.add(resolved);

    let platform = platformHint;
    if (!platform) {
      const parent = path.basename(path.dirname(resolved)).toLowerCase();
      if (parent.includes("arm64")) platform = "mac-arm64";
      else if (parent.includes("x64") || parent.includes("intel")) platform = "mac-x64";
      else if (/arm64/i.test(path.basename(resolved))) platform = "mac-arm64";
      else platform = "mac-x64";
    }

    results.push({ sourceDir: resolved, platform });
  }

  for (const entry of fs.readdirSync(dist)) {
    const full = path.join(dist, entry);
    if (entry.endsWith(".app") && fs.statSync(full).isDirectory()) {
      addApp(full, null);
      continue;
    }
    if (!fs.statSync(full).isDirectory()) continue;

    const lower = entry.toLowerCase();
    if (lower === "mac" || lower.startsWith("mac-")) {
      let platformHint = null;
      if (lower.includes("arm64")) platformHint = "mac-arm64";
      else if (lower.includes("x64")) platformHint = "mac-x64";

      for (const child of fs.readdirSync(full)) {
        if (child.endsWith(".app")) {
          addApp(path.join(full, child), platformHint);
        }
      }
    }
  }

  return results;
}

function packagePlatform({ sourceDir, platform, version, dist, manifestDir, fromVersion, includeFull }) {
  if (!fs.existsSync(sourceDir)) {
    console.log(`SKIP: ${sourceDir} not found`);
    return [];
  }

  const created = [];
  const nextFiles = walkManifest(sourceDir);
  const prev = loadPreviousManifest(manifestDir, platform, fromVersion);
  const prevVersion = prev?.version || null;
  const prevFiles = prev?.files || {};

  const manifestOut = {
    version,
    platform,
    generatedAt: new Date().toISOString(),
    files: nextFiles,
  };
  fs.writeFileSync(path.join(manifestDir, `${platform}-${version}.json`), JSON.stringify(manifestOut, null, 2));
  fs.writeFileSync(path.join(manifestDir, `${platform}-latest.json`), JSON.stringify(manifestOut, null, 2));

  if (prevVersion && prevFiles && Object.keys(prevFiles).length) {
    const diff = diffManifests(prevFiles, nextFiles);
    if (diff.files.length || diff.removed.length) {
      const staging = path.join(dist, `.patch-staging-${platform}`);
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });

      for (const rel of diff.files) {
        copyFileToStaging(sourceDir, rel, staging);
      }

      const updateInfo = {
        type: "patch",
        fromVersion: prevVersion,
        toVersion: version,
        platform,
        changed: diff.changed.length,
        added: diff.added.length,
        removed: diff.removed,
        files: diff.files,
      };
      fs.writeFileSync(path.join(staging, "update-info.json"), JSON.stringify(updateInfo, null, 2));

      const patchZip = path.join(
        dist,
        `Hangup-HR-${version}-${platform}-patch-from-${prevVersion}.zip`
      );
      zipDirectory(staging, patchZip);
      const patchSize = fs.statSync(patchZip).size;
      console.log(
        `Created patch ${path.basename(patchZip)} (${diff.files.length} files, ${formatBytes(patchSize)})`
      );
      created.push(patchZip);
      fs.rmSync(staging, { recursive: true, force: true });
    } else {
      console.log(`No file changes for ${platform} since ${prevVersion} — patch skipped.`);
    }
  } else {
    console.log(`No previous manifest for ${platform} — patch skipped (use --full for first release).`);
  }

  if (includeFull || !prevVersion) {
    const fullZip = path.join(dist, `Hangup-HR-${version}-${platform}-full.zip`);
    zipDirectory(sourceDir, fullZip);
    const fullSize = fs.statSync(fullZip).size;
    console.log(`Created full ${path.basename(fullZip)} (${formatBytes(fullSize)})`);
    created.push(fullZip);
  }

  return created;
}

function main() {
  const args = process.argv.slice(2);
  const includeFull = args.includes("--full");
  const fromArg = args.find((a) => a.startsWith("--from-version="));
  const fromVersion = fromArg ? fromArg.split("=")[1] : null;

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const version = pkg.version;
  const dist = process.env.HR_BUILD_OUTPUT
    ? path.resolve(process.env.HR_BUILD_OUTPUT)
    : path.join(__dirname, "..", "dist");
  const manifestDir = path.join(dist, "update-manifests");
  fs.mkdirSync(manifestDir, { recursive: true });

  const created = [];

  const winUnpacked = path.join(dist, "win-unpacked");
  created.push(
    ...packagePlatform({
      sourceDir: winUnpacked,
      platform: "win-x64",
      version,
      dist,
      manifestDir,
      fromVersion,
      includeFull,
    })
  );

  const macBundles = findMacAppBundles(dist);
  for (const { sourceDir, platform } of macBundles) {
    created.push(
      ...packagePlatform({
        sourceDir,
        platform,
        version,
        dist,
        manifestDir,
        fromVersion,
        includeFull,
      })
    );
  }

  if (!created.length) {
    console.error("No update packages created. Build first (dist:portable on Windows or dist:mac on macOS).");
    process.exit(1);
  }

  console.log("");
  console.log(`Upload to GitHub Releases (tag v${version}):`);
  for (const z of created) console.log(`  ${z}`);
  console.log("");
  console.log("Users on the previous version download the patch; others use the full zip.");
}

main();
