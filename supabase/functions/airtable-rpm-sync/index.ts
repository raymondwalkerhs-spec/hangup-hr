import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const AIRTABLE_ROOT = "https://api.airtable.com/v0";
const SALES_TABLE = "RPM Sales";
const Q_TABLE = "Q Feedback";
const NQ_TABLE = "NQ Checks";
const ATTACH_COLS = {
  recording: "Recordings",
  quality_record: "Quality Record",
  raw_call: "Raw call record",
};
const COMPLETED_FEEDBACK = new Set(["dropped_with_client", "callback", "not_int", "retransfer", "sale"]);
const NQ_FAMILY = new Set(["nq", "age_limit", "under_age", "duplicate"]);
const CHECK_STATUS_LABELS = {
  nq: "NQ",
  age_limit: "Age limit",
  under_age: "Under Age",
  duplicate: "Duplicate",
};
const FEEDBACK_LABELS = {
  dropped_with_client: "Dropped with Client",
  callback: "CallBack",
  not_int: "Not Int",
  retransfer: "Retransfer",
  sale: "Sale",
};
const META_KEYS = new Set(["airtable_record_id", "airtable_synced_at", "airtable_sync_error"]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authorized(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const expected = [
    Deno.env.get("AIRTABLE_RPM_SYNC_SECRET"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  return expected.includes(token);
}

function asText(val: unknown) {
  if (val == null) return "";
  if (Array.isArray(val)) return val.filter(Boolean).join(", ");
  return String(val).trim();
}

function reverseMapUnit(unit: unknown) {
  const u = String(unit || "").trim().toUpperCase();
  if (u === "HS-3" || u === "HS3") return "HS3";
  if (u === "HS-1" || u === "HS1") return "HS1";
  if (u === "HS-2" || u === "HS2") return "HS2";
  return String(unit || "").replace(/^HS-/i, "HS");
}

function formatTeamForAirtable(team: unknown) {
  const t = String(team || "").trim();
  if (!t) return "";
  if (/^team\s+/i.test(t)) return t;
  if (/^hs\s*\d/i.test(t)) return t;
  return `Team ${t}`;
}

function formatDateForAirtable(val: unknown) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mo, da, yr] = m;
    return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
  }
  return null;
}

function cairoWallAsUtcMs(ms: number) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
}

