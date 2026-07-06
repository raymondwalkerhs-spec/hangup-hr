const { spawnSync } = require("child_process");
const path = require("path");
const scripts = [
  "test-access-scope.js",
  "test-quality-sales-perms.js",
  "test-sale-submit-scope.js",
  "test-sales-submit-required.js",
  "test-employee-id-reuse.js",
  "test-airtable-sales-sync.js",
  "test-rbac-defaults.js",
  "test-fp-import.js",
  "test-training-payroll.js",
];
let failed = 0;
for (const name of scripts) {
  console.log("\n=== " + name + " ===");
  const r = spawnSync(process.execPath, [path.join(__dirname, name)], {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
  if (r.status !== 0) failed += 1;
}
if (failed) {
  console.error("\n" + failed + " test script(s) failed.");
  process.exit(1);
}
console.log("\nAll test scripts passed.");
