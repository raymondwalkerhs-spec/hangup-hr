const test = require("node:test");
const assert = require("node:assert/strict");
const rpmChecksRepo = require("../lib/rpm-checks-repo");
const { linkCheckToMatchingSale, linkSaleToMatchingCheck } = require("../lib/rpm-check-auto-link");

test("reverse link prefers same working day and same agent", async () => {
  const original = rpmChecksRepo.linkSaleToCheck;
  let linked = null;
  rpmChecksRepo.linkSaleToCheck = async (checkId, saleId) => {
    linked = { checkId, saleId, feedbackStatus: "sale" };
    return linked;
  };
  try {
    const result = await linkCheckToMatchingSale(
      {
        id: "c1",
        checkStatus: "q",
        agentId: "a1",
        memberId: "1A23CD4EF56",
        memberIdNormalized: "1A23CD4EF56",
        workingDay: "2026-08-25",
        company: "hangup",
      },
      async () => [
        { id: "s-other-day", agentId: "a1", workingDay: "2026-08-24" },
        { id: "s-other-agent", agentId: "a2", workingDay: "2026-08-25" },
        { id: "s-same", agentId: "a1", workingDay: "2026-08-25" },
      ]
    );
    assert.equal(result.saleId, "s-same");
    assert.equal(linked.saleId, "s-same");
  } finally {
    rpmChecksRepo.linkSaleToCheck = original;
  }
});

test("no cross-day reverse link", async () => {
  const original = rpmChecksRepo.linkSaleToCheck;
  let called = false;
  rpmChecksRepo.linkSaleToCheck = async () => {
    called = true;
    return { feedbackStatus: "sale" };
  };
  try {
    const result = await linkCheckToMatchingSale(
      {
        id: "c2",
        checkStatus: "q",
        agentId: "a1",
        memberId: "1A23CD4EF56",
        workingDay: "2026-08-25",
        company: "hangup",
      },
      async () => [{ id: "s-old", agentId: "a1", workingDay: "2026-08-24" }]
    );
    assert.equal(result, null);
    assert.equal(called, false);
  } finally {
    rpmChecksRepo.linkSaleToCheck = original;
  }
});

test("sale link requires workingDay (no cross-day FIFO)", async () => {
  const original = rpmChecksRepo.findOpenQForAutoLink;
  let called = false;
  rpmChecksRepo.findOpenQForAutoLink = async () => {
    called = true;
    return { id: "q1" };
  };
  try {
    const result = await linkSaleToMatchingCheck({
      id: "sale1",
      agentId: "a1",
      memberId: "1A23CD4EF56",
    });
    assert.equal(result, null);
    assert.equal(called, false);
  } finally {
    rpmChecksRepo.findOpenQForAutoLink = original;
  }
});

test("disposed not_int Q still links to sale when finder returns it", async () => {
  const originalFind = rpmChecksRepo.findOpenQForAutoLink;
  const originalLink = rpmChecksRepo.linkSaleToCheck;
  rpmChecksRepo.findOpenQForAutoLink = async (opts) => {
    assert.equal(opts.workingDay, "2026-08-25");
    return {
      id: "q-disposed",
      feedbackStatus: "not_int",
      checkStatus: "q",
      workingDay: "2026-08-25",
    };
  };
  rpmChecksRepo.linkSaleToCheck = async (checkId, saleId) => ({
    id: checkId,
    linkedRpmSaleId: saleId,
    feedbackStatus: "sale",
  });
  try {
    const result = await linkSaleToMatchingCheck({
      id: "sale2",
      agentId: "a1",
      memberId: "1A23CD4EF56",
      workingDay: "2026-08-25",
      company: "hangup",
    });
    assert.equal(result.feedbackStatus, "sale");
    assert.equal(result.linkedRpmSaleId, "sale2");
  } finally {
    rpmChecksRepo.findOpenQForAutoLink = originalFind;
    rpmChecksRepo.linkSaleToCheck = originalLink;
  }
});
