#!/usr/bin/env node
const assert = require("assert");
const { validateSaleSubmitPayload } = require("../lib/sales-submit-required");

function baseBody(overrides = {}) {
  return {
    agentId: "AG001",
    closerId: "CL001",
    unit: "Unit A",
    team: "Team 1",
    device: "Smart Watch",
    client: "Acme",
    salesClientId: "c1",
    salesProductId: "p1",
    salesPriceId: "pr1",
    phoneNumber: "5551234567",
    formData: {
      phoneNumber: "5551234567",
      firstName: "Jane",
      lastName: "Doe",
      dateOfBirth: "1990-01-01",
      streetAddress: "1 Main St",
      cityName: "Cairo",
      state: "NY",
      zipCode: "10001",
      emergencyFirstName: "John",
      emergencyLastName: "Doe",
      emergencyPhone: "5559876543",
      emergencyRelation: "Spouse",
      firstTimeDevice: "Yes",
      medicalConditions: "None",
      payerName: "Jane Doe",
      paymentMethod: "Card",
      cardNumber: "4111111111111111",
      cardExpDate: "12/28",
      cvv: "123",
      salesClientId: "c1",
      salesProductId: "p1",
      salesPriceId: "pr1",
    },
    ...overrides,
  };
}

let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("  ok", name);
  } catch (err) {
    failed += 1;
    console.error("  FAIL", name, err.message);
  }
}

test("missing firstName fails", () => {
  const body = baseBody();
  delete body.formData.firstName;
  const r = validateSaleSubmitPayload(body, { hasCatalog: true, skipRecording: true });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.key === "firstName"));
});

test("bank payment requires bank fields", () => {
  const body = baseBody();
  body.formData.paymentMethod = "Bank account";
  delete body.formData.cardNumber;
  delete body.formData.cardExpDate;
  delete body.formData.cvv;
  const r = validateSaleSubmitPayload(body, { hasCatalog: true, skipRecording: true });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.key === "routingNumber"));
});

test("firstTimeDevice No requires serviceActiveInfo", () => {
  const body = baseBody();
  body.formData.firstTimeDevice = "No";
  delete body.formData.serviceActiveInfo;
  const r = validateSaleSubmitPayload(body, { hasCatalog: true, skipRecording: true });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.key === "serviceActiveInfo"));
});

test("recording required on submit by default", () => {
  const body = baseBody();
  const r = validateSaleSubmitPayload(body, { hasCatalog: true });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.key === "recording"));
});

test("valid payload passes with recording", () => {
  const body = baseBody();
  const r = validateSaleSubmitPayload(body, {
    hasCatalog: true,
    attachmentKinds: ["recording"],
  });
  assert.strictEqual(r.ok, true);
});

if (failed) {
  console.error("\n" + failed + " assertion(s) failed.");
  process.exit(1);
}
console.log("\nAll sales-submit-required tests passed.");
