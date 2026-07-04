#!/usr/bin/env node
/**
 * Delete GitHub Actions artifacts to free storage quota.
 * Usage: node scripts/cleanup-github-artifacts.js [--keep=N]
 */
const { execSync } = require("child_process");

const repo = process.env.GITHUB_REPOSITORY || "raymondwalkerhs-spec/hangup-hr";
const keepArg = process.argv.find((a) => a.startsWith("--keep="));
const keep = keepArg ? Number(keepArg.split("=")[1]) : 0;

function ghJson(endpoint) {
  const cmd = `gh api "${endpoint}"`;
  return JSON.parse(execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], shell: true }));
}

function ghDelete(endpoint) {
  execSync(`gh api -X DELETE "${endpoint}"`, { stdio: "inherit", shell: true });
}

const all = [];
let page = 1;
while (page <= 20) {
  const res = ghJson(`repos/${repo}/actions/artifacts?per_page=100&page=${page}`);
  all.push(...(res.artifacts || []));
  if (!res.artifacts?.length || res.artifacts.length < 100) break;
  page += 1;
}

all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
const toDelete = keep > 0 ? all.slice(keep) : all;
let freed = 0;
let deleted = 0;

console.log(`Found ${all.length} artifacts; deleting ${toDelete.length} (keeping ${keep}).`);
for (const a of toDelete) {
  try {
    ghDelete(`repos/${repo}/actions/artifacts/${a.id}`);
    freed += a.size_in_bytes || 0;
    deleted += 1;
    if (deleted % 5 === 0 || deleted === toDelete.length) {
      console.log(`Progress: ${deleted}/${toDelete.length} (~${Math.round(freed / 1e9 * 10) / 10} GB)`);
    }
  } catch (err) {
    console.warn(`Failed ${a.id} ${a.name}:`, err.message || err);
  }
}

const remaining = ghJson(`repos/${repo}/actions/artifacts?per_page=1`);
console.log(`\nDeleted ${deleted} artifacts (~${Math.round(freed / 1e9 * 10) / 10} GB). Remaining: ${remaining.total_count}`);
