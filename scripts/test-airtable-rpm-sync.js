#!/usr/bin/env node
/** RPM Airtable field maps + upsert (no live API required). */
const salesMap = require("../lib/airtable-rpm-sales-field-map");
const qMap = require("../lib/airtable-rpm-qfeedback-field-map");
const nqMap = require("../lib/airtable-rpm-nq-field-map");
const { upsertByPortalId } = require("../lib/airtable-upsert");
const cols = require("../lib/airtable-rpm-canonical-columns");
const { normalizeFieldsForSchema } = require("../lib/airtable-client");

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("  ok", name);
}

const employees = [
  { id: "HS3-12", american_name: "Agent One" },
  { id: "CL01", american_name: "Closer One" },
  { id: "QV1", american_name: "Reviewer Q" },
];

console.log("airtable-rpm-sales-field-map");
const sale = {
  id: "sale-uuid-rpm",
  phoneNumber: "5551234567",
  fullName: "Jane Doe",
  client: "RPM1",
  memberId: "3TN0P59YG24",
  agentId: "HS3-12",
  closerId: "CL01",
  unit: "HS-3",
  team: "Ayla",
  status: "pending",
  submissionDate: "2026-08-25",
  submissionTime: "14:30",
  effectiveDate: "2026-08-25",
  formData: {
    leadType: "RPM PH",
    fullName: "Jane Doe",
    alternativePhone: "5559990000",
    dateOfBirth: "1950-08-06",
    email: "jane@example.com",
    address: "123 Main",
    gender: "Female",
    medicalConditions: ["Diabetes", "High blood pressure"],
    emergencyFullName: "John Doe",
    emergencyPhone: "5550001111",
    emergencyRelation: "Son",
    reviewer: "QV1",
    reviewerFeedback: "Pending",
    clientFeedback: "Pending",
  },
};
const sFields = salesMap.buildRpmSaleFieldsForAirtable(sale, employees, { linkedCheckId: "check-1" });
assert("Portal Sale ID", sFields["Portal Sale ID"] === "sale-uuid-rpm");
assert("does not split fullName", sFields["First Name"] == null && sFields["Full Name"] === "Jane Doe");
assert("Center Code HS3", sFields["Center Code"] === "HS3");
assert("Team prefix", sFields.Team === "Team Ayla");
assert("Agent Name", sFields["Agent Name"] === "Agent One");
assert("Reviewer", sFields.Reviewer === "Reviewer Q");
assert("Portal Check ID", sFields["Portal Check ID"] === "check-1");
assert("medical multi", Array.isArray(sFields["Medical Conditions"]) && sFields["Medical Conditions"].includes("Diabetes"));
assert("submission date is Cairo not UTC+3", sFields["Submission Date"] === "2026-08-25T11:30:00.000Z");
const { cairoLocalToUtcIso } = require("../lib/egypt-datetime");
assert("cairo 14:30 Aug → 11:30Z", cairoLocalToUtcIso("2026-08-25", "14:30") === "2026-08-25T11:30:00.000Z");
assert("cairo 10:15 Aug → 07:15Z", cairoLocalToUtcIso("2026-08-25", "10:15") === "2026-08-25T07:15:00.000Z");

const rpm3Fields = salesMap.buildRpmSaleFieldsForAirtable(
  { ...sale, id: "sale-uuid-rpm3", client: "RPM3", formData: { ...sale.formData, client: "RPM3" } },
  employees
);
assert("RPM3 Client mapped", rpm3Fields.Client === "RPM3");
const clientSchema = new Map([
  ["Client", { type: "singleSelect", choices: new Set(["RPM1", "RPM2"]) }],
  ["Portal Sale ID", { type: "singleLineText", choices: new Set() }],
]);
const stripped = normalizeFieldsForSchema({ Client: "RPM3", "Portal Sale ID": "x" }, clientSchema);
assert("RPM3 stripped without typecast", stripped.Client == null);
const kept = normalizeFieldsForSchema({ Client: "RPM3", "Portal Sale ID": "x" }, clientSchema, { typecast: true });
assert("RPM3 kept with typecast", kept.Client === "RPM3");

console.log("airtable-rpm-qfeedback-field-map");
assert("open Q not completed", qMap.isCompletedFeedback(null) === false);
assert("sale is completed", qMap.isCompletedFeedback("sale") === true);
assert("callback label", qMap.feedbackLabel("callback") === "CallBack");

const check = {
  id: "check-uuid-1",
  phone: "5551234567",
  team: "Ayla",
  unit: "HS3",
  agentId: "HS3-12",
  closerId: "CL01",
  feedbackStatus: "callback",
  info: "call back tomorrow",
  fullName: "Jane Doe",
  dateOfBirth: "1950-08-06",
  memberId: "3TN0P59YG24",
  workingDay: "2026-08-25",
  submissionDate: "2026-08-25",
  submissionTime: "10:15",
  linkedRpmSaleId: null,
};
const qFields = qMap.buildQFeedbackFieldsForAirtable(check, employees);
assert("Portal Check ID", qFields["Portal Check ID"] === "check-uuid-1");
assert("Feedback CallBack", qFields.Feedback === "CallBack");
assert("q timestamp Cairo", qFields.Timestamp === "2026-08-25T07:15:00.000Z");
assert("no sale link", Array.isArray(qFields["RPM Sale"]) && qFields["RPM Sale"].length === 0);
assert("empty Portal Sale ID", qFields["Portal Sale ID"] === "");

