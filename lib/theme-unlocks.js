/**
 * Premium theme unlocks from RPM sales this month (working-day month).
 * Thresholds are admin-configurable via app_config.themeUnlockThresholds.
 * Roles that always unlock premium themes (no RPM sales required):
 * admin, ceo, hr, it, finance (accounting), quality, checker, rtm.
 */
const salesCount = require("./sales-count");
const { currentWorkingDay } = require("./sales-working-day");
const roles = require("./roles");

const THEME_IDS = ["gotham", "hello-kitty", "spiderman", "turtles"];

const DEFAULT_THEME_UNLOCK_THRESHOLDS = {
  gotham: { agentSent: 10, closerClosed: 10 },
  "hello-kitty": { agentSent: 10, closerClosed: 10 },
  spiderman: { agentSent: 10, closerClosed: 10 },
  turtles: { agentSent: 15, closerClosed: 15 },
};

/** Staff roles that get all premium themes without sales quotas. */
const PREMIUM_THEME_ALWAYS_ROLES = [
  "admin",
  "ceo",
  "hr",
  "it",
  "finance",
  "quality",
  "checker",
  "rtm",
];

const AGENT_THEME_THRESHOLD = 10;
const CLOSER_THEME_THRESHOLD = 10;
const TURTLE_THEME_THRESHOLD = 15;

const CACHE_TTL_MS = 60_000;
const unlockCache = new Map();

function clearUnlockCache() {
  unlockCache.clear();
}

function yearMonthFromWorkingDay() {
  return String(currentWorkingDay() || "").slice(0, 7);
}

function clampThreshold(n, fallback) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return fallback;
  if (v > 999) return 999;
  return v;
}

function normalizeThemeThresholds(raw) {
  const merged = {};
  for (const id of THEME_IDS) {
    const def = DEFAULT_THEME_UNLOCK_THRESHOLDS[id];
    const row = raw && typeof raw === "object" ? raw[id] : null;
    merged[id] = {
      agentSent: clampThreshold(row?.agentSent, def.agentSent),
      closerClosed: clampThreshold(row?.closerClosed, def.closerClosed),
    };
  }
  return merged;
}

function getThemeUnlockThresholds(config) {
  return normalizeThemeThresholds(config?.themeUnlockThresholds);
}

function themeUnlocked(agentSales, closerSales, thresholds) {
  return (
    agentSales >= thresholds.agentSent || closerSales >= thresholds.closerClosed
  );
}

function alwaysUnlockedRole(userRole) {
  const role = roles.normalizeRole(userRole?.role || userRole);
  return PREMIUM_THEME_ALWAYS_ROLES.includes(role);
}

function emptyUnlocks(ym = yearMonthFromWorkingDay(), thresholds = DEFAULT_THEME_UNLOCK_THRESHOLDS) {
  const base = getThemeUnlockThresholds({ themeUnlockThresholds: thresholds });
  return {
    month: ym,
    agentSalesThisMonth: 0,
    closerSalesThisMonth: 0,
    premium: false,
    gotham: false,
    helloKitty: false,
    spiderman: false,
    turtles: false,
    agentThreshold: base.gotham.agentSent,
    closerThreshold: base.gotham.closerClosed,
    turtleThreshold: base.turtles.agentSent,
    thresholds: base,
    basis: "rpm",
  };
}

function companyForThemeUnlocks(userRole) {
  const companyContext = require("./company-context");
  return companyContext.getCompanyForUser(userRole);
}

function filterRpmSalesForThemeCompany(sales, company) {
  const companyContext = require("./company-context");
  return companyContext.filterSalesByCompanyContext(sales || [], company);
}

async function loadRpmSalesForEmployee(employeeId) {
  const rpmRepo = require("./rpm-sales-repo");
  const [rpmAgent, rpmCloser] = await Promise.all([
    rpmRepo.readRpmSales({ agentId: employeeId }).catch(() => []),
    rpmRepo.readRpmSales({ closerId: employeeId }).catch(() => []),
  ]);
  return {
    rpmAgent: rpmAgent || [],
    rpmCloser: rpmCloser || [],
  };
}

function loadThresholdsFromStore() {
  try {
    const store = require("./data-store");
    return getThemeUnlockThresholds(store.getConfig());
  } catch {
    return normalizeThemeThresholds(null);
  }
}

