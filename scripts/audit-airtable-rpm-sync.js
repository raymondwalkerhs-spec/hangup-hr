#!/usr/bin/env node
/**
 * Compare Supabase RPM rows to Hangup RPM Airtable and probe the Edge Function.
 * Prints IDs only (no customer names / phones).
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const COMPLETED = new Set(["dropped_with_client", "callback", "not_int", "retransfer", "sale"]);
const NQ_FAMILY = new Set(["nq", "age_limit", "under_age", "duplicate"]);

function nationalPhoneDigits(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

async function loadAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const home = process.env.USERPROFILE || process.env.HOME;
  for (const name of ["access-token", "access_token"]) {
    const p = path.join(home, ".supabase", name);
    if (fs.existsSync(p)) {
      const token = fs.readFileSync(p, "utf8").trim();
      if (token) return token;
    }
  }
  return "";
}

async function allSupabaseIds(sb, table, extraSelect = "") {
  const select = extraSelect ? `id, ${extraSelect}` : "id";
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = sb.from(table).select(select).range(from, from + page - 1);
    if (table === "rpm_checks") q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return rows;
}

async function allAirtableIds(table, field) {
  const token = process.env.AIRTABLE_API_KEY;
  const base = process.env.AIRTABLE_RPM_BASE_ID;
  const ids = new Set();
  let offset = "";
  for (;;) {
    const qs = new URLSearchParams({ pageSize: "100", "fields[]": field });
    if (offset) qs.set("offset", offset);
    const res = await fetch(
      `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?${qs}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const body = await res.json();
    if (!res.ok) throw new Error(`${table} Airtable ${res.status}: ${JSON.stringify(body.error || body)}`);
    for (const rec of body.records || []) {
      const v = String(rec.fields?.[field] || "").trim();
      if (v) ids.add(v);
    }
    offset = body.offset || "";
    if (!offset) break;
  }
  return ids;
}

async function managementQuery(sql) {
  const url = process.env.SUPABASE_URL;
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)[1];
  const token = await loadAccessToken();
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function postFunction(payload) {
  const url = process.env.SUPABASE_URL.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  const res = await fetch(`${url}/functions/v1/airtable-rpm-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 600) };
}

async function airtableRecord(table, field, id) {
  const token = process.env.AIRTABLE_API_KEY;
  const base = process.env.AIRTABLE_RPM_BASE_ID;
  const formula = `{${field}} = "${id.replace(/"/g, '\\"')}"`;
  const res = await fetch(
    `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const body = await res.json();
  return body.records?.[0] || null;
}

function missing(expected, got) {
  return expected.filter((id) => !got.has(id));
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  console.log("=== infrastructure ===");
  const triggers = await managementQuery(
    `SELECT tgname, tgrelid::regclass::text AS tbl
     FROM pg_trigger
     WHERE tgname LIKE 'trg_airtable_rpm%' AND NOT tgisinternal
     ORDER BY tgname`
  );
  console.log("triggers", JSON.stringify(triggers));
  const cfg = await managementQuery(
    `SELECT id, function_url, left(auth_header, 12) AS auth_prefix, updated_at
     FROM public._internal_airtable_rpm_config WHERE id = 1`
  );
  console.log("config", JSON.stringify(cfg));
  const pgNet = await managementQuery(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE status_code = 200)::int AS ok_200,
            count(*) FILTER (WHERE status_code IS DISTINCT FROM 200)::int AS not_200,
            count(*) FILTER (WHERE timed_out)::int AS timed_out,
            count(*) FILTER (WHERE error_msg IS NOT NULL)::int AS errors
     FROM net._http_response`
  );
  console.log("pg_net", JSON.stringify(pgNet));
  const recentNet = await managementQuery(
    `SELECT id, status_code, timed_out, left(coalesce(error_msg,''), 180) AS err, created
     FROM net._http_response ORDER BY id DESC LIMIT 8`
  );
  console.log("pg_net_recent", JSON.stringify(recentNet));

  console.log("\n=== coverage ===");
  const sales = await allSupabaseIds(sb, "rpm_sales");
  const checks = await allSupabaseIds(
    sb,
    "rpm_checks",
    "check_status, feedback_status, phone, phone_normalized, linked_rpm_sale_id"
  );
  const qExpected = checks
    .filter((c) => c.check_status === "q" && COMPLETED.has(String(c.feedback_status || "")))
    .map((c) => c.id);
  const nqExpected = checks
    .filter(
      (c) =>
        NQ_FAMILY.has(String(c.check_status || "")) &&
        nationalPhoneDigits(c.phone || c.phone_normalized).length === 10
    )
    .map((c) => c.id);

  const atSales = await allAirtableIds("RPM Sales", "Portal Sale ID");
  const atQ = await allAirtableIds("Q Feedback", "Portal Check ID");
  const atNq = await allAirtableIds("NQ Checks", "Portal Check ID");

  const saleIds = sales.map((r) => r.id);
  const missSales = missing(saleIds, atSales);
  const missQ = missing(qExpected, atQ);
  const missNq = missing(nqExpected, atNq);
  const extraQ = [...atQ].filter((id) => !qExpected.includes(id));
  const extraNq = [...atNq].filter((id) => !nqExpected.includes(id));

  console.log(
    JSON.stringify(
      {
        supabase_sales: saleIds.length,
        airtable_sales: atSales.size,
        missing_sales: missSales.length,
        missing_sales_ids: missSales.slice(0, 20),
        supabase_completed_q: qExpected.length,
        airtable_q: atQ.size,
        missing_q: missQ.length,
        missing_q_ids: missQ.slice(0, 20),
        supabase_nq_with_phone: nqExpected.length,
        airtable_nq: atNq.size,
        missing_nq: missNq.length,
        missing_nq_ids: missNq.slice(0, 20),
        extra_q: extraQ.length,
        extra_nq: extraNq.length,
      },
      null,
      2
    )
  );

  console.log("\n=== live function probes ===");
  const saleSample = saleIds[0];
  const qSample = qExpected[0];
  const nqSample = nqExpected[0];
  if (saleSample) {
    const r = await postFunction({
      type: "UPDATE",
      table: "rpm_sales",
      record: { id: saleSample },
      old_record: { id: saleSample, _probe: true },
    });
    console.log("sale_post", r.status, r.body);
    const rec = await airtableRecord("RPM Sales", "Portal Sale ID", saleSample);
    const f = rec?.fields || {};
    console.log("sale_fields", {
      rec: rec?.id || null,
      hasName: Boolean(f["Full Name"]),
      hasPhone: Boolean(f["Phone Number"]),
      client: f.Client || null,
      center: f["Center Code"] || null,
      member: Boolean(f["Member ID"]),
      recordings: Array.isArray(f.Recordings) ? f.Recordings.length : 0,
      quality: Array.isArray(f["Quality Record"]) ? f["Quality Record"].length : 0,
    });
  }
  if (qSample) {
    const r = await postFunction({
      type: "UPDATE",
      table: "rpm_checks",
      record: { id: qSample },
      old_record: { id: qSample, _probe: true },
    });
    console.log("q_post", r.status, r.body);
    const rec = await airtableRecord("Q Feedback", "Portal Check ID", qSample);
    const f = rec?.fields || {};
    console.log("q_fields", {
      rec: rec?.id || null,
      feedback: f.Feedback || null,
      hasPhone: Boolean(f["Phone No"]),
      hasAgent: Boolean(f["Agent Name"]),
      linkedSale: Array.isArray(f["RPM Sale"]) ? f["RPM Sale"].length : 0,
    });
  }
  if (nqSample) {
    const r = await postFunction({
      type: "UPDATE",
      table: "rpm_checks",
      record: { id: nqSample },
      old_record: { id: nqSample, _probe: true },
    });
    console.log("nq_post", r.status, r.body);
    const rec = await airtableRecord("NQ Checks", "Portal Check ID", nqSample);
    const f = rec?.fields || {};
    console.log("nq_fields", {
      rec: rec?.id || null,
      status: f.Status || null,
      hasPhone: Boolean(f["Phone No"]),
      hasAgent: Boolean(f["Agent Name"]),
    });
  }

  const { count: empCount, error: empErr } = await sb
    .from("employees")
    .select("id", { count: "exact", head: true });
  console.log("employees", empCount, empErr?.message || "");

  const { data: att } = await sb.from("rpm_sales_attachments").select("id, rpm_sale_id, kind").limit(3);
  console.log("attachment_sample_kinds", (att || []).map((a) => a.kind));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