const linked = qMap.buildQFeedbackFieldsForAirtable(
  { ...check, feedbackStatus: "sale", linkedRpmSaleId: "sale-uuid-rpm" },
  employees,
  { saleAirtableRecordId: "recSale1" }
);
assert("sale label", linked.Feedback === "Sale");
assert("linked record", linked["RPM Sale"][0] === "recSale1");
assert("Portal Sale ID set", linked["Portal Sale ID"] === "sale-uuid-rpm");

console.log("airtable-rpm-canonical-columns");
assert("sales primary Full Name", cols.RPM_SALES_COLUMNS[0].name === "Full Name");
assert("sales Portal Sale ID", cols.RPM_SALES_COLUMNS.some((c) => c.name === "Portal Sale ID"));
assert(
  "Client includes RPM3",
  (cols.RPM_SALES_COLUMNS.find((c) => c.name === "Client")?.options?.choices || []).some((c) => c.name === "RPM3")
);
assert("q Timestamp", cols.Q_FEEDBACK_COLUMNS[0].name === "Timestamp");
assert("q Portal Check ID", cols.Q_FEEDBACK_COLUMNS.some((c) => c.name === "Portal Check ID"));
assert("NQ table name", cols.NQ_CHECKS_TABLE_NAME === "NQ Checks");
assert("NQ Status field", cols.NQ_CHECKS_COLUMNS.some((c) => c.name === "Status"));

console.log("airtable-rpm-nq-field-map");
assert("nq family age_limit", nqMap.isNqFamilyCheck("age_limit") === true);
assert("q not nq family", nqMap.isNqFamilyCheck("q") === false);
const nqFields = nqMap.buildNqCheckFieldsForAirtable(
  {
    id: "check-nq-1",
    checkStatus: "duplicate",
    phone: "5551234567",
    team: "Ayla",
    unit: "HS3",
    agentId: "HS3-12",
    memberId: "3TN0P59YG24",
    workingDay: "2026-08-25",
  },
  employees
);
assert("NQ Status Duplicate", nqFields.Status === "Duplicate");
assert("NQ Portal Check ID", nqFields["Portal Check ID"] === "check-nq-1");
assert("NQ Phone form digits", nqFields["Phone No"] === "5551234567");
assert("has form phone", nqMap.hasFormPhone("555-123-4567") === true);
assert("no form phone", nqMap.hasFormPhone("") === false);
assert("junk phone ignored", nqMap.hasFormPhone("0") === false);
const nqBlank = nqMap.buildNqCheckFieldsForAirtable(
  { id: "check-nq-blank", checkStatus: "nq", phone: "", memberId: "x" },
  employees
);
assert("blank phone omitted", nqBlank["Phone No"] == null);

const { businessUpdatedAfterSync } = require("../lib/airtable-rpm-realtime");
assert(
  "realtime skips meta write",
  businessUpdatedAfterSync({
    updated_at: "2026-08-25T10:00:00.000Z",
    airtable_synced_at: "2026-08-25T10:00:01.000Z",
  }) === false
);
assert(
  "realtime runs after row edit",
  businessUpdatedAfterSync({
    updated_at: "2026-08-25T10:00:05.000Z",
    airtable_synced_at: "2026-08-25T10:00:01.000Z",
  }) === true
);

async function testUpsert() {
  console.log("airtable-upsert");
  const created = [];
  const patched = [];
  const deleted = [];
  const client = {
    findAllRecordsByField: async () => [],
    createRecord: async (fields) => {
      created.push(fields);
      return "recNew";
    },
    updateRecord: async (id) => {
      patched.push(id);
      return id;
    },
    deleteRecordsBatch: async (ids) => {
      deleted.push(...ids);
      return ids.length;
    },
  };

  const id1 = await upsertByPortalId(client, {
    storedRecordId: "",
    portalField: "Portal Sale ID",
    portalId: "sale-1",
    fields: { "Portal Sale ID": "sale-1" },
  });
  assert("first write POSTs", id1 === "recNew" && created.length === 1);

  const client2 = {
    findAllRecordsByField: async () => [{ id: "recNew", fields: { "Portal Sale ID": "sale-1" } }],
    createRecord: async () => {
      throw new Error("must not POST");
    },
    updateRecord: async (id) => {
      patched.push(id);
      return id;
    },
    deleteRecordsBatch: async (ids) => {
      deleted.push(...ids);
      return ids.length;
    },
  };
  const id2 = await upsertByPortalId(client2, {
    storedRecordId: "",
    portalField: "Portal Sale ID",
    portalId: "sale-1",
    fields: { "Full Name": "Jane" },
  });
  assert("second write PATCHes lookup", id2 === "recNew");

  const id3 = await upsertByPortalId(client2, {
    storedRecordId: "recNew",
    portalField: "Portal Sale ID",
    portalId: "sale-1",
    fields: { "Full Name": "Jane Edited" },
  });
  assert("stored id PATCHes", id3 === "recNew");

  const dupClient = {
    findAllRecordsByField: async () => [
      { id: "recA", fields: {} },
      { id: "recB", fields: {} },
    ],
    createRecord: async () => {
      throw new Error("must not POST");
    },
    updateRecord: async (id) => id,
    deleteRecordsBatch: async (ids) => {
      deleted.push(...ids);
      return ids.length;
    },
  };
  const keep = await upsertByPortalId(dupClient, {
    storedRecordId: "",
    portalField: "Portal Sale ID",
    portalId: "sale-1",
    fields: {},
  });
  assert("dedupe keeps one", keep === "recA" && deleted.includes("recB"));
}

const { rpmSyncFromApp } = require("../lib/airtable-rpm-targets");
assert("app is not the Airtable writer by default", rpmSyncFromApp() === false);

testUpsert()
  .then(() => {
    if (!process.exitCode) console.log("\nairtable-rpm tests passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
