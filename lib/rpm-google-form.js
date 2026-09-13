/**
 * Map RPM sale → Google Form formResponse body (RPM1 only).
 * Supports multiple forms (test + direct). Config via GOOGLE_FORM_TARGETS_JSON.
 */
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

/** Default: both forms. Override with GOOGLE_FORM_TARGETS_JSON array. */
const DEFAULT_FORM_TARGETS = [FORM_TEST, FORM_DIRECT];

/** @deprecated single-form aliases kept for older env */
const DEFAULT_FORM_RESPONSE_URL = FORM_TEST.url;
const DEFAULT_ENTRIES = FORM_TEST.entries;

function loadFormTargets() {
  const raw = String(process.env.GOOGLE_FORM_TARGETS_JSON || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) {
        throw new Error("GOOGLE_FORM_TARGETS_JSON must be a non-empty array");
      }
      return parsed.map((t, i) => ({
        id: String(t.id || `form${i + 1}`),
        label: String(t.label || t.id || `form${i + 1}`),
        url: String(t.url || "").trim(),
        entries: { ...t.entries },
      }));
    } catch (err) {
      throw new Error(`GOOGLE_FORM_TARGETS_JSON invalid: ${err.message || err}`);
    }
  }

  // Legacy single-form env (still supported; keeps first form customizable)
  const legacyUrl = String(process.env.GOOGLE_FORM_RESPONSE_URL || "").trim();
  const legacyEntriesRaw = String(process.env.GOOGLE_FORM_ENTRIES_JSON || "").trim();
  if (legacyUrl || legacyEntriesRaw) {
    let entries = { ...DEFAULT_ENTRIES };
    if (legacyEntriesRaw) {
      try {
        entries = { ...DEFAULT_ENTRIES, ...JSON.parse(legacyEntriesRaw) };
      } catch {
        throw new Error("GOOGLE_FORM_ENTRIES_JSON is not valid JSON");
      }
    }
    // If only legacy is set, keep BOTH defaults but replace the test form URL/entries
    return [
      {
        id: "test",
        label: FORM_TEST.label,
        url: legacyUrl || FORM_TEST.url,
        entries,
      },
      FORM_DIRECT,
    ];
  }

  return DEFAULT_FORM_TARGETS.map((t) => ({ ...t, entries: { ...t.entries } }));
}

function loadEntriesFromEnv() {
  return loadFormTargets()[0].entries;
}

function formResponseUrl() {
  return loadFormTargets()[0].url;
}

function saleClient(sale) {
  const fd = sale?.form_data || sale?.formData || {};
  return String(sale?.client || fd.client || "")
    .trim()
    .toUpperCase();
}

function isRpm1Client(sale) {
  return saleClient(sale) === "RPM1";
}

function asText(val) {
  if (val == null) return "";
  if (Array.isArray(val)) return val.map((v) => String(v || "").trim()).filter(Boolean).join(", ");
  return String(val).trim();
}

function digitsPhone(val) {
  return String(val || "").replace(/\D/g, "");
}

function formatMemberIdDisplay(raw) {
  const s = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 11);
  if (s.length <= 4) return s;
  if (s.length <= 7) return `${s.slice(0, 4)}-${s.slice(4)}`;
  return `${s.slice(0, 4)}-${s.slice(4, 7)}-${s.slice(7)}`;
}

/** Google Form DOB field expects MM/DD/YYYY with slashes (not ISO dashes). */
function formatDobForGoogleForm(val) {
  if (val == null) return "";
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const mo = String(val.getUTCMonth() + 1).padStart(2, "0");
    const da = String(val.getUTCDate()).padStart(2, "0");
    const yr = String(val.getUTCFullYear());
    return `${mo}/${da}/${yr}`;
  }
  const s = String(val).trim();
  if (!s) return "";

  // ISO date or timestamp: 1949-01-03 or 1949-01-03T00:00:00.000Z
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
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

  const d = new Date(s.includes("T") ? s : `${s.slice(0, 10)}T12:00:00Z`);
  if (!Number.isNaN(d.getTime())) {
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    const yr = String(d.getUTCFullYear());
    return `${mo}/${da}/${yr}`;
  }

  return s;
}

