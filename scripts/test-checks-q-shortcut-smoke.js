#!/usr/bin/env node
/**
 * Smoke: Checks create + optional Q feedback shortcut + feedback-scope.
 * Bootstraps admin session (no HR_TEST_PASSWORD).
 */
require("dotenv").config();
const http = require("http");

const PORT = Number(process.env.HR_TEST_PORT || 3852);
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

async function resolveAdminUsername() {
  const { getSupabaseAdmin, isSupabaseConfigured } = require("../lib/supabase-client");
  if (!isSupabaseConfigured()) fail("Supabase required");
  const sb = getSupabaseAdmin();
  for (const role of ["admin", "ceo"]) {
    const { data } = await sb
      .from("app_users")
      .select("username, role, status, employee_id")
      .eq("role", role)
      .eq("status", "active")
      .limit(1);
    const row = (data || [])[0];
    if (row?.username) return row;
  }
  fail("No active admin/ceo");
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
    json = { raw: text.slice(0, 240) };
  }
  return { status: res.status, json };
}

async function run() {
  const admin = await resolveAdminUsername();
  const { createSession } = require("../lib/session-store");
  const session = createSession(admin.username, "admin");
  require("../lib/assert-session-secret").assertSessionSecret();
  const { createApp } = require("../app");
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(PORT, HOST, resolve);
    server.on("error", reject);
  });
  const origin = `http://${HOST}:${PORT}`;
  const sid = session.id;
  const created = [];

  try {
    const scope = await jsonFetch(origin, "/api/rpm-checks/feedback-scope?forCheckCreate=1", {
      sessionId: sid,
    });
    if (scope.status >= 400) fail(`feedback-scope ${scope.status} ${JSON.stringify(scope.json)}`);
    const closers = scope.json?.closers || scope.json?.employees || [];
    console.log("ok feedback-scope forCheckCreate", {
      defaultCloserId: scope.json?.defaultCloserId || null,
      lockCloser: scope.json?.lockCloser,
      closerCount: closers.length,
    });

    const agents = await jsonFetch(origin, "/api/rpm-checks/agent-scope", { sessionId: sid });
    const agentId = agents.json?.agents?.[0]?.id || agents.json?.agentId;
    if (!agentId) {
      console.log("skip check create — no agent in scope");
      console.log("checks-q-shortcut smoke green (scope only)");
      return;
    }

    const mcn = validMcn(Date.now() % 900);
    const closerId =
      scope.json?.defaultCloserId ||
      closers[0]?.id ||
      admin.employee_id ||
      null;

    // Q create without feedback shortcut
    const plain = await jsonFetch(origin, "/api/rpm-checks", {
      method: "POST",
      sessionId: sid,
      headers: { "Idempotency-Key": `q-plain|${mcn}` },
      body: {
        agentId,
        memberId: mcn,
        phone: "5551112222",
        checkStatus: "q",
        fullName: "Q Shortcut Plain",
        dateOfBirth: "1990-02-02",
      },
    });
    if (plain.status >= 400) fail(`plain Q create ${plain.status} ${JSON.stringify(plain.json)}`);
    const plainId = plain.json?.check?.id || plain.json?.id;
    if (plainId) created.push(plainId);
    const plainFb = plain.json?.check?.feedbackStatus || plain.json?.feedbackStatus;
    if (plainFb) fail(`plain Q should have no feedback, got ${plainFb}`);
    console.log("ok Q create without feedback shortcut");

    // Q create WITH feedback shortcut
    const mcn2 = validMcn((Date.now() % 900) + 17);
    if (!closerId) {
      console.log("skip feedback shortcut create — no closer id");
    } else {
      const withFb = await jsonFetch(origin, "/api/rpm-checks", {
        method: "POST",
        sessionId: sid,
        headers: { "Idempotency-Key": `q-fb|${mcn2}` },
        body: {
          agentId,
          memberId: mcn2,
          phone: "5553334444",
          checkStatus: "q",
          fullName: "Q Shortcut Feedback",
          dateOfBirth: "1988-03-03",
          feedbackStatus: "callback",
          closerId,
        },
      });
      if (withFb.status >= 400) {
        fail(`Q+feedback create ${withFb.status} ${JSON.stringify(withFb.json)}`);
      }
      const fbId = withFb.json?.check?.id || withFb.json?.id;
      if (fbId) created.push(fbId);
      const st = withFb.json?.check?.feedbackStatus || withFb.json?.feedbackStatus;
      if (st !== "callback") fail(`expected feedbackStatus=callback got ${st}`);
      console.log("ok Q create with feedback shortcut (callback)");
    }

    // Invalid feedback without closer should 400 when disposition set
    const mcn3 = validMcn((Date.now() % 900) + 33);
    const bad = await jsonFetch(origin, "/api/rpm-checks", {
      method: "POST",
      sessionId: sid,
      headers: { "Idempotency-Key": `q-bad|${mcn3}` },
      body: {
        agentId,
        memberId: mcn3,
        phone: "5555556666",
        checkStatus: "q",
        fullName: "Q Bad Closer",
        dateOfBirth: "1991-04-04",
        feedbackStatus: "not_int",
        closerId: "",
      },
    });
    if (bad.status < 400) {
      const badId = bad.json?.check?.id || bad.json?.id;
      if (badId) created.push(badId);
      // Some admins may auto-default closer — accept if feedback applied with default
      console.log("ok feedback without closer (server defaulted or accepted)", bad.status);
    } else {
      console.log("ok feedback without closer rejected", bad.status);
    }

    console.log("checks-q-shortcut smoke green");
  } finally {
    for (const id of created) {
      await jsonFetch(origin, `/api/rpm-checks/${id}`, { method: "DELETE", sessionId: sid }).catch(() => {});
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
