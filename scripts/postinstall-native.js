/**
 * Rebuild native addons (better-sqlite3, bcrypt) for the installed Electron ABI.
 * Skipped when SKIP_NATIVE_REBUILD=1 (CI) or Electron is not installed.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

if (process.env.SKIP_NATIVE_REBUILD === "1") {
  process.exit(0);
}

const root = path.join(__dirname, "..");
const electronPkg = path.join(root, "node_modules", "electron", "package.json");

if (!fs.existsSync(electronPkg)) {
  console.warn("[postinstall-native] Electron not installed — skipping native rebuild.");
  process.exit(0);
}

console.log("[postinstall-native] Rebuilding better-sqlite3 + bcrypt for Electron…");
const r = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["@electron/rebuild", "-f", "-w", "better-sqlite3,bcrypt"],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" }
);

if (r.status !== 0) {
  console.warn(
    "[postinstall-native] Rebuild failed. Run manually: npm run rebuild:native"
  );
  process.exit(0);
}

const electronExe = require("electron");
const electronVerify = spawnSync(electronExe, [path.join(__dirname, "verify-native-modules.js")], {
  cwd: root,
  encoding: "utf8",
});
if (electronVerify.status !== 0) {
  console.warn("[postinstall-native] Verify failed under Electron. Run: npm run rebuild:native");
} else {
  console.log("[postinstall-native] Native modules OK for Electron.");
}
