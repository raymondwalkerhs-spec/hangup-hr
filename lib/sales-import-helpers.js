const path = require("path");
const fs = require("fs");

const CLOSER_ALIASES = {
  jude: "TL07",
  tris: "TL03",
  ayla: "HS1-05",
  steven: "OP1",
  "self-closer": null,
  "self closer": null,
};

const AGENT_ID_OVERRIDES = {
  "ryan neil": "NW-18",
  "sarah gonzalez": "HS1-12",
};

let qualityNameMap = {};
try {
  const p = path.join(__dirname, "..", "scripts", "data", "quality-name-map.json");
  if (fs.existsSync(p)) qualityNameMap = JSON.parse(fs.readFileSync(p, "utf8"));
} catch {
  qualityNameMap = {};
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildEmployeeIndex(employees) {
  const byName = new Map();
  for (const e of employees) {
    const key = norm(e.american_name);
    if (key) byName.set(key, e);
  }
  return byName;
}

function findEmployee(byName, employees, name) {
  const key = norm(name);
  if (!key) return null;
  const overrideId = AGENT_ID_OVERRIDES[key] || qualityNameMap[key];
  if (overrideId) {
    const hit = employees.find((e) => e.id === overrideId);
    if (hit) return hit;
  }
  if (byName.has(key)) return byName.get(key);
  for (const [k, e] of byName) {
    if (k.replace(/[^a-z]/g, "") === key.replace(/[^a-z]/g, "")) return e;
  }
  return null;
}

function resolveCloser(byName, employees, closerRaw) {
  const closerKey = norm(closerRaw);
  if (!closerKey) return null;
  if (Object.prototype.hasOwnProperty.call(CLOSER_ALIASES, closerKey)) {
    return CLOSER_ALIASES[closerKey];
  }
  const emp = findEmployee(byName, employees, closerRaw);
  return emp ? emp.id : null;
}

function nextHs3Id(employees) {
  let max = 0;
  for (const e of employees) {
    const m = String(e.id).match(/^HS3-(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `HS3-${String(max + 1).padStart(2, "0")}`;
}

function mapUnit(centerCode) {
  const c = String(centerCode || "").trim().toUpperCase();
  if (c === "HS3") return "HS-3";
  if (c === "HS1") return "HS-1";
  if (c === "HS2") return "HS-2";
  return c || "HS-3";
}

function mapDevice(raw) {
  const key = norm(raw);
  if (key.includes("watch")) return "smartwatch";
  if (key.includes("bracelet")) return "bracelet";
  if (key.includes("necklace")) return "necklace";
  return "necklace";
}

function mapStatus(raw) {
  const key = norm(raw);
  const STATUS_MAP = {
    passed: "passed",
    processed: "passed",
    "sale done": "passed",
    postdated: "postdated",
    dropped: "denied",
    denied: "denied",
    "pending bank approval": "pending",
    pending: "pending",
    retransfer: "callback",
    callback: "callback",
  };
  return STATUS_MAP[key] || (key ? "pending" : "pending");
}

function parseSubmissionDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

module.exports = {
  norm,
  buildEmployeeIndex,
  findEmployee,
  resolveCloser,
  nextHs3Id,
  mapUnit,
  mapDevice,
  mapStatus,
  parseSubmissionDate,
  CLOSER_ALIASES,
  AGENT_ID_OVERRIDES,
};
