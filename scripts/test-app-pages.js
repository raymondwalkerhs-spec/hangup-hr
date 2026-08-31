#!/usr/bin/env node
/**
 * Page + dropdown QA for Hangup Portal (built public/dist on localhost).
 * Usage: npm run test:pages
 * Env: HR_TEST_USER, HR_TEST_PASSWORD, optional HR_TEST_PORT (default 3848).
 * If HR_TEST_* are unset, bootstraps an active admin/ceo session from Supabase (same as test-pages-restart-smoke).
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");

const USER = String(process.env.HR_TEST_USER || "").trim();
const PASS = String(process.env.HR_TEST_PASSWORD || "").trim();
const PORT = Number(process.env.HR_TEST_PORT || 3848);
const HOST = "127.0.0.1";

function navPaths() {
  const src = fs.readFileSync(path.join(__dirname, "../src/app/nav-config.ts"), "utf8");
  return [...src.matchAll(/path:\s*"(\/[^"]+)"/g)].map((m) => m[1]);
}

function fail(msg) {
  throw new Error(msg);
}

async function waitLoaderGone(page, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const visible = await page.locator('[data-page-loader="1"]').count();
    if (!visible) return;
    await page.waitForTimeout(250);
  }
  fail("Cat overlay still visible after 20s");
}

async function assertNoCrash(page, pagePath, errors) {
  const body = await page.locator("body").innerText().catch(() => "");
  if (/Cannot access ['"]?\w+['"]? before initialization/i.test(body)) {
    fail(`${pagePath}: TDZ in page text`);
  }
  const tdz = errors.find((e) => /Cannot access/.test(e));
  if (tdz) fail(`${pagePath}: ${tdz}`);
  if (/Something went wrong|ErrorBoundary/i.test(body) && /Retry/i.test(body)) {
    fail(`${pagePath}: ErrorBoundary / error card with Retry`);
  }
  if (/this app version .* is no longer supported/i.test(body) && !/Update now/i.test(body)) {
    fail(`${pagePath}: version-block without Update now — lower min_compatible`);
  }
}

async function probeDropdowns(page, { typeSearch } = {}) {
  const results = { opened: 0, skipped: 0 };
  const buttons = page.locator('button[aria-haspopup="listbox"]');
  const n = await buttons.count();
  const limit = Math.min(n, 12);
  for (let i = 0; i < limit; i++) {
    const btn = buttons.nth(i);
    if (!(await btn.isVisible().catch(() => false))) {
      results.skipped += 1;
      continue;
    }
    if (await btn.isDisabled().catch(() => false)) {
      results.skipped += 1;
      continue;
    }
    await btn.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(200);
    const list = page.locator('[role="listbox"]');
    if (await list.count()) {
      const pe = await list.first().evaluate((el) => getComputedStyle(el).pointerEvents).catch(() => "");
      if (pe === "none") fail("Select menu has pointer-events: none");
      const options = list.locator('[role="option"]');
      const empty = list.locator("text=No matches");
      if ((await options.count()) === 0 && (await empty.count()) === 0 && !typeSearch) {
        fail("Select opened with no options");
      }
      if (typeSearch) {
        const search = list.locator('input[aria-label="Filter options"]');
        if (await search.count()) {
          await search.first().fill("a");
          await page.waitForTimeout(150);
        }
      }
      results.opened += 1;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
  }

  const natives = page.locator("select");
  const ns = await natives.count();
  for (let i = 0; i < ns; i++) {
    const sel = natives.nth(i);
    if (!(await sel.isVisible().catch(() => false))) continue;
    const disabled = await sel.isDisabled().catch(() => false);
    if (disabled) continue;
    const opts = await sel.locator("option").count();
    if (opts < 1) fail("Native <select> has no options");
  }
  return results;
}

async function clickIfVisible(page, name) {
  const btn = page.getByRole("button", { name, exact: false }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

async function resolveAdminUsername() {
  const { getSupabaseAdmin, isSupabaseConfigured } = require("../lib/supabase-client");
  if (!isSupabaseConfigured()) fail("Supabase required for admin session bootstrap");
  const sb = getSupabaseAdmin();
  for (const role of ["admin", "ceo"]) {
    const { data, error } = await sb
      .from("app_users")
      .select("username, role, status")
      .eq("role", role)
      .eq("status", "active")
      .limit(1);
    if (error) continue;
    const row = (data || [])[0];
    if (row?.username) return String(row.username);
  }
  fail("No active admin/ceo user in app_users");
}

async function run() {
  const usePasswordLogin = Boolean(USER && PASS);
  if (!usePasswordLogin) {
    console.warn("HR_TEST_USER/PASSWORD unset — using admin session bootstrap");
  }
  const distHtml = path.join(__dirname, "../public/dist/index.html");
  if (!fs.existsSync(distHtml)) fail("public/dist/index.html missing — run npm run build:web");

  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    fail("playwright is not installed — npm i -D playwright && npx playwright install chromium");
  }

  require("../lib/assert-session-secret").assertSessionSecret();
  let bootstrapSessionId = null;
  if (!usePasswordLogin) {
    const adminUser = await resolveAdminUsername();
    const { createSession } = require("../lib/session-store");
    bootstrapSessionId = createSession(adminUser, "admin").id;
    console.log("admin session bootstrap", adminUser);
  }

  const { createApp } = require("../app");
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(PORT, HOST, resolve);
    server.on("error", reject);
  });
  const origin = `http://${HOST}:${PORT}`;
  console.log("QA server", origin);

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  if (bootstrapSessionId) {
    await context.addInitScript((sessionId) => {
      sessionStorage.setItem("hr_session_id", sessionId);
      sessionStorage.setItem("companyContext", "hangup");
    }, bootstrapSessionId);
  }
  const page = await context.newPage();
  const errors = [];
  const api5xx = [];
  page.on("pageerror", (err) => errors.push(String(err && err.message ? err.message : err)));
  page.on("unhandledrejection", (err) => errors.push(`unhandledrejection ${err}`));
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("/api/") && res.status() >= 500) api5xx.push(`${res.status()} ${url}`);
  });

  try {
    if (usePasswordLogin) {
      await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(500);
      const loginText = await page.locator("body").innerText();
      if (!/Sign in/i.test(loginText)) fail("Login did not render Sign in (blank DNA?)");
      await page.locator('input[autocomplete="username"]').first().fill(USER);
      await page.locator('input[type="password"]').first().fill(PASS);
      await page.getByRole("button", { name: /sign in/i }).first().click();
      await page.waitForTimeout(2500);
      await waitLoaderGone(page).catch(() => {});
      const after = await page.locator("body").innerText();
      if (/this app version .* is no longer supported/i.test(after) && !/Update now/i.test(after)) {
        fail("version-block without Update now — lower min_compatible");
      }
      if (/invalid|incorrect password|not found/i.test(after) && page.url().includes("login")) {
        fail("Login failed — check HR_TEST_USER / HR_TEST_PASSWORD");
      }
    } else {
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await waitLoaderGone(page).catch(() => {});
      await assertNoCrash(page, "/", errors);
      if (page.url().includes("login")) fail("Session bootstrap did not enter the app");
    }

    const paths = navPaths();
    for (const p of paths) {
      errors.length = 0;
      api5xx.length = 0;
      const skipLoadRules = p === "/cats";
      await page.goto(`${origin}${p}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await waitLoaderGone(page);
      if (!skipLoadRules) {
        await assertNoCrash(page, p, errors);
        const forbidden = api5xx.filter((x) => !/403/.test(x));
        if (forbidden.length) fail(`${p}: ${forbidden[0]}`);
      }
      await probeDropdowns(page);
      console.log("ok", p);
    }

    // Checks / Q Feedback form smoke (open dialogs, no crash)
    await page.goto(`${origin}/checks`, { waitUntil: "domcontentloaded" });
    await waitLoaderGone(page);
    await assertNoCrash(page, "/checks (form probe)", errors);
    if ((await clickIfVisible(page, "+ New check")) || (await clickIfVisible(page, "New check"))) {
      await page.waitForTimeout(300);
      if ((await page.locator("input").count()) === 0) {
        fail("/checks: New check dialog has no inputs");
      }
      await probeDropdowns(page);
      await page.keyboard.press("Escape");
      console.log("ok /checks dialog");
    }

    await page.goto(`${origin}/q-feedback`, { waitUntil: "domcontentloaded" });
    await waitLoaderGone(page);
    await assertNoCrash(page, "/q-feedback", errors);
    console.log("ok /q-feedback probe");

    await page.goto(`${origin}/sales`, { waitUntil: "domcontentloaded" });
    await waitLoaderGone(page);
    if (await clickIfVisible(page, "+ Add sale")) {
      await clickIfVisible(page, "RPM");
      await page.waitForTimeout(400);
      await probeDropdowns(page, { typeSearch: true });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    }

    await page.goto(`${origin}/coaching`, { waitUntil: "domcontentloaded" });
    await waitLoaderGone(page);
    if (await clickIfVisible(page, "+ New ticket")) {
      await probeDropdowns(page);
      await page.keyboard.press("Escape");
    }

    await page.goto(`${origin}/org`, { waitUntil: "domcontentloaded" });
    await waitLoaderGone(page);
    const approve = page.getByRole("button", { name: "Approve", exact: true }).first();
    if (await approve.isVisible().catch(() => false)) {
      await approve.click();
      await page.waitForTimeout(300);
      await probeDropdowns(page);
      await page.keyboard.press("Escape");
    }

    const hs2 = page.getByTitle("Switch to HS-2").first();
    if (await hs2.isVisible().catch(() => false)) {
      await hs2.click();
      await page.waitForTimeout(400);
      await page.goto(`${origin}/sales`, { waitUntil: "domcontentloaded" });
      await waitLoaderGone(page);
      await assertNoCrash(page, "/sales (HS-2)", errors);
      const hangup = page.getByTitle("Switch to Main Hangup").first();
      if (await hangup.isVisible().catch(() => false)) await hangup.click();
    }

    console.log("test:pages green");
    process.exitCode = 0;
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 2000);
    });
    process.exit(process.exitCode || 0);
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
