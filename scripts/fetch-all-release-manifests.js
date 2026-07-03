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

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: githubHeaders() }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          if (!loc) return reject(new Error("Redirect without location"));
          downloadBuffer(loc).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

const MANIFEST_RE = /^(win-x64|mac-x64|mac-arm64)(-latest)?\.json$/i;

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
  const sorted = (releases || []).filter((r) => !r.draft);

  let saved = 0;
  for (const release of sorted) {
    const tagVersion = String(release.tag_name || "").replace(/^v/i, "").trim();
    const assets = (release.assets || []).filter((a) => MANIFEST_RE.test(a.name));
    for (const asset of assets) {
      try {
        const buf = await downloadBuffer(asset.browser_download_url);
        const data = JSON.parse(buf.toString("utf8"));
        const platform = data.platform || asset.name.replace(/-latest\.json$/i, "");
        const version = data.version || tagVersion;
        if (!platform || !version || !data.files) continue;
        const dest = path.join(manifestDir, `${platform}-${version}.json`);
        if (!fs.existsSync(dest)) {
          fs.writeFileSync(dest, JSON.stringify(data, null, 2));
          console.log(`  saved ${platform}-${version}.json (from ${release.tag_name})`);
          saved++;
        }
        const latestDest = path.join(manifestDir, `${platform}-latest.json`);
        if (!fs.existsSync(latestDest)) {
          fs.copyFileSync(dest, latestDest);
        }
      } catch (err) {
        console.warn(`  skip ${asset.name} (${release.tag_name}): ${err.message}`);
      }
    }
  }

  console.log(saved ? `Fetched ${saved} manifest(s).` : "No new manifests fetched.");
}

main().catch((err) => {
  console.warn("Manifest fetch failed (non-fatal):", err.message);
  process.exit(0);
});
