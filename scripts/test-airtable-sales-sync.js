#!/usr/bin/env node
/** Airtable outbound sales sync — field map, client, debounced scheduler */
const fieldMap = require("../lib/airtable-sales-field-map");

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("  ok", name);
}

console.log("airtable-sales-field-map");

assert("reverseMapUnit HS-3", fieldMap.reverseMapUnit("HS-3") === "HS3");
assert("formatTeam numeric", fieldMap.formatTeamForAirtable("5") === "Team 5");
assert("reverseMapDevice bracelet", fieldMap.reverseMapDevice("bracelet") === "Bracelet");

const employees = [
  { id: "HS1-10", american_name: "Agent One" },
  { id: "TL1-01", american_name: "Closer One" },
  { id: "QV1", american_name: "Reviewer Q" },
];

const sale = {
  id: "sale-uuid-1",
  phoneNumber: "5551234567",
  fullName: "Jane Doe",
  device: "bracelet",
  price: 49.99,
  client: "Acme",
  agentId: "HS1-10",
  closerId: "TL1-01",
  unit: "HS-1",
  team: "Phoenix",
  submissionDate: "2026-07-06",
  submissionTime: "14:30",
  formData: {
    firstName: "Jane",
    lastName: "Doe",
    phoneNumber: "5551234567",
    reviewer: "QV1",
    paymentMethod: "Card",
  },
};

const fields = fieldMap.buildSaleFieldsForAirtable(sale, employees);
assert("Portal Sale ID", fields["Portal Sale ID"] === "sale-uuid-1");
assert("Center Code", fields["Center Code"] === "HS1");
assert("Agent Name resolved", fields["Agent Name"] === "Agent One");
assert("Reviewer resolved", fields.Reviewer === "Reviewer Q");
assert("First Name", fields["First Name"] === "Jane");

