import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const FORM_TEST = {
  id: "test",
  label: "RPM1- TEST Tracking Form",
  url: "https://docs.google.com/forms/d/e/1FAIpQLSe5ckz7Prlr-ogPwSZWUk6o_u5_K_JdFbDI69NJ86cIHipuoA/formResponse",
  entries: {
    fullName: "1939177472",
    phone: "71653480",
    dob: "878620617",
    mcn: "1231494228",
    medicalConditions: "2084970582",
    teamCode: "204813255",
  },
};

const FORM_DIRECT = {
  id: "direct",
  label: "RPM1- Direct Tracking Form",
  url: "https://docs.google.com/forms/d/e/1FAIpQLSdd4mYSuHJ4mAiY7hLusQsA62EHN_0ILTMUY-blEGoo9rJC-w/formResponse",
  entries: {
    fullName: "829430522",
    phone: "1317209541",
    dob: "1193946277",
    mcn: "1931751200",
    medicalConditions: "742198620",
    teamCode: "1822726357",
  },
};

const DEFAULT_TARGETS = [FORM_TEST, FORM_DIRECT];

type FormTarget = {
  id: string;
  label?: string;
  url: string;
  entries: Record<string, string>;
};

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
    Deno.env.get("RPM_GOOGLE_FORM_SYNC_SECRET"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  return expected.includes(token);
}

function loadTargets(): FormTarget[] {
  const raw = String(Deno.env.get("GOOGLE_FORM_TARGETS_JSON") || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((t: FormTarget, i: number) => ({
          id: String(t.id || `form${i + 1}`),
          label: t.label,
          url: String(t.url || "").trim(),
          entries: t.entries || {},
        }));
      }
    } catch {
      /* fall through to defaults */
    }
  }
  return DEFAULT_TARGETS.map((t) => ({ ...t, entries: { ...t.entries } }));
}

function asText(val: unknown) {
  if (val == null) return "";
  if (Array.isArray(val)) return val.map((v) => String(v || "").trim()).filter(Boolean).join(", ");
  return String(val).trim();
}

function digitsPhone(val: unknown) {
  return String(val || "").replace(/\D/g, "");
}

function formatMemberIdDisplay(raw: unknown) {
  const s = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 11);
  if (s.length <= 4) return s;
  if (s.length <= 7) return `${s.slice(0, 4)}-${s.slice(4)}`;
  return `${s.slice(0, 4)}-${s.slice(4, 7)}-${s.slice(7)}`;
}

/** Google Form DOB field expects MM/DD/YYYY with slashes (not ISO dashes). */
function formatDobForGoogleForm(val: unknown) {
  if (val == null) return "";
  const s = String(val).trim();
  if (!s) return "";

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const [, yr, mo, da] = m;
    return `${mo}/${da}/${yr}`;
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, da, yr] = m;
    return `${mo.padStart(2, "0")}/${da.padStart(2, "0")}/${yr}`;
  }

  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const [, mo, da, yr] = m;
    return `${mo.padStart(2, "0")}/${da.padStart(2, "0")}/${yr}`;
  }

  const d = new Date(s.includes("T") ? s : `${s.slice(0, 10)}T12:00:00`);
  if (!Number.isNaN(d.getTime())) {
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const yr = String(d.getFullYear());
    return `${mo}/${da}/${yr}`;
  }

  return s;
}

function saleClient(record: Record<string, unknown>) {
  const fd = (record.form_data || record.formData || {}) as Record<string, unknown>;
  return String(record.client || fd.client || "")
    .trim()
    .toUpperCase();
}

function pickFields(record: Record<string, unknown>) {
  const fd = (record.form_data || record.formData || {}) as Record<string, unknown>;
  return {
    fullName: asText(record.full_name || record.fullName || fd.fullName),
    phone: digitsPhone(record.phone_number || record.phoneNumber || fd.phoneNumber),
    dob: formatDobForGoogleForm(fd.dateOfBirth || record.dateOfBirth),
    mcn: formatMemberIdDisplay(record.member_id || record.memberId || fd.memberId),
    medicalConditions: asText(fd.medicalConditions || record.medicalConditions),
  };
}

function buildParams(fields: ReturnType<typeof pickFields>, entries: Record<string, string>) {
  const params = new URLSearchParams();
  params.set(`entry.${entries.fullName}`, fields.fullName);
  params.set(`entry.${entries.phone}`, fields.phone);
  params.set(`entry.${entries.dob}`, fields.dob);
  params.set(`entry.${entries.mcn}`, fields.mcn);
  if (fields.medicalConditions) {
    params.set(`entry.${entries.medicalConditions}`, fields.medicalConditions);
  }
  params.set(`entry.${entries.teamCode}`, "HS3");
  return params;
}

function sbAdmin() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, key, { auth: { persistSession: false } });
}

async function markSale(id: string, patch: Record<string, unknown>) {
  if (!id) return;
  const sb = sbAdmin();
  await sb.from("rpm_sales").update(patch).eq("id", id);
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return json(200, {
      ok: true,
      service: "rpm-google-form-sync",
      forms: loadTargets().map((t) => ({ id: t.id, label: t.label, url: t.url })),
    });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!authorized(req)) return json(401, { error: "Unauthorized" });

  let payload: { type?: string; record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const record = payload.record || {};
  const saleId = String(record.id || "");

  if (saleClient(record) !== "RPM1") {
    return json(200, { ok: true, skipped: "client_not_rpm1" });
  }

  const fields = pickFields(record);
  if (!fields.fullName || !fields.phone || !fields.dob || !fields.mcn) {
    if (saleId) {
      await markSale(saleId, { google_form_sync_error: "missing_required_fields" });
    }
    return json(200, { ok: false, skipped: "missing_required_fields" });
  }

  const targets = loadTargets();
  const results: Array<Record<string, unknown>> = [];

  try {
    for (const target of targets) {
      const params = buildParams(fields, target.entries);
      const res = await fetch(target.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "HangupPortal-RPM-GoogleForm/1.0",
        },
        body: params.toString(),
        redirect: "follow",
      });
      const text = await res.text().catch(() => "");
      results.push({
        id: target.id,
        label: target.label,
        ok: res.ok,
        status: res.status,
        error: res.ok ? undefined : text.slice(0, 200),
      });
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      const errMsg = failed.map((f) => `${f.id}:http_${f.status}`).join("; ");
      if (saleId) {
        await markSale(saleId, { google_form_sync_error: errMsg.slice(0, 300) });
      }
      return json(200, { ok: false, saleId, fields, results });
    }

    if (saleId) {
      await markSale(saleId, {
        google_form_submitted_at: new Date().toISOString(),
        google_form_sync_error: null,
      });
    }
    return json(200, { ok: true, saleId, fields, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (saleId) {
      await markSale(saleId, { google_form_sync_error: msg.slice(0, 300) });
    }
    return json(200, { ok: false, error: msg, results });
  }
});
