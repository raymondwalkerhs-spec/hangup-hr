/**
 * Download update manifests from the previous GitHub Release (for patch diff in CI or fresh clones).
 * Usage: GITHUB_UPDATES_REPO=owner/repo node scripts/fetch-release-manifest.js [--tag=v1.0.8]
 */
require("dotenv").config();
const https = require("https");
const fs = require("fs");
const path = require("path");

function getRepo() {
  return String(process.env.GITHUB_UPDATES_REPO || process.env.GITHUB_REPOSITORY || "").trim();
}

function githubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Hangup-HR-Manifest-Fetch",
  };
  let token = process.env.GITHUB_TOKEN || process.env.GITHUB_UPDATES_TOKEN;
  if (!token) {
    try {
      const { execSync } = require("child_process");
      token = execSync("gh auth token", { encoding: "utf8" }).trim();
    } catch {
      /* gh not available */
    }
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: githubHeaders() }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          if (!loc) return reject(new Error("Redirect without location"));
          fetchJson(loc).then(resolve).catch(reject);
          return;
        }
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, { headers: githubHeaders() }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fs.unlink(destPath, () => {});
          downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          return reject(new Error(`Download failed HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(destPath)));
      })
      .on("error", reject);
  });
}

async function main() {
  const repo = getRepo();
  if (!repo) {
    console.log("GITHUB_UPDATES_REPO not set — skip manifest fetch.");
    return;
  }

  const tagArg = process.argv.find((a) => a.startsWith("--tag="));
  const currentTag = tagArg ? tagArg.split("=")[1].replace(/^v/i, "") : null;

  const dist = process.env.HR_BUILD_OUTPUT
    ? path.resolve(process.env.HR_BUILD_OUTPUT)
    : path.join(__dirname, "..", "dist");
  const manifestDir = path.join(dist, "update-manifests");
  fs.mkdirSync(manifestDir, { recursive: true });

  const releases = await fetchJson(`https://api.github.com/repos/${repo}/releases?per_page=20`);
  const sorted = (releases || []).filter((r) => !r.draft && !r.prerelease);
  const previous = sorted.find((r) => {
    const tag = String(r.tag_name || "").replace(/^v/i, "");
    return currentTag ? tag !== currentTag : true;
  });

  if (!previous) {
    console.log("No previous release found — first release will use full zip only.");
    return;
  }

  console.log(`Fetching manifests from release ${previous.tag_name}…`);
  const manifestAssets = (previous.assets || []).filter((a) =>
    /^win-x64-latest\.json$|^mac-(x64|arm64)-latest\.json$/i.test(a.name) ||
    /-(win-x64|mac-x64|mac-arm64)-latest\.json$/i.test(a.name)
  );

  if (!manifestAssets.length) {
    const fallback = (previous.assets || []).filter((a) =>
      /update-manifests|latest\.json$/i.test(a.name)
    );
    manifestAssets.push(...fallback);
  }

  if (!manifestAssets.length) {
    console.log("Previous release has no manifest assets — patch may be skipped.");
    return;
  }

  for (const asset of manifestAssets) {
    const name = asset.name.includes("-latest.json")
      ? asset.name
      : asset.name.replace(/^.*(win-x64|mac-x64|mac-arm64).*\.json$/i, "$1-latest.json");
    const dest = path.join(manifestDir, path.basename(name));
    await downloadFile(asset.browser_download_url, dest);
    console.log(`  saved ${path.basename(dest)}`);
  }
}

main().catch((err) => {
  console.warn("Manifest fetch failed (non-fatal):", err.message);
  process.exit(0);
});
