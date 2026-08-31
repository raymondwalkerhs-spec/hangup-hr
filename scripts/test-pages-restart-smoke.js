#!/usr/bin/env node
/**
 * Full nav page walk with injected admin session (no HR_TEST_PASSWORD needed).
 * Uses first active admin/ceo from Supabase + in-memory session on a test server.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");

const PORT = Number(process.env.HR_TEST_PORT || 3848);
const HOST = "127.0.0.1";

function fail(msg) {
  throw new Error(msg);
}

function navPaths() {
  const src = fs.readFileSync(path.join(__dirname, "../src/app/nav-config.ts"), "utf8");
  return [...src.matchAll(/path:\s*"(\/[^"]+)"/g)].map((m) => m[1]);
}

async function waitLoaderGone(page, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await page.locator('[data-page-loader="1"]').count()) === 0) return;
    await page.waitForTimeout(250);
  }
  fail("Page loader still visible after 25s");
}

async function assertNoCrash(page, pagePath, errors) {
  const body = await page.locator("body").innerText().catch(() => "");
  if (/Cannot access ['"]?\w+['"]? before initialization/i.test(body)) {
    fail(`${pagePath}: TDZ in page text`);
  }
  const tdz = errors.find((e) => /Cannot access/.test(e));
  if (tdz) fail(`${pagePath}: ${tdz}`);
  if (/Something went wrong|ErrorBoundary/i.test(body) && /Retry/i.test(body)) {
    fail(`${pagePath}: ErrorBoundary visible`);
  }
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
  const distHtml = path.join(__dirname, "../public/dist/index.html");
  if (!fs.existsSync(distHtml)) fail("public/dist/index.html missing — run npm run build:web");

  const adminUser = await resolveAdminUsername();
  const { createSession } = require("../lib/session-store");
  const session = createSession(adminUser, "admin");
  console.log("admin session bootstrap", adminUser);

  require("../lib/assert-session-secret").assertSessionSecret();
  const { createApp } = require("../app");
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(PORT, HOST, resolve);
    server.on("error", reject);
  });
  const origin = `http://${HOST}:${PORT}`;

  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    fail("playwright missing");
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript((sessionId) => {
    sessionStorage.setItem("hr_session_id", sessionId);
    sessionStorage.setItem("companyContext", "hangup");
  }, session.id);

  const page = await context.newPage();
  const errors = [];
  const api5xx = [];
  page.on("pageerror", (err) => errors.push(String(err?.message || err)));
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 500) {
      api5xx.push(`${res.status()} ${res.url()}`);
    }
  });

  try {
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await waitLoaderGone(page);
    await assertNoCrash(page, "/", errors);
    console.log("ok / (dashboard)");

    // Dashboard elements after recent fixes
    const rpmSection = page.locator('[aria-label="RPM weekly performance"]');
    if (await rpmSection.count()) {
      await rpmSection.scrollIntoViewIfNeeded().catch(() => {});
      console.log("ok dashboard RPM weekly section present");
    }

    const notifBtn = page.getByRole("button", { name: "Notifications" });
    if (await notifBtn.isVisible().catch(() => false)) {
      await notifBtn.click();
      await page.waitForTimeout(300);
      const panel = page.getByRole("dialog", { name: "Notifications" });
      if (!(await panel.isVisible().catch(() => false))) fail("Notifications panel not visible on top");
      const box = await panel.boundingBox();
      if (box && box.y < 40) console.log("ok notifications panel opens below header");
      await notifBtn.click();
      console.log("ok notifications bell + panel");
    }

    const paths = navPaths();
    for (const p of paths) {
      errors.length = 0;
      api5xx.length = 0;
      if (p === "/cats") continue;
      await page.goto(`${origin}${p}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await waitLoaderGone(page);
      await assertNoCrash(page, p, errors);
      const bad = api5xx.filter((x) => !/403/.test(x));
      if (bad.length) fail(`${p}: ${bad[0]}`);
      console.log("ok", p);
    }

    // Reports → Sales Rankings tab (v2.5)
    await page.goto(`${origin}/reports`, { waitUntil: "domcontentloaded" });
    await waitLoaderGone(page);
    const rankingsTab = page.getByRole("tab", { name: /Sales Rankings/i });
    if (await rankingsTab.isVisible().catch(() => false)) {
      await rankingsTab.click();
      await page.waitForTimeout(600);
      await assertNoCrash(page, "/reports sales-rankings", errors);
      console.log("ok /reports Sales Rankings tab");
    }

    // Settings theme unlocks card
    await page.goto(`${origin}/settings`, { waitUntil: "domcontentloaded" });
    await waitLoaderGone(page);
    const themeCard = page.getByText(/Premium theme unlock/i);
    if (await themeCard.count()) console.log("ok /settings theme unlocks card");

    console.log("test:pages-restart green —", paths.length, "nav routes");
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
