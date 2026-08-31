#!/usr/bin/env node
/**
 * v2.5 API smoke — login + fake check submit + rankings + theme-unlocks.
 * Env: HR_TEST_USER, HR_TEST_PASSWORD (optional HR_TEST_PORT, default PORT or 3847)
 */
require("dotenv").config();
const http = require("http");

const USER = String(process.env.HR_TEST_USER || "").trim();
const PASS = String(process.env.HR_TEST_PASSWORD || "").trim();
const PORT = Number(process.env.HR_TEST_PORT || process.env.PORT || 3847);
const HOST = "127.0.0.1";

function fail(msg) {
  throw new Error(msg);
}

function validMcn(seed = 0) {
  const letters = "ACDEFGHJKMNPQRTUVWXY";
  const n = (i) => String((seed + i) % 10);
  const L = (i) => letters[(seed + i) % letters.length];
  return `${n(1)}${L(2)}${L(3)}${n(4)}${L(5)}${L(6)}${n(7)}${L(8)}${L(9)}${n(0)}${n(3)}`;
}

async function jsonFetch(origin, path, { method = "GET", body, sessionId, headers = {} } = {}) {
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(sessionId ? { "x-session-id": sessionId } : {}),
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function run() {
  if (!USER || !PASS) {
    console.log("skip v250 API smoke — set HR_TEST_USER and HR_TEST_PASSWORD in .env");
    process.exit(0);
  }

  require("../lib/assert-session-secret").assertSessionSecret();
  const { createApp } = require("../app");
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(PORT, HOST, resolve);
    server.on("error", reject);
  });
  const origin = `http://${HOST}:${PORT}`;
  console.log("v250 API smoke on", origin);

  const createdCheckIds = [];
  let sessionId = "";

  try {
    const login = await jsonFetch(origin, "/api/login", {
      method: "POST",
      body: { username: USER, password: PASS },
    });
    if (login.status >= 400 || !login.json?.sessionId) {
      fail(`login failed ${login.status} ${login.json?.error || ""}`);
    }
    sessionId = login.json.sessionId;
    console.log("ok login");

    const status = await jsonFetch(origin, "/api/status", { sessionId });
    if (status.status >= 400) fail(`status failed ${status.status}`);
    console.log("ok /api/status");

    const month = new Date().toISOString().slice(0, 7);
    const rankings = await jsonFetch(origin, `/api/reports/sales-rankings?month=${month}`, { sessionId });
    if (rankings.status === 403) {
      console.log("skip sales-rankings — no permission");
    } else if (rankings.status >= 400) {
      fail(`sales-rankings failed ${rankings.status} ${JSON.stringify(rankings.json)}`);
    } else {
      if (!Array.isArray(rankings.json?.topAgents)) fail("sales-rankings missing topAgents");
      console.log("ok /api/reports/sales-rankings");
    }

    const themes = await jsonFetch(origin, "/api/settings/theme-unlocks", { sessionId });
    if (themes.status === 403) {
      console.log("skip theme-unlocks — no permission");
    } else if (themes.status >= 400) {
      fail(`theme-unlocks failed ${themes.status}`);
    } else {
      console.log("ok GET /api/settings/theme-unlocks");
    }

    const weekly = await jsonFetch(origin, `/api/sales/rpm-weekly?month=${month}&mode=passed`, { sessionId });
    if (weekly.status >= 400) fail(`rpm-weekly failed ${weekly.status}`);
    console.log("ok /api/sales/rpm-weekly");

    const scope = await jsonFetch(origin, "/api/rpm-checks/agent-scope", { sessionId });
    const agentId = scope.json?.agents?.[0]?.id || scope.json?.agentId;
    if (!agentId) {
      console.log("skip fake check submit — no agent in scope");
    } else {
      const mcn = validMcn(Date.now() % 1000);
      const created = await jsonFetch(origin, "/api/rpm-checks", {
        method: "POST",
        sessionId,
        headers: { "Idempotency-Key": `v250-smoke|${mcn}` },
        body: {
          agentId,
          memberId: mcn,
          phone: "5551234567",
          checkStatus: "q",
          fullName: "API Smoke Test",
          dateOfBirth: "1990-01-01",
          feedbackStatus: "open",
        },
      });
      if (created.status >= 400) {
        fail(`check create failed ${created.status} ${JSON.stringify(created.json)}`);
      }
      const checkId = created.json?.check?.id || created.json?.id;
      if (checkId) createdCheckIds.push(checkId);
      console.log("ok POST /api/rpm-checks (Q + feedback shortcut)");
    }

    console.log("v250 API smoke green");
  } finally {
    for (const id of createdCheckIds) {
      await jsonFetch(origin, `/api/rpm-checks/${id}`, {
        method: "DELETE",
        sessionId,
      }).catch(() => {});
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
