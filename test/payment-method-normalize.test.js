const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePaymentMethodValue,
  paymentMethodLabel,
  paymentMethodExportKey,
} = require("../lib/hr-constants");

test("normalizePaymentMethodValue maps legacy variants", () => {
  assert.equal(normalizePaymentMethodValue("Cash"), "cash");
  assert.equal(normalizePaymentMethodValue("cash"), "cash");
  assert.equal(normalizePaymentMethodValue("Instapay / Wallet"), "instapay");
  assert.equal(normalizePaymentMethodValue("instapay"), "instapay");
  assert.equal(normalizePaymentMethodValue("insta"), "instapay");
  assert.equal(normalizePaymentMethodValue("wallet"), "instapay");
  assert.equal(normalizePaymentMethodValue("Bank Account"), "bank");
  assert.equal(normalizePaymentMethodValue("bank"), "bank");
  assert.equal(normalizePaymentMethodValue(""), "");
});

test("paymentMethodLabel returns display labels", () => {
  assert.equal(paymentMethodLabel("cash"), "Cash");
  assert.equal(paymentMethodLabel("Instapay / Wallet"), "Instapay / Wallet");
});

test("resolvePaymentMethod prefers employee over profile", () => {
  const { resolvePaymentMethod } = require("../lib/hr-constants");
  assert.equal(resolvePaymentMethod({ payment_method: "cash" }, { paymentMethod: "bank" }), "cash");
  assert.equal(resolvePaymentMethod({ payment_method: "" }, { paymentMethod: "instapay" }), "instapay");
});

test("paymentMethodExportKey maps instapay to insta", () => {
  assert.equal(paymentMethodExportKey("instapay"), "insta");
  assert.equal(paymentMethodExportKey("Cash"), "cash");
});
