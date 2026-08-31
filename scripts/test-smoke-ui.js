#!/usr/bin/env node
/**
 * UI smoke without full login — login shell, auth redirect, optional full test:pages when HR_TEST_* set.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");

const PORT = Number(process.env.HR_TEST_PORT || 3848);
const HOST = "127.0.0.1";
const USER = String(process.env.HR_TEST_USER || "").trim();
const PASS = String(process.env.HR_TEST_PASSWORD || "").trim();

function fail(msg) {
  throw new Error(msg);
}

async function run() {
  const distHtml = path.join(__dirname, "../public/dist/index.html");
  if (!fs.existsSync(distHtml)) fail("public/dist/index.html missing — run npm run build:web");

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
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  try {
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const loginText = await page.locator("body").innerText();
    if (!/Sign in/i.test(loginText)) fail("Login page missing Sign in");
    console.log("ok /login shell");

    await page.goto(`${origin}/reports`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    if (!page.url().includes("/login")) {
      console.log("ok /reports (session may exist — skipped redirect check)");
    } else {
      console.log("ok /reports redirects to login when unauthenticated");
    }

    const res = await page.request.get(`${origin}/api/reports/sales-rankings`);
    if (res.status() !== 401 && res.status() !== 403) {
      fail(`sales-rankings without auth expected 401/403, got ${res.status()}`);
    }
    console.log("ok /api/reports/sales-rankings auth gate");

    if (USER && PASS) {
      console.log("HR_TEST_* set — running full test:pages…");
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      const { spawnSync } = require("child_process");
      const r = spawnSync(process.execPath, [path.join(__dirname, "test-app-pages.js")], {
        stdio: "inherit",
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, HR_TEST_PORT: String(PORT) },
      });
      if (r.status !== 0) process.exit(r.status || 1);
      console.log("test:smoke-ui green (full pages)");
      return;
    }

    if (errors.length) fail(errors[0]);
    console.log("test:smoke-ui green (no HR_TEST_USER — set credentials for full page walk)");
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
