const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const scripts = [
  "test-security.js",
  "test-access-scope.js",
  "test-quality-sales-perms.js",
  "test-sale-submit-scope.js",
  "test-rpm-submission-correction.js",
  "test-rpm-sales-controls.js",
  "test-sales-submit-required.js",
  "test-employee-id-reuse.js",
  "test-airtable-sales-sync.js",
  "test-airtable-rpm-sync.js",
  "test-rbac-defaults.js",
  "test-coaching-scope.js",
  "test-announcements-audience.js",
  "test-employee-unit-team.js",
    "test-hs2-access.js",
    "test-hs2-isolation.js",
    "test-rbac-company-scope.js",
    "test-company-isolation-scenarios.js",
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

const unitTests = fs
  .readdirSync(path.join(__dirname, "..", "test"))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join("test", name));

if (unitTests.length) {
  console.log("\n=== node:test unit suite ===");
  const r = spawnSync(process.execPath, ["--test", "--test-force-exit", ...unitTests], {
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
