#!/usr/bin/env node
/**
 * Reports + Settings smoke against running app (default PORT 3847).
 * Requires HR_TEST_USER + HR_TEST_PASSWORD (admin/CEO).
 */
require("dotenv").config();
const USER = String(process.env.HR_TEST_USER || "").trim();
const PASS = String(process.env.HR_TEST_PASSWORD || "").trim();
const PORT = Number(process.env.PORT || process.env.HR_TEST_PORT || 3847);
const origin = `http://127.0.0.1:${PORT}`;

function fail(msg) {
  throw new Error(msg);
}

async function loginApi() {
  const res = await fetch(`${origin}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(`login failed ${res.status}: ${body.error || ""}`);
  const m = setCookie.match(/hangup[^=]*=([^;]+)/i) || setCookie.match(/connect\.sid=([^;]+)/);
  if (!m) fail("no session cookie from login");
  return setCookie.split(";")[0];
}

async function apiGet(path, cookie) {
  const res = await fetch(`${origin}${path}`, { headers: { Cookie: cookie } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

async function runPlaywrightReports(cookieHeader) {
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const [name, val] = cookieHeader.split("=");
  await context.addCookies([{ name, value: val, url: origin }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.goto(`${origin}/reports`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  const body = await page.locator("body").innerText();
  if (/Something went wrong|ErrorBoundary/i.test(body)) fail("Reports page ErrorBoundary");
  if (/Cannot access/.test(body)) fail("Reports page TDZ crash");
  const hasRankings = /Sales Rankings/i.test(body);
  const hasMonthly = /HR Monthly|Active headcount/i.test(body);
  if (!hasRankings && !hasMonthly) fail("Reports page missing expected content");
  if (hasRankings) {
    const tab = page.getByRole("tab", { name: /Sales Rankings/i }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(1500);
      const after = await page.locator("body").innerText();
      if (/Top agents|No activity|Loading/i.test(after) === false && !/Passed|Pending|Denied/.test(after)) {
        // empty period still ok if section headers exist
        if (!/agent|closer|check/i.test(after)) fail("Sales Rankings tab empty/unexpected");
      }
    }
  }
  if (errors.length) fail(errors[0]);
  await browser.close();
  console.log("ok /reports UI (authenticated)");
}

async function run() {
  if (!USER || !PASS) fail("Set HR_TEST_USER and HR_TEST_PASSWORD for authenticated UI test");
  const cookie = await loginApi();
  console.log("ok login API");

  const status = await apiGet("/api/status", cookie);
  if (status.status !== 200) fail(`/api/status ${status.status}`);
  const u = status.json?.user || {};
  if (u.canViewSalesRankings !== true) fail("admin status missing canViewSalesRankings");
  console.log("ok /api/status canViewSalesRankings");

  const rankings = await apiGet("/api/reports/sales-rankings?from=2026-08-01&to=2026-08-31", cookie);
  if (rankings.status !== 200) fail(`sales-rankings ${rankings.status}: ${rankings.text?.slice(0, 200)}`);
  if (!rankings.json?.report?.period) fail("sales-rankings missing report.period");
  console.log("ok /api/reports/sales-rankings data");

  if (u.canViewSettingsThemeUnlocks === true || u.canManageEmployees === true) {
    const themes = await apiGet("/api/settings/theme-unlocks", cookie);
    if (themes.status !== 200) fail(`theme-unlocks ${themes.status}`);
    if (!themes.json?.thresholds?.gotham) fail("theme-unlocks missing thresholds");
    console.log("ok /api/settings/theme-unlocks");
  }

  await runPlaywrightReports(cookie);
  console.log("test:reports-settings green");
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