function pickSaleFields(sale) {
  const fd = sale?.form_data || sale?.formData || {};
  const rawDob =
    fd.dateOfBirth ||
    fd.date_of_birth ||
    sale?.dateOfBirth ||
    sale?.date_of_birth ||
    sale?.dob ||
    "";
  return {
    fullName: asText(sale?.full_name || sale?.fullName || fd.fullName),
    phone: digitsPhone(sale?.phone_number || sale?.phoneNumber || fd.phoneNumber),
    dob: formatDobForGoogleForm(rawDob),
    mcn: formatMemberIdDisplay(sale?.member_id || sale?.memberId || fd.memberId),
    medicalConditions: asText(fd.medicalConditions || sale?.medicalConditions),
  };
}

function buildGoogleFormBody(sale, entries) {
  if (!isRpm1Client(sale)) {
    return { ok: false, reason: "client_not_rpm1" };
  }
  const fields = pickSaleFields(sale);
  if (!fields.fullName || !fields.phone || !fields.dob || !fields.mcn) {
    return { ok: false, reason: "missing_required_fields", fields };
  }
  const body = new URLSearchParams();
  body.set(`entry.${entries.fullName}`, fields.fullName);
  body.set(`entry.${entries.phone}`, fields.phone);
  body.set(`entry.${entries.dob}`, fields.dob);
  body.set(`entry.${entries.mcn}`, fields.mcn);
  if (fields.medicalConditions) {
    body.set(`entry.${entries.medicalConditions}`, fields.medicalConditions);
  }
  body.set(`entry.${entries.teamCode}`, "HS3");
  return { ok: true, body, fields };
}

async function postFormResponse(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "HangupPortal-RPM-GoogleForm/1.0",
    },
    body: body.toString(),
    redirect: "follow",
  });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, detail: text.slice(0, 300) };
}

/** Submit one sale to every configured form (RPM1 only). */
async function submitGoogleForms(sale, opts = {}) {
  const targets = opts.targets || loadFormTargets();
  if (!isRpm1Client(sale)) {
    return { ok: false, reason: "client_not_rpm1", results: [] };
  }
  const results = [];
  let fields = null;
  for (const target of targets) {
    if (!target.url || !target.entries) {
      results.push({ id: target.id, ok: false, reason: "bad_target_config" });
      continue;
    }
    const built = buildGoogleFormBody(sale, target.entries);
    if (!built.ok) {
      return { ok: false, reason: built.reason, fields: built.fields, results };
    }
    fields = built.fields;
    const posted = await postFormResponse(target.url, built.body);
    results.push({
      id: target.id,
      label: target.label,
      url: target.url,
      ok: posted.ok,
      status: posted.status,
      detail: posted.ok ? undefined : posted.detail,
    });
  }
  const allOk = results.length > 0 && results.every((r) => r.ok);
  return { ok: allOk, fields, results };
}

/** @deprecated use submitGoogleForms */
async function submitGoogleForm(sale, opts = {}) {
  const url = opts.url || formResponseUrl();
  const entries = opts.entries || loadEntriesFromEnv();
  const built = buildGoogleFormBody(sale, entries);
  if (!built.ok) return built;
  const posted = await postFormResponse(url, built.body);
  if (!posted.ok) {
    return { ok: false, reason: "http_error", status: posted.status, detail: posted.detail, fields: built.fields };
  }
  return { ok: true, status: posted.status, fields: built.fields };
}

module.exports = {
  FORM_TEST,
  FORM_DIRECT,
  DEFAULT_FORM_TARGETS,
  DEFAULT_FORM_RESPONSE_URL,
  DEFAULT_ENTRIES,
  loadFormTargets,
  loadEntriesFromEnv,
  formResponseUrl,
  isRpm1Client,
  saleClient,
  pickSaleFields,
  formatDobForGoogleForm,
  buildGoogleFormBody,
  submitGoogleForm,
  submitGoogleForms,
};
