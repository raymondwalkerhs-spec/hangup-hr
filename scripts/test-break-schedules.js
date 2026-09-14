/**
 * Unit tests for break schedule matching (Cairo TZ, units, dialing, takes helpers).
 * Run: node scripts/test-break-schedules.js
 */
const assert = require("assert");
const breaks = require("../lib/break-schedules-repo");
const takes = require("../lib/break-takes-repo");

function fakeCairoDate(isoLocal) {
  // Build a Date that partsInCairo will read as the given Egypt wall time.
  // Use explicit UTC offset for Cairo (+2 or +3). Prefer Intl-fixed approach:
  // construct from known UTC that maps to desired Cairo.
  return new Date(isoLocal);
}

console.log("break-schedules tests…");

assert.strictEqual(breaks.canonicalizeUnit("HS1"), "HS-1");
assert.strictEqual(breaks.canonicalizeUnit("HS-1"), "HS-1");
assert.strictEqual(breaks.canonicalizeUnit("hs 3"), "HS-3");
assert.deepStrictEqual(breaks.canonicalizeUnits(["HS1", "HS-1", "HS3"]), ["HS-1", "HS-3"]);

const schedule = {
  id: "s1",
  name: "Lunch",
  startTime: "12:00",
  endTime: "13:00",
  durationMinutes: 15,
  active: true,
  units: ["HS-1"],
  roles: [],
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  dialingOnly: true,
  effectiveFrom: null,
  effectiveTo: null,
};

const dialingEmp = {
  id: "HS1-01",
  unit: "HS-1",
  team: "Alpha",
  position: "Agent",
  status: "active",
};
const tlEmp = {
  id: "TL-01",
  unit: "HS-1",
  team: "Alpha",
  position: "Team Leader",
  status: "active",
};

const userAgent = { unit: "HS-1", role: "agent" };
const userTl = { unit: "HS-1", role: "tl" };

assert.ok(
  breaks.breakAppliesToUser(schedule, userAgent, dialingEmp, {
    now: new Date("2026-09-14T09:15:00.000Z"), // 12:15 Cairo (EEST)
  }),
  "dialing agent in window"
);

assert.ok(
  !breaks.breakAppliesToUser(schedule, userTl, tlEmp, {
    now: new Date("2026-09-14T09:15:00.000Z"),
  }),
  "TL fails dialing_only"
);

const openSchedule = { ...schedule, dialingOnly: false, roles: ["tl"] };
assert.ok(
  breaks.breakAppliesToUser(openSchedule, userTl, tlEmp, {
    now: new Date("2026-09-14T09:15:00.000Z"),
  }),
  "TL matches role audience when dialingOnly false"
);

assert.ok(
  breaks.breakAppliesToUser(
    { ...schedule, units: breaks.canonicalizeUnits(["HS1"]) },
    userAgent,
    dialingEmp,
    { now: new Date("2026-09-14T09:15:00.000Z") }
  ),
  "canonical units match"
);

assert.ok(
  breaks.userPassesNotifierGate(userTl, tlEmp, ["tl"]),
  "extra roles admit TL"
);
assert.ok(
  !breaks.userPassesNotifierGate(userTl, tlEmp, []),
  "TL without extra roles fails gate"
);
assert.ok(
  breaks.userPassesNotifierGate(userAgent, dialingEmp, []),
  "dialing agent passes gate"
);

const dated = {
  ...schedule,
  effectiveFrom: "2026-09-20",
  effectiveTo: "2026-09-30",
  dialingOnly: false,
  units: [],
};
assert.ok(
  !breaks.breakAppliesToUser(dated, userAgent, dialingEmp, {
    now: new Date("2026-09-14T09:15:00.000Z"),
  }),
  "outside effective range"
);

const overnight = {
  ...schedule,
  startTime: "23:00",
  endTime: "01:00",
  dialingOnly: false,
  units: [],
  roles: [],
};
assert.ok(
  breaks.inEffectiveRange(overnight, "2026-09-14"),
  "effective open"
);

const take = {
  startedAt: new Date(Date.now() - 20 * 60000).toISOString(),
  allowedMinutes: 15,
  status: "in_progress",
};
assert.ok(takes.isOverdue(take), "20min > 15 allowed is overdue");
assert.strictEqual(takes.deriveStatusOnEnd(take), "exceeded");

const onTime = {
  startedAt: new Date(Date.now() - 5 * 60000).toISOString(),
  allowedMinutes: 15,
};
assert.strictEqual(takes.deriveStatusOnEnd(onTime, new Date()), "completed");

console.log("break-schedules tests OK");
