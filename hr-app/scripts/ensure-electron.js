/** Verify Electron binary runs; re-download if corrupted (spawn EFTYPE / invalid Win32). */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function electronExe() {
  try {
    return require("electron");
  } catch {
    return null;
  }
}

function runVersion(exe) {
  const r = spawnSync(exe, ["--version"], { encoding: "utf8", timeout: 15000 });
  return r.status === 0 ? (r.stdout || r.stderr || "").trim() : null;
}

const exe = electronExe();
if (!exe || !fs.existsSync(exe)) {
  console.error("Electron is not installed. Run: npm install");
  process.exit(1);
}

let version = runVersion(exe);
if (!version) {
  console.warn("Electron binary invalid — re-downloading…");
  const installJs = path.join(__dirname, "..", "node_modules", "electron", "install.js");
  const fix = spawnSync(process.execPath, [installJs], { stdio: "inherit" });
  if (fix.status !== 0) process.exit(fix.status || 1);
  version = runVersion(require("electron"));
  if (!version) {
    console.error(
      "Electron still will not run. Delete node_modules/electron and run npm install again."
    );
    process.exit(1);
  }
}
