/**
 * Opaque org registration codes — agents enter org prefix + daily PIN without learning company.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

const ORG_CODE_LEN = 4;
const PIN_LEN = 4;

const FALLBACK_ORG_CODES = {
  hangup: "K7H2",
  hs2: "M9X4",
};

let cache = { at: 0, byCode: new Map(), byCompany: new Map() };
const CACHE_MS = 60_000;

function normalizeCompany(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "hs2" || raw === "hs-2" ? "hs2" : "hangup";
}

function normalizeOrgCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizePin(pin) {
  return String(pin || "")
    .trim()
    .replace(/\D/g, "")
    .slice(0, PIN_LEN);
}

async function loadOrgCodeMap(force = false) {
  const now = Date.now();
  if (!force && now - cache.at < CACHE_MS && cache.byCode.size) return cache;

  const byCode = new Map();
  const byCompany = new Map(Object.entries(FALLBACK_ORG_CODES));

  if (useSupabase()) {
    try {
      const { data, error } = await getSupabaseAdmin()
        .from("companies")
        .select("slug, registration_org_code")
        .eq("active", true);
      if (!error) {
        for (const row of data || []) {
          const co = normalizeCompany(row.slug);
          const code = normalizeOrgCode(row.registration_org_code) || FALLBACK_ORG_CODES[co];
          if (code) {
            byCode.set(code, co);
            byCompany.set(co, code);
          }
        }
      }
    } catch {
      /* use fallbacks */
    }
  }

  for (const [co, code] of Object.entries(FALLBACK_ORG_CODES)) {
    if (!byCompany.has(co)) byCompany.set(co, code);
    if (!byCode.has(code)) byCode.set(code, co);
  }

  cache = { at: now, byCode, byCompany };
  return cache;
}

async function getOrgCodeForCompany(company) {
  const map = await loadOrgCodeMap();
  const co = normalizeCompany(company);
  return map.byCompany.get(co) || FALLBACK_ORG_CODES[co];
}

function formatRegistrationCode(orgCode, dailyPin) {
  const oc = normalizeOrgCode(orgCode);
  const pin = normalizePin(dailyPin);
  if (oc.length !== ORG_CODE_LEN || pin.length !== PIN_LEN) return null;
  return `${oc}-${pin}`;
}

function parseRegistrationCodeInput(input) {
  const raw = String(input || "").trim().toUpperCase();
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  if (compact.length === ORG_CODE_LEN + PIN_LEN) {
    return {
      orgCode: compact.slice(0, ORG_CODE_LEN),
      pin: compact.slice(ORG_CODE_LEN),
    };
  }
  const dash = raw.split("-").map((s) => s.replace(/[^A-Z0-9]/g, ""));
  if (dash.length === 2 && dash[0].length === ORG_CODE_LEN && dash[1].length === PIN_LEN) {
    return { orgCode: dash[0], pin: dash[1] };
  }
  const pinOnly = normalizePin(raw);
  if (pinOnly.length === PIN_LEN && compact.length === PIN_LEN) {
    return { orgCode: null, pin: pinOnly };
  }
  return null;
}

async function resolveRegistrationCredential(input) {
  const parsed = parseRegistrationCodeInput(input);
  if (!parsed?.pin) return null;

  const map = await loadOrgCodeMap();
  let company = null;

  if (parsed.orgCode) {
    company = map.byCode.get(normalizeOrgCode(parsed.orgCode)) || null;
    if (!company) return null;
  } else {
    const registration = require("./registration");
    company = await registration.lookupCompanyByPin(parsed.pin);
    if (!company) company = "hangup";
  }

  const registration = require("./registration");
  const ok = await registration.verifyDailyPin(parsed.pin, undefined, company);
  if (!ok) return null;

  return { company, pin: parsed.pin, orgCode: parsed.orgCode || map.byCompany.get(company) };
}

module.exports = {
  ORG_CODE_LEN,
  PIN_LEN,
  normalizeCompany,
  getOrgCodeForCompany,
  formatRegistrationCode,
  parseRegistrationCodeInput,
  resolveRegistrationCredential,
  loadOrgCodeMap,
};
