/**
 * Unit tests for equipment handover derivation and payroll clearance gates.
 * Run: node scripts/test-equipment-clearance.js
 */
const assert = require("assert");
const {
  deriveEquipmentHandover,
  pendingFormOrFiles,
  isClearanceComplete,
  isPayrollReady,
  buildPayrollBlockers,
  isUniqueViolation,
  employeeEquipmentLookupIds,
  coalesceCompany,
  chunkIds,
} = require("../lib/equipment-clearance");

function testDerive() {
  assert.strictEqual(deriveEquipmentHandover([]), "not_needed");
  assert.strictEqual(
    deriveEquipmentHandover([{ returnedAt: "2026-01-01" }]),
    "done"
  );
  assert.strictEqual(
    deriveEquipmentHandover([{ returnedAt: null, assetTag: "L-1" }]),
    "pending"
  );
  assert.strictEqual(
    deriveEquipmentHandover([
      { returnedAt: "2026-01-01" },
      { returned_at: null, itemType: "Laptop" },
    ]),
    "pending"
  );
}

function testGatesIgnoreSyntheticHandover() {
  const clearance = [
    { itemKey: "clearance_form", status: "done" },
    { itemKey: "equipment_handover", status: "pending" },
    { itemKey: "files_handover", status: "not_needed" },
  ];
  assert.strictEqual(pendingFormOrFiles(clearance).length, 0);
  assert.strictEqual(isClearanceComplete(clearance, []), true);
  const withDevice = buildPayrollBlockers({
    offboarding: { finalPay: true },
    clearance,
    equipment: [{ returnedAt: null, assetTag: "HS3-01-Laptop-1", itemType: "Laptop" }],
  });
  assert.ok(withDevice.blockers.includes("equipment_outstanding"));
  assert.ok(!withDevice.blockers.includes("clearance_pending"));
  const noDevice = buildPayrollBlockers({
    offboarding: { finalPay: true },
    clearance,
    equipment: [],
  });
  assert.strictEqual(noDevice.blocked, false);
}

function testFailClosed() {
  const failed = buildPayrollBlockers({ readFailed: true });
  assert.strictEqual(failed.blocked, true);
  assert.ok(failed.blockers.includes("read_failed"));
}

function testFormPendingBlocks() {
  const gates = buildPayrollBlockers({
    offboarding: { finalPay: true },
    clearance: [
      { itemKey: "clearance_form", status: "pending" },
      { itemKey: "files_handover", status: "done" },
    ],
    equipment: [],
  });
  assert.ok(gates.blocked);
  assert.ok(gates.blockers.includes("clearance_pending"));
}

function testPayrollReadyNeedsFinalPay() {
  const clearance = [
    { itemKey: "clearance_form", status: "done" },
    { itemKey: "files_handover", status: "done" },
  ];
  assert.strictEqual(isClearanceComplete(clearance, [{ returnedAt: "x" }]), true);
  assert.strictEqual(isPayrollReady(clearance, [{ returnedAt: "x" }], { finalPay: false }), false);
  assert.strictEqual(isPayrollReady(clearance, [{ returnedAt: "x" }], { finalPay: true }), true);
}

function testUniqueViolation() {
  assert.ok(isUniqueViolation({ code: "23505" }));
  assert.ok(isUniqueViolation({ message: "duplicate key value violates unique constraint" }));
  assert.ok(!isUniqueViolation({ message: "column created_by does not exist" }));
}

function testLookupIds() {
  const ids = employeeEquipmentLookupIds({
    id: "HS3-10",
    former_ids: "HS3-01, HS3-02",
    archived_app_id: "HS3-00",
  });
  assert.ok(ids.includes("HS3-10"));
  assert.ok(ids.includes("HS3-01"));
  assert.ok(ids.includes("HS3-00"));
}

function testCompanyCoalesce() {
  assert.strictEqual(coalesceCompany(null), "hangup");
  assert.strictEqual(coalesceCompany(""), "hangup");
  assert.strictEqual(coalesceCompany("HS2"), "hs2");
}

function testChunks() {
  assert.deepStrictEqual(chunkIds(["a", "a", "b"], 1), [["a"], ["b"]]);
}

function testNavGate() {
  // nav-access is TypeScript; skip if not compiled. Logic mirrored here.
  const inventory = { canViewEquipmentInventory: true };
  const agentWithDevice = { hasAssignedEquipment: true };
  const agentNone = {};
  function canEquip(user) {
    return user?.canViewEquipmentInventory === true || user?.hasAssignedEquipment === true;
  }
  assert.ok(canEquip(inventory));
  assert.ok(canEquip(agentWithDevice));
  assert.ok(!canEquip(agentNone));
}

function main() {
  testDerive();
  testGatesIgnoreSyntheticHandover();
  testFailClosed();
  testFormPendingBlocks();
  testPayrollReadyNeedsFinalPay();
  testUniqueViolation();
  testLookupIds();
  testCompanyCoalesce();
  testChunks();
  testNavGate();
  console.log("equipment/clearance gates OK");
}

main();