function cairoLocalToUtcIso(dateVal: unknown, timeVal?: unknown) {
  const date = String(dateVal || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const tm = String(timeVal || "12:00:00").trim();
  const m = tm.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hour = m ? parseInt(m[1], 10) : 12;
  const minute = m ? parseInt(m[2], 10) : 0;
  const second = m && m[3] != null ? parseInt(m[3], 10) : 0;
  const [year, month, day] = date.split("-").map(Number);
  const want = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = want;
  for (let i = 0; i < 4; i += 1) {
    const diff = cairoWallAsUtcMs(guess) - want;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess).toISOString();
}

function formatDateTimeForAirtable(dateVal: unknown, timeVal?: unknown) {
  const date = formatDateForAirtable(dateVal);
  if (!date) return null;
  const time = String(timeVal || "").trim();
  if (time && /^\d{1,2}:\d{2}/.test(time)) return cairoLocalToUtcIso(date, time);
  return cairoLocalToUtcIso(date, "12:00:00");
}

function formatInstantForAirtable(val: unknown) {
  const d = val instanceof Date ? val : new Date(String(val || ""));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function medicalList(val: unknown) {
  if (Array.isArray(val)) return (val as unknown[]).map((v) => String(v).trim()).filter(Boolean);
  const s = String(val || "").trim();
  if (!s) return [];
  return s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
}

function employeeNameById(employees: { id: string; american_name?: string; americanName?: string }[], id: unknown) {
  if (!id) return "";
  const hit = (employees || []).find((e) => e.id === id);
  return hit?.american_name || hit?.americanName || "";
}

function nationalPhoneDigits(phone: unknown) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

function hasFormPhone(phone: unknown) {
  return nationalPhoneDigits(phone).length === 10;
}

function timestampForCheck(check: Record<string, unknown>) {
  if (check.submission_date) {
    return formatDateTimeForAirtable(check.submission_date, check.submission_time);
  }
  if (check.created_at) {
    return formatInstantForAirtable(check.created_at);
  }
  if (check.working_day) return formatDateTimeForAirtable(check.working_day, check.submission_time);
  return null;
}

function airtableClient() {
  const token = (Deno.env.get("AIRTABLE_API_KEY") || Deno.env.get("AIRTABLE_RPM_TOKEN") || "").trim();
  const baseId = (Deno.env.get("AIRTABLE_RPM_BASE_ID") || "").trim();
  if (!token || !baseId) throw new Error("AIRTABLE_API_KEY and AIRTABLE_RPM_BASE_ID must be set as function secrets");
  async function request(method: string, path: string, body?: unknown) {
    const res = await fetch(`${AIRTABLE_ROOT}/${baseId}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message || res.statusText || `HTTP ${res.status}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    return data;
  }
  return {
    async findByField(table: string, field: string, value: string) {
      const needle = String(value || "").trim();
      if (!needle) return [];
      const formula = `{${field}} = "${needle.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      const records: { id: string; fields: Record<string, unknown> }[] = [];
      let offset = "";
      for (;;) {
        const qs = new URLSearchParams({ filterByFormula: formula });
        if (offset) qs.set("offset", offset);
        const data = await request("GET", `${encodeURIComponent(table)}?${qs}`);
        records.push(...(data.records || []));
        offset = data.offset || "";
        if (!offset) break;
      }
      return records;
    },
    async upsert(table: string, field: string, id: string, fields: Record<string, unknown>) {
      const matches = await this.findByField(table, field, id);
      const body = { fields, typecast: true };
      if (matches.length) {
        const keep = matches[0];
        for (const extra of matches.slice(1)) {
          await request("DELETE", `${encodeURIComponent(table)}/${extra.id}`);
        }
        await request("PATCH", `${encodeURIComponent(table)}/${keep.id}`, body);
        return keep.id;
      }
      const created = await request("POST", encodeURIComponent(table), body);
      return created?.id || null;
    },
    async deleteByField(table: string, field: string, id: string) {
      const matches = await this.findByField(table, field, id);
      for (const rec of matches) {
        await request("DELETE", `${encodeURIComponent(table)}/${rec.id}`);
      }
      return matches.length;
    },
  };
}

function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, key, { auth: { persistSession: false } });
}

function onlyMetaChanged(neu: Record<string, unknown> | null, old: Record<string, unknown> | null) {
  if (!neu || !old) return false;
  const keys = new Set([...Object.keys(neu), ...Object.keys(old)]);
  for (const k of keys) {
    if (META_KEYS.has(k)) continue;
    if (JSON.stringify(neu[k]) !== JSON.stringify(old[k])) return false;
  }
  return true;
}

function buildSaleFields(sale: Record<string, unknown>, employees: { id: string; american_name?: string }[], linkedCheckId: string) {
  const fields: Record<string, unknown> = {};
  const form = { ...((sale.form_data as Record<string, unknown>) || {}) };
  if (sale.id) fields["Portal Sale ID"] = sale.id;
  const fullName = sale.full_name || form.fullName || "";
  if (fullName) fields["Full Name"] = fullName;
  if (sale.submission_date) {
    fields["Submission Date"] = formatDateTimeForAirtable(sale.submission_date, sale.submission_time);
  }
  const leadType = form.leadType || "RPM PH";
  if (leadType) fields["Lead Type"] = leadType;
  const client = sale.client || form.client;
  if (client) fields.Client = client;
  const unit = sale.unit || form.unit;
  if (unit) fields["Center Code"] = reverseMapUnit(unit);
  const team = sale.team || form.team;
  if (team) fields.Team = formatTeamForAirtable(team);
  const agentName = form.agentName || employeeNameById(employees, sale.agent_id);
  if (agentName) fields["Agent Name"] = agentName;
  const closerName = form.closerName || employeeNameById(employees, sale.closer_id);
  if (closerName) fields["Closer Name"] = closerName;
  const phone = sale.phone_number || form.phoneNumber;
  if (phone) fields["Phone Number"] = asText(phone);
  const alt = form.alternativePhone || form.alternativePhoneNumber;
  if (alt) fields["Alternative Phone Number"] = asText(alt);
  const dob = formatDateForAirtable(form.dateOfBirth);
  if (dob) fields["Date Of Birth"] = dob;
  const memberId = sale.member_id || form.memberId;
  if (memberId) fields["Member ID"] = asText(memberId);
  if (form.email) fields["Email Address"] = asText(form.email);
  if (form.address) fields.Address = asText(form.address);
  if (form.gender) fields.Gender = asText(form.gender);
  const medical = medicalList(form.medicalConditions);
  if (medical.length) fields["Medical Conditions"] = medical;
  if (form.emergencyFullName) fields["Emergency Contact Full Name"] = asText(form.emergencyFullName);
  if (form.emergencyPhone) fields["Emergency Contact Phone"] = asText(form.emergencyPhone);
  if (form.emergencyRelation) fields["Emergency Contact Relation"] = asText(form.emergencyRelation);
  if (form.notes) fields.Notes = asText(form.notes);
  const reviewer = form.reviewer ? employeeNameById(employees, form.reviewer) || asText(form.reviewer) : "";
  if (reviewer) fields.Reviewer = reviewer;
  if (form.reviewerFeedback) fields["Reviewer feedback"] = asText(form.reviewerFeedback);
  if (form.clientFeedback) fields["Client feedback"] = asText(form.clientFeedback);
  if (form.clientFeedbackComments) fields["Client feedback comments"] = asText(form.clientFeedbackComments);
  if (form.internalFeedback) fields["Internal feedback"] = asText(form.internalFeedback);
  if (sale.status) fields["Workflow status"] = asText(sale.status);
  const effective = formatDateForAirtable(sale.effective_date);
  if (effective) fields["Effective date"] = effective;
  if (linkedCheckId) fields["Portal Check ID"] = linkedCheckId;
  return fields;
}

function buildQFields(check: Record<string, unknown>, employees: { id: string; american_name?: string }[], saleRec: string) {
  const fields: Record<string, unknown> = {};
  if (check.id) fields["Portal Check ID"] = check.id;
  const ts = timestampForCheck(check);
  if (ts) fields.Timestamp = ts;
  if (check.phone) fields["Phone No"] = String(check.phone);
  if (check.team) fields.Team = formatTeamForAirtable(check.team);
  if (check.unit) fields.Unit = reverseMapUnit(check.unit);
  const agentName = employeeNameById(employees, check.agent_id);
  if (agentName) fields["Agent Name"] = agentName;
  const closerName = employeeNameById(employees, check.closer_id);
  if (closerName) fields.Closer = closerName;
  if (COMPLETED_FEEDBACK.has(String(check.feedback_status || ""))) {
    fields.Feedback = FEEDBACK_LABELS[check.feedback_status as keyof typeof FEEDBACK_LABELS] || check.feedback_status;
  }
  if (check.info) fields.Info = String(check.info);
  if (check.full_name) fields["Full Name"] = String(check.full_name);
  const dob = formatDateForAirtable(check.date_of_birth);
  if (dob) fields["Date Of Birth"] = dob;
  if (check.member_id) fields["Member ID"] = String(check.member_id);
  const wd = formatDateForAirtable(check.working_day);
  if (wd) fields["Working Day"] = wd;
  if (check.feedback_at) {
    const at = formatInstantForAirtable(check.feedback_at);
    if (at) fields["Feedback At"] = at;
  }
  fields["Portal Sale ID"] = check.linked_rpm_sale_id || "";
  fields["RPM Sale"] = saleRec ? [saleRec] : [];
  return fields;
}

function buildNqFields(check: Record<string, unknown>, employees: { id: string; american_name?: string }[]) {
  const fields: Record<string, unknown> = {};
  if (check.id) fields["Portal Check ID"] = check.id;
  const ts = timestampForCheck(check);
  if (ts) fields.Timestamp = ts;
  const phone = nationalPhoneDigits(check.phone || check.phone_normalized);
  if (phone.length === 10) fields["Phone No"] = phone;
  if (check.team) fields.Team = formatTeamForAirtable(check.team);
  if (check.unit) fields.Unit = reverseMapUnit(check.unit);
  const agentName = employeeNameById(employees, check.agent_id);
  if (agentName) fields["Agent Name"] = agentName;
  if (NQ_FAMILY.has(String(check.check_status || ""))) {
    fields.Status = CHECK_STATUS_LABELS[check.check_status as keyof typeof CHECK_STATUS_LABELS] || check.check_status;
  }
  if (check.info) fields.Info = String(check.info);
  if (check.full_name) fields["Full Name"] = String(check.full_name);
  const dob = formatDateForAirtable(check.date_of_birth);
  if (dob) fields["Date Of Birth"] = dob;
  if (check.member_id) fields["Member ID"] = String(check.member_id);
  const wd = formatDateForAirtable(check.working_day);
  if (wd) fields["Working Day"] = wd;
  return fields;
}

async function loadEmployees(sb: ReturnType<typeof supabaseAdmin>, ids: unknown[]) {
  const want = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!want.length) return [];
  const { data, error } = await sb.from("employees").select("id, american_name").in("id", want);
  if (error) throw new Error(error.message);
  return data || [];
}

async function attachmentFields(sb: ReturnType<typeof supabaseAdmin>, saleId: string) {
  const { data, error } = await sb.from("rpm_sales_attachments").select("kind, file_name, dropbox_path, dropbox_link").eq("rpm_sale_id", saleId);
  if (error) throw new Error(error.message);
  const out: Record<string, { url: string; filename: string }[]> = {};
  for (const col of Object.values(ATTACH_COLS)) out[col] = [];
  const bucket = Deno.env.get("SUPABASE_STORAGE_BUCKET") || "hr-documents";
  for (const att of data || []) {
    const col = ATTACH_COLS[att.kind as keyof typeof ATTACH_COLS];
    if (!col) continue;
    let url = att.dropbox_link || "";
    const storagePath = att.dropbox_path || "";
    if (storagePath && !/^https?:/i.test(storagePath)) {
      try {
        const signed = await sb.storage.from(bucket).createSignedUrl(storagePath, 60 * 60 * 2);
        if (signed.data?.signedUrl) url = signed.data.signedUrl;
      } catch {
        /* keep dropbox_link fallback */
      }
    }
    if (!url) continue;
    out[col].push({ url, filename: att.file_name || "attachment" });
  }
  return out;
}

async function syncSale(sb: ReturnType<typeof supabaseAdmin>, airtable: ReturnType<typeof airtableClient>, saleId: string) {
  const { data: sale, error } = await sb.from("rpm_sales").select("*").eq("id", saleId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!sale) {
    await airtable.deleteByField(SALES_TABLE, "Portal Sale ID", saleId);
    return { deleted: true };
  }
  const form = (sale.form_data as Record<string, unknown>) || {};
  const [{ data: linked }, employees, attachments] = await Promise.all([
    sb.from("rpm_checks").select("id").eq("linked_rpm_sale_id", saleId).is("deleted_at", null).limit(1),
    loadEmployees(sb, [sale.agent_id, sale.closer_id, form.reviewer]),
    attachmentFields(sb, saleId),
  ]);
  const fields = {
    ...buildSaleFields(sale, employees, linked?.[0]?.id || ""),
    ...attachments,
  };
  const recordId = await airtable.upsert(SALES_TABLE, "Portal Sale ID", saleId, fields);
  return { recordId };
}

async function syncCheck(sb: ReturnType<typeof supabaseAdmin>, airtable: ReturnType<typeof airtableClient>, checkId: string) {
  const { data: check, error } = await sb.from("rpm_checks").select("*").eq("id", checkId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!check || check.deleted_at) {
    await airtable.deleteByField(Q_TABLE, "Portal Check ID", checkId);
    await airtable.deleteByField(NQ_TABLE, "Portal Check ID", checkId);
    return { deleted: true };
  }
  const employees = await loadEmployees(sb, [check.agent_id, check.closer_id]);
  const status = String(check.check_status || "");
  const feedback = String(check.feedback_status || "");
  if (NQ_FAMILY.has(status)) {
    await airtable.deleteByField(Q_TABLE, "Portal Check ID", checkId);
    if (!hasFormPhone(check.phone || check.phone_normalized)) {
      await airtable.deleteByField(NQ_TABLE, "Portal Check ID", checkId);
      return { skipped: "no form phone" };
    }
    const recordId = await airtable.upsert(NQ_TABLE, "Portal Check ID", checkId, buildNqFields(check, employees));
    return { table: NQ_TABLE, recordId };
  }
  if (status === "q" && COMPLETED_FEEDBACK.has(feedback)) {
    await airtable.deleteByField(NQ_TABLE, "Portal Check ID", checkId);
    let saleRec = "";
    if (check.linked_rpm_sale_id) {
      const found = await airtable.findByField(SALES_TABLE, "Portal Sale ID", String(check.linked_rpm_sale_id));
      saleRec = found[0]?.id || "";
      if (!saleRec) {
        const synced = await syncSale(sb, airtable, String(check.linked_rpm_sale_id));
        saleRec = synced.recordId || "";
      }
    }
    const recordId = await airtable.upsert(Q_TABLE, "Portal Check ID", checkId, buildQFields(check, employees, saleRec));
    return { table: Q_TABLE, recordId };
  }
  await airtable.deleteByField(Q_TABLE, "Portal Check ID", checkId);
  await airtable.deleteByField(NQ_TABLE, "Portal Check ID", checkId);
  return { skipped: "open Q" };
}

async function catchUp(sb: ReturnType<typeof supabaseAdmin>, airtable: ReturnType<typeof airtableClient>) {
  const minutes = Math.max(5, Number(Deno.env.get("AIRTABLE_RPM_CATCHUP_MINUTES") || 15));
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const [{ data: sales, error: sErr }, { data: checks, error: cErr }, { data: atts, error: aErr }] = await Promise.all([
    sb.from("rpm_sales").select("id").gte("updated_at", since),
    sb.from("rpm_checks").select("id").is("deleted_at", null).gte("updated_at", since),
    sb.from("rpm_sales_attachments").select("rpm_sale_id").gte("created_at", since),
  ]);
  if (sErr) throw new Error(sErr.message);
  if (cErr) throw new Error(cErr.message);
  if (aErr) throw new Error(aErr.message);
  const saleIds = new Set((sales || []).map((row) => String(row.id)));
  for (const att of atts || []) {
    if (att.rpm_sale_id) saleIds.add(String(att.rpm_sale_id));
  }
  const out: { kind: string; id: string; result: unknown }[] = [];
  for (const id of saleIds) {
    out.push({ kind: "sale", id, result: await syncSale(sb, airtable, id) });
  }
  for (const check of checks || []) {
    out.push({ kind: "check", id: check.id, result: await syncCheck(sb, airtable, check.id) });
  }
  return { since, minutes, sales: saleIds.size, checks: (checks || []).length, synced: out.length };
}

Deno.serve(async (req) => {
  if (req.method === "GET") return json(200, { ok: true, service: "airtable-rpm-sync" });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!authorized(req)) return json(401, { error: "Unauthorized" });
  try {
    const payload = await req.json();
    const type = String(payload.type || payload.eventType || "").toUpperCase();
    const table = String(payload.table || payload.table_name || "");
    const record = payload.record || payload.new || payload.row || null;
    const oldRecord = payload.old_record || payload.old || null;
    if (type === "UPDATE" && onlyMetaChanged(record, oldRecord)) {
      return json(200, { ok: true, skipped: "airtable meta only" });
    }
    const sb = supabaseAdmin();
    const airtable = airtableClient();
    if (type === "CATCHUP" || table === "catchup") {
      const result = await catchUp(sb, airtable);
      return json(200, { ok: true, ...result });
    }
    if (table === "rpm_sales_attachments") {
      const saleId = record?.rpm_sale_id || oldRecord?.rpm_sale_id;
      if (!saleId) return json(200, { ok: true, skipped: "no parent sale" });
      const result = await syncSale(sb, airtable, String(saleId));
      return json(200, { ok: true, table: SALES_TABLE, ...result });
    }
    if (table === "rpm_sales") {
      const saleId = record?.id || oldRecord?.id;
      if (!saleId) return json(400, { error: "missing sale id" });
      if (type === "DELETE") {
        await airtable.deleteByField(SALES_TABLE, "Portal Sale ID", String(saleId));
        return json(200, { ok: true, deleted: true });
      }
      const result = await syncSale(sb, airtable, String(saleId));
      return json(200, { ok: true, table: SALES_TABLE, ...result });
    }
    if (table === "rpm_checks") {
      const checkId = record?.id || oldRecord?.id;
      if (!checkId) return json(400, { error: "missing check id" });
      if (type === "DELETE") {
        await airtable.deleteByField(Q_TABLE, "Portal Check ID", String(checkId));
        await airtable.deleteByField(NQ_TABLE, "Portal Check ID", String(checkId));
        return json(200, { ok: true, deleted: true });
      }
      const result = await syncCheck(sb, airtable, String(checkId));
      return json(200, { ok: true, ...result });
    }
    return json(400, { error: `unsupported table ${table}` });
  } catch (err) {
    console.error("airtable-rpm-sync", err);
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});
