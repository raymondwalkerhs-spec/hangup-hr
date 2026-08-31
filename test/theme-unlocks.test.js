const test = require("node:test");
const assert = require("node:assert/strict");
const themeUnlocks = require("../lib/theme-unlocks");

test("default thresholds match legacy 10/15 split", () => {
  const t = themeUnlocks.getThemeUnlockThresholds({});
  assert.equal(t.gotham.agentSent, 10);
  assert.equal(t.turtles.agentSent, 15);
});

test("custom thresholds: spiderman at 12 independent of gotham at 10", () => {
  const custom = {
    gotham: { agentSent: 10, closerClosed: 10 },
    "hello-kitty": { agentSent: 10, closerClosed: 10 },
    spiderman: { agentSent: 12, closerClosed: 12 },
    turtles: { agentSent: 15, closerClosed: 15 },
  };
  const t = themeUnlocks.getThemeUnlockThresholds({ themeUnlockThresholds: custom });
  assert.equal(t.spiderman.agentSent, 12);
  assert.equal(t.gotham.agentSent, 10);
});

test("validate rejects zero threshold", () => {
  assert.throws(() => {
    themeUnlocks.validateThemeUnlockThresholdsPayload({
      gotham: { agentSent: 0, closerClosed: 10 },
      "hello-kitty": { agentSent: 10, closerClosed: 10 },
      spiderman: { agentSent: 10, closerClosed: 10 },
      turtles: { agentSent: 15, closerClosed: 15 },
    });
  }, /agentSent must be 1/);
});

test("isThemeUnlocked per theme", () => {
  const unlocks = {
    gotham: true,
    helloKitty: false,
    spiderman: false,
    turtles: true,
  };
  assert.equal(themeUnlocks.isThemeUnlocked("gotham", unlocks), true);
  assert.equal(themeUnlocks.isThemeUnlocked("hello-kitty", unlocks), false);
  assert.equal(themeUnlocks.isThemeUnlocked("turtles", unlocks), true);
});

test("staff roles always unlock premium themes without sales", async () => {
  for (const role of [
    "admin",
    "ceo",
    "hr",
    "it",
    "finance",
    "accounting",
    "quality",
    "checker",
    "rtm",
  ]) {
    assert.equal(themeUnlocks.alwaysUnlockedRole({ role }), true, role);
    const unlocks = await themeUnlocks.computeThemeUnlocks({ role, employeeId: null });
    assert.equal(unlocks.gotham, true, `${role} gotham`);
    assert.equal(unlocks.helloKitty, true, `${role} helloKitty`);
    assert.equal(unlocks.spiderman, true, `${role} spiderman`);
    assert.equal(unlocks.turtles, true, `${role} turtles`);
  }
});

test("sales roles still need RPM quotas", () => {
  assert.equal(themeUnlocks.alwaysUnlockedRole({ role: "agent" }), false);
  assert.equal(themeUnlocks.alwaysUnlockedRole({ role: "tl" }), false);
  assert.equal(themeUnlocks.alwaysUnlockedRole({ role: "op" }), false);
});

test("theme unlocks count only sales in the user's company", async () => {
  const ym = themeUnlocks.yearMonthFromWorkingDay();
  const day = `${ym}-15`;
  const unlocks = await themeUnlocks.computeThemeUnlocks(
    { role: "agent", employeeId: "A1", unit: "HS-3" },
    {
      skipCache: true,
      thresholds: {
        gotham: { agentSent: 1, closerClosed: 1 },
        "hello-kitty": { agentSent: 99, closerClosed: 99 },
        spiderman: { agentSent: 99, closerClosed: 99 },
        turtles: { agentSent: 99, closerClosed: 99 },
      },
      readRpm: async () => [
        { agentId: "A1", unit: "HS-3", workingDay: day, submissionDate: day },
        { agentId: "A1", unit: "HS-2", workingDay: day, submissionDate: day },
      ],
    }
  );
  // Hang-Up user: only HS-3 sale counts → 1 sent → gotham unlocks; HS-2 sale ignored.
  assert.equal(unlocks.agentSalesThisMonth, 1);
  assert.equal(unlocks.gotham, true);
});
