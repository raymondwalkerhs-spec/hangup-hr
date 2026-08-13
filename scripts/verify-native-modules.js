/** Quick check that native addons match the current Electron ABI. */
try {
  require("better-sqlite3");
  require("bcrypt");
  console.log("native-modules-ok");
  process.exit(0);
} catch (err) {
  console.error("native-modules-failed:", err.message);
  process.exit(1);
}
