/**
 * Download update manifests from recent GitHub Releases (for multi-version patch builds).
 * Saves each release as update-manifests/{platform}-{version}.json
 *
 * Usage: GITHUB_UPDATES_REPO=owner/repo node scripts/fetch-all-release-manifests.js
 */
require("dotenv").config();
const https = require("https");
const fs = require("fs");
const path = require("path");

function getRepo() {
  return String(process.env.GITHUB_UPDATES_REPO || process.env.GITHUB_REPOSITORY || "").trim();
}

function githubHeaders(extra = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Hangup-HR-Manifest-Fetch",
    ...extra,
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

function requestBuffer(url, headers, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error("Too many redirects"));
    https
      .get(url, { headers }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          if (!loc) return reject(new Error("Redirect without location"));
          const next = { ...headers };
          delete next.Authorization;
          requestBuffer(loc, next, redirectCount + 1).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

function fetchJson(url) {
  return requestBuffer(url, githubHeaders()).then((buf) => JSON.parse(buf.toString("utf8")));
}

function downloadReleaseAsset(repo, asset) {
  const id = asset?.id;
  if (!id) return Promise.reject(new Error("asset missing id"));
  const url = `https://api.github.com/repos/${repo}/releases/assets/${id}`;
  return requestBuffer(url, githubHeaders({ Accept: "application/octet-stream" }));
}

const MANIFEST_RE = /^(win-x64|mac-x64|mac-arm64)(-latest)?\.json$/i;

function releaseSortKey(release) {
  const published = Date.parse(release?.published_at || release?.created_at || "") || 0;
  return published;
}

async function main() {
  const repo = getRepo();
  if (!repo) {
    console.log("GITHUB_UPDATES_REPO not set — skip manifest fetch.");
    return;
  }

  const dist = process.env.HR_BUILD_OUTPUT
    ? path.resolve(process.env.HR_BUILD_OUTPUT)
    : path.join(__dirname, "..", "dist");
  const manifestDir = path.join(dist, "update-manifests");
  fs.mkdirSync(manifestDir, { recursive: true });

  const releases = await fetchJson(`https://api.github.com/repos/${repo}/releases?per_page=30`);
  const sorted = (releases || [])
    .filter((r) => !r.draft)
    .sort((a, b) => releaseSortKey(b) - releaseSortKey(a));

  let saved = 0;
  let failed = 0;
  const latestByPlatform = new Map();

  for (const release of sorted) {
    const tagVersion = String(release.tag_name || "").replace(/^v/i, "").trim();
    const assets = (release.assets || []).filter((a) => MANIFEST_RE.test(a.name));
    for (const asset of assets) {
      try {
        const buf = await downloadReleaseAsset(repo, asset);
        const data = JSON.parse(buf.toString("utf8"));
        const platform = data.platform || asset.name.replace(/-latest\.json$/i, "");
        const version = data.version || tagVersion;
        if (!platform || !version || !data.files) {
          console.warn(`  skip ${asset.name} (${release.tag_name}): missing platform/version/files`);
          continue;
        }
        const dest = path.join(manifestDir, `${platform}-${version}.json`);
        fs.writeFileSync(dest, JSON.stringify(data, null, 2));
        if (!fs.existsSync(dest) || saved === 0 || !latestByPlatform.has(platform)) {
          console.log(`  saved ${platform}-${version}.json (from ${release.tag_name})`);
        }
        saved++;
        if (!latestByPlatform.has(platform)) {
          latestByPlatform.set(platform, { version, dest });
        }
      } catch (err) {
        failed++;
        console.warn(`  skip ${asset.name} (${release.tag_name}): ${err.message}`);
      }
    }
  }

  for (const [platform, { dest }] of latestByPlatform) {
    const latestDest = path.join(manifestDir, `${platform}-latest.json`);
    fs.copyFileSync(dest, latestDest);
  }

  if (saved) {
    console.log(`Fetched ${saved} manifest(s).`);
  } else if (failed) {
    console.warn(`Manifest fetch failed for all ${failed} asset(s). Patch builds may be skipped.`);
    process.exit(1);
  } else {
    console.log("No manifests found on recent releases (first release per platform is OK).");
  }
}

main().catch((err) => {
  console.error("Manifest fetch failed:", err.message);
  process.exit(1);
});
