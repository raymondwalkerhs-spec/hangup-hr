const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isOtherAgentId, excludeOtherAgents, OTHER_AGENT_ID } = require("../lib/other-agent");
const { findPatchForInstall } = require("../lib/cloud-updater");
const { lineVersion, sameLineVersion } = require("../lib/app-version");

test("OTHER agent id is recognized", () => {
  assert.equal(isOtherAgentId("OTHER"), true);
  assert.equal(isOtherAgentId("other"), true);
  assert.equal(isOtherAgentId("HS1-01"), false);
  assert.equal(OTHER_AGENT_ID, "OTHER");
  assert.deepEqual(excludeOtherAgents([{ id: "HS1-01" }, { id: "OTHER" }]), [{ id: "HS1-01" }]);
});

test("patch matches installed version or line baseline", () => {
  const patches = [
    { from_version: "2.4.1", version: "2.4.3" },
    { from_version: "2.4.2", version: "2.4.3" },
  ];
  assert.equal(findPatchForInstall(patches, "2.4.2", "2.4.1").from_version, "2.4.2");
  assert.equal(findPatchForInstall(patches, "2.4.1", "2.4.1").from_version, "2.4.1");
  assert.equal(findPatchForInstall(patches, "2.3.28", "2.4.1"), null);
});

test("line version groups 2.4.x", () => {
  assert.equal(lineVersion("2.4.1"), "2.4");
  assert.equal(sameLineVersion("2.4.1", "2.4.7"), true);
  assert.equal(sameLineVersion("2.4.1", "2.5.0"), false);
});
