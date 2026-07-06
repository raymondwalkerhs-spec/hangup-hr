#!/usr/bin/env node
const assert = require("assert");
const { collectReservedAppIds } = require("../lib/employee-ids");
const idGen = require("../lib/id-generator");

const deletedStub = {
  id: "DEL-abc123",
  archived_app_id: "TL08",
  status: "Deleted",
  deleted_at: "2026-01-01",
};

const active = { id: "TL09", status: "Active" };

const reserved = collectReservedAppIds([deletedStub, active]);
assert(!reserved.has("TL08"), "released archived TL08 must not be reserved");
assert(reserved.has("TL09"), "active TL09 must stay reserved");

assert.doesNotThrow(() => {
  idGen.validateAppIdForUnit("TL08", "HS-1", null, [deletedStub, active], { enforcePrefix: false });
}, "TL08 should validate when only deleted stub holds archived id");

console.log("employee-id-reuse tests passed.");
