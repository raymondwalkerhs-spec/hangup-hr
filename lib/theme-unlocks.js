/**
 * Premium theme unlocks from RPM sales this month (working-day month).
 * Base premiums (Gotham / Hello Kitty / Spiderman):
 * - ≥10 RPM sent as agent, OR ≥10 RPM closed as closer
 * Turtle Grove (higher tier):
 * - ≥15 RPM sent as agent, OR ≥15 RPM closed as closer
 * Admin/CEO/HR always unlocked.
 */
const salesCount = require("./sales-count");
const { currentWorkingDay } = require("./sales-working-day");
const roles = require("./roles");

const AGENT_THEME_THRESHOLD = 10;
const CLOSER_THEME_THRESHOLD = 10;
const TURTLE_THEME_THRESHOLD = 15;
const CACHE_TTL_MS = 60_000;
const unlockCache = new Map();

function yearMonthFromWorkingDay() {
  return String(currentWorkingDay() || "").slice(0, 7);
}

function alwaysUnlockedRole(userRole) {
  const role = roles.normalizeRole(userRole?.role || userRole);
  return ["admin", "ceo", "hr"].includes(role);
}

function emptyUnlocks(ym = yearMonthFromWorkingDay()) {
  return {
    month: ym,
    agentSalesThisMonth: 0,
    closerSalesThisMonth: 0,
    premium: false,
    gotham: false,
    helloKitty: false,
    spiderman: false,
    turtles: false,
    agentThreshold: AGENT_THEME_THRESHOLD,
    closerThreshold: CLOSER_THEME_THRESHOLD,
    turtleThreshold: TURTLE_THEME_THRESHOLD,
    basis: "rpm",
  };
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

async function computeThemeUnlocks(userRole, { readRpm, skipCache } = {}) {
  const empty = emptyUnlocks();
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

  const ym = yearMonthFromWorkingDay();
  const cacheKey = `${empId}:${ym}`;
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
    const agentSales = salesCount.countRpmSentSalesForAgentMonth(rpmAgent, empId, ym);
    const closerSales = salesCount.countRpmClosedSalesForCloserMonth(rpmCloser, empId, ym);
    const premium =
      agentSales >= AGENT_THEME_THRESHOLD || closerSales >= CLOSER_THEME_THRESHOLD;
    const turtles =
      agentSales >= TURTLE_THEME_THRESHOLD || closerSales >= TURTLE_THEME_THRESHOLD;
    const value = {
      month: ym,
      agentSalesThisMonth: agentSales,
      closerSalesThisMonth: closerSales,
      premium,
      gotham: premium,
      helloKitty: premium,
      spiderman: premium,
      turtles,
      agentThreshold: AGENT_THEME_THRESHOLD,
      closerThreshold: CLOSER_THEME_THRESHOLD,
      turtleThreshold: TURTLE_THEME_THRESHOLD,
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
  if (themeId === "gotham" || themeId === "hello-kitty" || themeId === "spiderman") {
    return (
      unlocks?.premium === true ||
      unlocks?.[themeId === "hello-kitty" ? "helloKitty" : themeId] === true
    );
  }
  return true;
}

module.exports = {
  AGENT_THEME_THRESHOLD,
  CLOSER_THEME_THRESHOLD,
  TURTLE_THEME_THRESHOLD,
  computeThemeUnlocks,
  isThemeUnlocked,
  yearMonthFromWorkingDay,
  emptyUnlocks,
};
