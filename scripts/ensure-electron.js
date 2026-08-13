/** Verify Electron binary runs; rebuild native modules if ABI mismatch. */
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

function verifyNativeModules(exe) {
  const script = path.join(__dirname, "verify-native-modules.js");
  const r = spawnSync(exe, [script], { encoding: "utf8", timeout: 30000 });
  return r.status === 0;
}

function rebuildNative() {
  console.warn("[ensure-electron] Rebuilding native modules for Electron ABI…");
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(cmd, ["run", "rebuild:native"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return r.status === 0;
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

if (!verifyNativeModules(exe)) {
  if (!rebuildNative() || !verifyNativeModules(exe)) {
    console.error(
      "Native modules (better-sqlite3/bcrypt) do not match Electron.\n" +
        "Run: npm run rebuild:native"
    );
    process.exit(1);
  }
}
