#!/usr/bin/env node
const assert = require("assert");
const { TEMPLATE_COLUMNS, allProvisionFields, parseCsvHeaderLine } = require("../lib/airtable-canonical-columns");

assert(TEMPLATE_COLUMNS.length >= 40, `expected >=40 template columns, got ${TEMPLATE_COLUMNS.length}`);
assert.strictEqual(TEMPLATE_COLUMNS[0], "Submission Date");
assert.strictEqual(TEMPLATE_COLUMNS[1], "Lead Type");
assert(TEMPLATE_COLUMNS.includes("Agent Name"));
assert(TEMPLATE_COLUMNS.includes("Closer Name"));
assert(TEMPLATE_COLUMNS.includes("Receipt Attachment"));
assert(TEMPLATE_COLUMNS.indexOf("Receipt Attachment") > TEMPLATE_COLUMNS.indexOf("Client"));

const extras = allProvisionFields().map((f) => f.name);
const portalIdx = extras.indexOf("Portal Sale ID");
const receiptIdx = extras.indexOf("Receipt Attachment");
assert(portalIdx > receiptIdx, "Portal Sale ID must come after template columns");

const parsed = parseCsvHeaderLine('A,"B,C",D');
assert.deepStrictEqual(parsed, ["A", "B,C", "D"]);

console.log(`airtable-canonical-columns: ${TEMPLATE_COLUMNS.length} template cols, ${extras.length} provision fields`);
console.log("All tests passed.");
