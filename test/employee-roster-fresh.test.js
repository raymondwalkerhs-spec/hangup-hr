const test = require("node:test");
const assert = require("node:assert/strict");
const { createEmployeeRosterFreshness } = require("../lib/employee-roster-freshness");

test("ensureFresh skips a second pull inside the TTL window", async () => {
  let pulls = 0;
  const freshness = createEmployeeRosterFreshness(async () => {
    pulls += 1;
    return [{ id: "HS3-54", team: "Justin" }];
  });

  await freshness.ensureFresh();
  const second = await freshness.ensureFresh();
  assert.equal(pulls, 1);
  assert.equal(second.skipped, true);

  await freshness.ensureFresh({ force: true });
  assert.equal(pulls, 2);
});

test("ensureFresh coalesces overlapping pulls", async () => {
  let pulls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const freshness = createEmployeeRosterFreshness(async () => {
    pulls += 1;
    await gate;
    return [];
  });

  const first = freshness.ensureFresh();
  const second = freshness.ensureFresh();
  release();
  await Promise.all([first, second]);
  assert.equal(pulls, 1);
});

test("markFresh keeps a local write hot without another pull", async () => {
  let pulls = 0;
  const freshness = createEmployeeRosterFreshness(async () => {
    pulls += 1;
    return [];
  });
  freshness.markFresh();
  const result = await freshness.ensureFresh();
  assert.equal(pulls, 0);
  assert.equal(result.skipped, true);
});
