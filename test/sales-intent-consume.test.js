const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("new-sale intent is consumed so /sales does not reopen the form", () => {
  const store = fs.readFileSync(path.join(__dirname, "../src/stores/sales-intent-store.ts"), "utf8");
  const page = fs.readFileSync(path.join(__dirname, "../src/pages/SalesPage.tsx"), "utf8");
  assert.match(store, /consumeNewSale/);
  assert.match(page, /consumeNewSale\(\)/);
  assert.match(page, /cairoWorkingDayToday/);
});