async function testClientAndSync() {
  const saved = {
    AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY,
    AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID,
    AIRTABLE_SYNC_ENABLED: process.env.AIRTABLE_SYNC_ENABLED,
    AIRTABLE_SYNC_DEBOUNCE_MS: process.env.AIRTABLE_SYNC_DEBOUNCE_MS,
  };

  delete process.env.AIRTABLE_API_KEY;
  delete process.env.AIRTABLE_BASE_ID;
  delete process.env.AIRTABLE_SYNC_ENABLED;

  delete require.cache[require.resolve("../lib/airtable-client")];
  delete require.cache[require.resolve("../lib/airtable-sales-sync")];
  const clientOff = require("../lib/airtable-client");
  const syncOff = require("../lib/airtable-sales-sync");
  assert("schedule no-op when unconfigured", syncOff.scheduleSaleSync("x") === undefined);

  process.env.AIRTABLE_API_KEY = "pat-test";
  process.env.AIRTABLE_BASE_ID = "appTestBase";
  process.env.AIRTABLE_SYNC_ENABLED = "true";
  process.env.AIRTABLE_SYNC_DEBOUNCE_MS = "50";
  process.env.AIRTABLE_PORTAL_SALE_ID_FIELD = "Portal Sale ID";

  delete require.cache[require.resolve("../lib/airtable-client")];
  delete require.cache[require.resolve("../lib/airtable-sales-sync")];
  const client = require("../lib/airtable-client");
  assert("isConfigured true", client.isConfigured() === true);

  const fetchCalls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
    const method = opts?.method || "GET";
    const urlStr = String(url);
    let payload;
    if (urlStr.includes("/meta/bases/")) {
      payload = { tables: [{ name: process.env.AIRTABLE_TABLE_NAME || "Sales All Data", fields: [] }] };
    } else if (method === "GET") {
      payload = { records: [] };
    } else {
      payload = { id: "recAirtable123", fields: {} };
    }
    const body = JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => body,
    };
  };

  const business = require("../lib/business-repo");
  const saleStorage = require("../lib/sale-attachment-storage");

  const origGetSale = business.getSale;
  const origReadAtt = business.readSaleAttachments;
  const origSetMeta = business.setSaleAirtableMeta;
  const origCreateShare = saleStorage.createShareUrl;
  const origCreateAirtableSync = saleStorage.createAirtableSyncUrl;
  const origIsPath = saleStorage.isSupabaseStoragePath;

  business.getSale = async () => ({
    ...sale,
    airtableRecordId: "",
  });
  business.readSaleAttachments = async () => [
    {
      kind: "recording",
      fileName: "call.mp3",
      dropboxPath: "sales-attachments/sale-uuid-1/recording/x-call.mp3",
      dropboxLink: "",
    },
  ];
  business.setSaleAirtableMeta = async () => {};
  saleStorage.isSupabaseStoragePath = () => true;
  saleStorage.createShareUrl = async () => ({ url: "https://signed.example/call.mp3", expiresInSeconds: 3600 });
  saleStorage.createAirtableSyncUrl = async () => ({ url: "https://signed.example/call.mp3", expiresInSeconds: 3600 });

  const supabaseClient = require("../lib/supabase-client");
  const origGetAdmin = supabaseClient.getSupabaseAdmin;
  supabaseClient.getSupabaseAdmin = () => ({
    from: () => ({
      select: () => Promise.resolve({ data: employees, error: null }),
    }),
  });

  delete require.cache[require.resolve("../lib/airtable-sales-sync")];
  const sync = require("../lib/airtable-sales-sync");

  const attFields = await sync.buildAirtableFields(
    await business.getSale("sale-uuid-1"),
    employees,
    await business.readSaleAttachments("sale-uuid-1")
  );
  assert(
    "attachment field array",
    Array.isArray(attFields.Recordings) && attFields.Recordings[0]?.url === "https://signed.example/call.mp3"
  );

  await sync.syncSaleById("sale-uuid-1");
  const createCall = fetchCalls.find((c) => c.opts.method === "POST");
  assert("createRecord POST", Boolean(createCall));
  assert(
    "payload has Portal Sale ID",
    createCall?.body?.fields?.["Portal Sale ID"] === "sale-uuid-1"
  );

  fetchCalls.length = 0;
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
    const method = opts?.method || "GET";
    const urlStr = String(url);
    let payload;
    if (urlStr.includes("/meta/bases/")) {
      payload = { tables: [{ name: "Sales All Data", fields: [] }] };
    } else if (method === "GET") {
      payload = { records: [{ id: "recFromLookup", fields: { "Portal Sale ID": "sale-uuid-1" } }] };
    } else {
      payload = { id: "recFromLookup", fields: {} };
    }
    const body = JSON.stringify(payload);
    return { ok: true, status: 200, json: async () => payload, text: async () => body };
  };
  business.getSale = async () => ({ ...sale, airtableRecordId: "" });
  await sync.syncSaleById("sale-uuid-1");
  assert("lookup then PATCH not POST", fetchCalls.some((c) => c.opts.method === "PATCH") && !fetchCalls.some((c) => c.opts.method === "POST"));

  const attFieldsEmpty = await sync.buildAirtableFields(
    await business.getSale("sale-uuid-1"),
    employees,
    []
  );
  assert("clears attachment column when empty", Array.isArray(attFieldsEmpty.Recordings) && attFieldsEmpty.Recordings.length === 0);

  business.getSale = async () => ({ ...sale, airtableRecordId: "recExisting" });
  fetchCalls.length = 0;
  await sync.syncSaleById("sale-uuid-1");
  const patchCall = fetchCalls.find((c) => c.opts.method === "PATCH");
  assert("updateRecord PATCH", Boolean(patchCall));
  assert("PATCH url has record id", patchCall.url.includes("recExisting"));

  let debounceRuns = 0;
  business.getSale = async () => {
    debounceRuns += 1;
    return { ...sale, airtableRecordId: "recExisting" };
  };
  fetchCalls.length = 0;
  sync.scheduleSaleSync("debounce-sale");
  sync.scheduleSaleSync("debounce-sale");
  sync.scheduleSaleSync("debounce-sale");
  await new Promise((r) => setTimeout(r, 120));
  assert("debounce coalesces", debounceRuns === 1);

  business.getSale = origGetSale;
  business.readSaleAttachments = origReadAtt;
  business.setSaleAirtableMeta = origSetMeta;
  saleStorage.createShareUrl = origCreateShare;
  saleStorage.createAirtableSyncUrl = origCreateAirtableSync;
  saleStorage.isSupabaseStoragePath = origIsPath;
  supabaseClient.getSupabaseAdmin = origGetAdmin;
  global.fetch = originalFetch;

  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

testClientAndSync()
  .then(() => {
    if (!process.exitCode) console.log("\nairtable-sales-sync tests passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
