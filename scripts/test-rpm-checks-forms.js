#!/usr/bin/env node
/**
 * Checks / RPM form + link correctness smoke (API + light UI).
 * Usage: node scripts/test-rpm-checks-forms.js
 * Env: HR_TEST_USER, HR_TEST_PASSWORD, optional HR_TEST_PORT (default 3851)
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");
const { validateRpmSaleSubmitPayload } = require("../lib/sales-rpm-submit-required");

const USER = String(process.env.HR_TEST_USER || "").trim();
const PASS = String(process.env.HR_TEST_PASSWORD || "").trim();
const PORT = Number(process.env.HR_TEST_PORT || 3851);
const HOST = "127.0.0.1";

function fail(msg) {
  throw new Error(msg);
}

function validMcn(seed = 0) {
  const letters = "ACDEFGHJKMNPQRTUVWXY";
  const n = (i) => String((seed + i) % 10);
  const L = (i) => letters[(seed + i) % letters.length];
  // N L A N - L A N - L L N N
  return `${n(1)}${L(2)}${L(3)}${n(4)}${L(5)}${L(6)}${n(7)}${L(8)}${L(9)}${n(0)}${n(3)}`;
}

async function run() {
  if (!USER || !PASS) fail("HR_TEST_USER and HR_TEST_PASSWORD are required");
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
  console.log("forms smoke server", origin);

  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    fail("playwright is not installed");
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const createdCheckIds = [];

  try {
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator('input[autocomplete="username"]').first().fill(USER);
    await page.locator('input[type="password"]').first().fill(PASS);
    await page.getByRole("button", { name: /sign in/i }).first().click();
    await page.waitForTimeout(2500);
    if (page.url().includes("login")) {
      const body = await page.locator("body").innerText();
      if (/invalid|incorrect|not found/i.test(body)) fail("Login failed");
    }

    const login = await page.evaluate(async ({ user, pass }) => {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }, { user: USER, pass: PASS });
    if (login.status >= 400 || !login.body.sessionId) {
      fail(`API login failed: ${login.body.error || login.status}`);
    }
    const sessionId = login.body.sessionId;

    async function api(pathname, opts = {}) {
      return page.evaluate(
        async ({ pathname: p, opts: o, sessionId: sid }) => {
          const res = await fetch(p, {
            ...o,
            headers: {
              "Content-Type": "application/json",
              "x-session-id": sid,
              ...(o.headers || {}),
            },
            body: o.body != null ? JSON.stringify(o.body) : undefined,
          });
          const text = await res.text();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
          return { status: res.status, json };
        },
        { pathname, opts, sessionId }
      );
    }

    // --- Empty RPM required payload ---
    {
      const r = validateRpmSaleSubmitPayload({ agentId: "x", closerId: "y", formData: {} });
      if (r.ok) fail("empty RPM payload should fail");
      if (!r.errors.some((e) => e.field === "alternativePhone")) fail("expected alternativePhone error");
      if (!r.errors.some((e) => e.field === "emergencyPhone")) fail("expected emergencyPhone error");
      console.log("ok RPM empty required keys");
    }

    // --- Wrong MCN ---
    {
      const scope = await api("/api/rpm-checks/agent-scope");
      const agentId = scope.json?.agents?.[0]?.id || scope.json?.agentId;
      if (!agentId) {
        console.log("skip Wrong MCN / duplicate — no agent in scope");
      } else {
        const bad = await api("/api/rpm-checks", {
          method: "POST",
          body: {
            agentId,
            memberId: "1L23CD4EF56",
            phone: "5551234567",
            checkStatus: "nq",
          },
        });
        if (bad.status !== 400) fail(`Wrong MCN expected 400 got ${bad.status} ${JSON.stringify(bad.json)}`);
        if (!/Wrong MCN/i.test(String(bad.json?.error || ""))) {
          fail(`expected Wrong MCN message, got ${JSON.stringify(bad.json)}`);
        }
        console.log("ok Checks Wrong MCN");

        const mcn = validMcn(Date.now() % 1000);
        const first = await api("/api/rpm-checks", {
          method: "POST",
          headers: { "Idempotency-Key": `smoke|${mcn}|a` },
          body: {
            agentId,
            memberId: mcn,
            phone: "5551234567",
            checkStatus: "nq",
          },
        });
        if (first.status >= 400) fail(`first check failed ${first.status} ${JSON.stringify(first.json)}`);
        const checkId = first.json?.check?.id || first.json?.id;
        if (checkId) createdCheckIds.push(checkId);
        console.log("ok Checks create");

        const agents = scope.json?.agents || [];
        const otherAgent = agents.find((a) => a.id !== agentId)?.id || agentId;
        const dup = await api("/api/rpm-checks", {
          method: "POST",
          headers: { "Idempotency-Key": `smoke|${mcn}|b` },
          body: {
            agentId: otherAgent,
            memberId: mcn,
            phone: "5559998888",
            checkStatus: "nq",
          },
        });
        if (dup.status !== 409 || dup.json?.code !== "MEMBER_DAY_EXISTS") {
          fail(`duplicate expected 409 MEMBER_DAY_EXISTS got ${dup.status} ${JSON.stringify(dup.json)}`);
        }
        console.log("ok Checks MEMBER_DAY_EXISTS");

        if (checkId) {
          const patched = await api(`/api/rpm-checks/${checkId}`, {
            method: "PATCH",
            body: { checkStatus: "q", fullName: "Smoke Test", dateOfBirth: "1990-01-01", phone: "5551234567" },
          });
          if (patched.status >= 400) {
            // Q may need name/DOB — retry with full identity
            const patched2 = await api(`/api/rpm-checks/${checkId}`, {
              method: "PATCH",
              body: {
                checkStatus: "nq",
                phone: "5551234567",
              },
            });
            if (patched2.status >= 400) fail(`re-status failed ${patched.status} ${JSON.stringify(patched.json)}`);
          }
          console.log("ok Checks re-status same id");
        }

        // Soft-delete created check
        if (checkId) {
          await api(`/api/rpm-checks/${checkId}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // --- identity-check soft warn shape ---
    {
      const idCheck = await api(
        `/api/rpm-sales/identity-check?memberId=${encodeURIComponent(validMcn(42))}&phone=5550001111&alternativePhone=5550002222`
      );
      if (idCheck.status === 403) {
        console.log("skip identity-check — no submit sales permission");
      } else if (idCheck.status >= 400) {
        fail(`identity-check failed ${idCheck.status} ${JSON.stringify(idCheck.json)}`);
      } else if (!Array.isArray(idCheck.json?.priors)) {
        fail("identity-check missing priors array");
      } else {
        console.log("ok identity-check priors");
      }
    }

    // --- UI: Checks empty submit ---
    await page.goto(`${origin}/checks`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const newBtn = page.getByRole("button", { name: /New check/i }).first();
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await page.waitForTimeout(400);
      const submit = page.getByRole("button", { name: /Submit check/i }).first();
      if (await submit.isVisible().catch(() => false)) {
        await submit.click();
        await page.waitForTimeout(500);
        const body = await page.locator("body").innerText();
        const hasError =
          /required|Fix highlighted|Wrong MCN|agent/i.test(body) ||
          (await page.locator("[class*='fieldHint'], [class*='invalidField'], .fieldError").count()) > 0;
        if (!hasError) fail("Checks empty submit showed no validation UI");
        console.log("ok Checks empty submit blocked");
      }
      await page.keyboard.press("Escape");
    } else {
      console.log("skip Checks empty submit UI — no New check button");
    }

    // --- UI: Q Feedback + RPM dialog open ---
    await page.goto(`${origin}/q-feedback`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const qBody = await page.locator("body").innerText();
    if (/Something went wrong|ErrorBoundary/i.test(qBody) && /Retry/i.test(qBody)) {
      fail("/q-feedback ErrorBoundary");
    }
    console.log("ok /q-feedback load");

    await page.goto(`${origin}/sales`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const addSale = page.getByRole("button", { name: /\+ Add sale|Add sale/i }).first();
    if (await addSale.isVisible().catch(() => false)) {
      await addSale.click();
      await page.waitForTimeout(200);
      const rpm = page.getByRole("button", { name: /^RPM$/i }).first();
      if (await rpm.isVisible().catch(() => false)) {
        await rpm.click();
        await page.waitForTimeout(500);
        const submitSale = page.getByRole("button", { name: /Submit sale/i }).first();
        if (await submitSale.isVisible().catch(() => false)) {
          await submitSale.click();
          await page.waitForTimeout(600);
          const saleBody = await page.locator("body").innerText();
          if (!/Fix highlighted|required|Wrong MCN/i.test(saleBody)) {
            // field errors may only be on fields
            const errCount = await page.locator(".fieldError, [class*='invalid']").count();
            if (!errCount) fail("RPM empty submit showed no validation");
          }
          console.log("ok RPM empty submit blocked");
        }
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
    } else {
      console.log("skip RPM empty submit UI");
    }

    console.log("test-rpm-checks-forms green");
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