async function computeThemeUnlocks(userRole, { readRpm, skipCache, thresholds } = {}) {
  const thresh = thresholds || loadThresholdsFromStore();
  const empty = emptyUnlocks(yearMonthFromWorkingDay(), thresh);
  if (!userRole) return empty;

  if (alwaysUnlockedRole(userRole)) {
    return {
      ...empty,
      premium: true,
      gotham: true,
      helloKitty: true,
      spiderman: true,
      turtles: true,
    };
  }

  const empId = userRole.employeeId;
  if (!empId) return empty;

  const company = companyForThemeUnlocks(userRole);
  const ym = yearMonthFromWorkingDay();
  const cacheKey = `${empId}:${company}:${ym}:${JSON.stringify(thresh)}`;
  if (!skipCache && typeof readRpm !== "function") {
    const hit = unlockCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  }

  try {
    let rpmAgent = [];
    let rpmCloser = [];
    if (typeof readRpm === "function") {
      const rpm = (await readRpm()) || [];
      rpmAgent = rpm;
      rpmCloser = rpm;
    } else {
      const packs = await loadRpmSalesForEmployee(empId);
      rpmAgent = packs.rpmAgent;
      rpmCloser = packs.rpmCloser;
    }
    rpmAgent = filterRpmSalesForThemeCompany(rpmAgent, company);
    rpmCloser = filterRpmSalesForThemeCompany(rpmCloser, company);
    const agentSales = salesCount.countRpmSentSalesForAgentMonth(rpmAgent, empId, ym);
    const closerSales = salesCount.countRpmClosedSalesForCloserMonth(rpmCloser, empId, ym);

    const gotham = themeUnlocked(agentSales, closerSales, thresh.gotham);
    const helloKitty = themeUnlocked(agentSales, closerSales, thresh["hello-kitty"]);
    const spiderman = themeUnlocked(agentSales, closerSales, thresh.spiderman);
    const turtles = themeUnlocked(agentSales, closerSales, thresh.turtles);
    const premium = gotham || helloKitty || spiderman;

    const value = {
      month: ym,
      agentSalesThisMonth: agentSales,
      closerSalesThisMonth: closerSales,
      premium,
      gotham,
      helloKitty,
      spiderman,
      turtles,
      agentThreshold: thresh.gotham.agentSent,
      closerThreshold: thresh.gotham.closerClosed,
      turtleThreshold: thresh.turtles.agentSent,
      thresholds: thresh,
      basis: "rpm",
    };
    unlockCache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch {
    return { ...empty, month: ym };
  }
}

function isThemeUnlocked(themeId, unlocks) {
  if (themeId === "turtles") {
    return unlocks?.turtles === true;
  }
  if (themeId === "gotham") return unlocks?.gotham === true;
  if (themeId === "hello-kitty") return unlocks?.helloKitty === true;
  if (themeId === "spiderman") return unlocks?.spiderman === true;
  return true;
}

function validateThemeUnlockThresholdsPayload(body) {
  if (!body || typeof body !== "object") {
    throw new Error("thresholds object required");
  }
  const out = {};
  for (const id of THEME_IDS) {
    const row = body[id];
    if (!row || typeof row !== "object") {
      throw new Error(`Missing thresholds for ${id}`);
    }
    const agentSent = Number(row.agentSent);
    const closerClosed = Number(row.closerClosed);
    if (!Number.isFinite(agentSent) || agentSent < 1 || agentSent > 999) {
      throw new Error(`${id}: agentSent must be 1–999`);
    }
    if (!Number.isFinite(closerClosed) || closerClosed < 1 || closerClosed > 999) {
      throw new Error(`${id}: closerClosed must be 1–999`);
    }
    out[id] = { agentSent: Math.floor(agentSent), closerClosed: Math.floor(closerClosed) };
  }
  return out;
}

module.exports = {
  THEME_IDS,
  DEFAULT_THEME_UNLOCK_THRESHOLDS,
  PREMIUM_THEME_ALWAYS_ROLES,
  AGENT_THEME_THRESHOLD,
  CLOSER_THEME_THRESHOLD,
  TURTLE_THEME_THRESHOLD,
  getThemeUnlockThresholds,
  normalizeThemeThresholds,
  validateThemeUnlockThresholdsPayload,
  clearUnlockCache,
  computeThemeUnlocks,
  isThemeUnlocked,
  yearMonthFromWorkingDay,
  emptyUnlocks,
  alwaysUnlockedRole,
};
