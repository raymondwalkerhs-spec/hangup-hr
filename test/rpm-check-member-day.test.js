const test = require("node:test");
const assert = require("node:assert/strict");
const {
  memberDayExistsError,
  assertCheckMemberPhoneName,
} = require("../lib/rpm-checks-repo");

test("MEMBER_DAY_EXISTS error shape", () => {
  const err = memberDayExistsError({
    id: "chk-1",
    agentId: "AG9",
    checkStatus: "q",
  });
  assert.equal(err.code, "MEMBER_DAY_EXISTS");
  assert.equal(err.existing.id, "chk-1");
  assert.equal(err.existing.agentId, "AG9");
  assert.match(err.message, /already logged today/i);
});

test("strip-empty / invalid MCN rejected", () => {
  assert.throws(
    () => assertCheckMemberPhoneName({ memberId: "1L23CD4EF56", phone: "5551234567", checkStatus: "nq" }),
    (err) => err.message === "Wrong MCN" || err.code === "WRONG_MCN"
  );
  assert.throws(
    () => assertCheckMemberPhoneName({ memberId: "---", phone: "5551234567", checkStatus: "nq" }),
    (err) => /Member ID is required/i.test(err.message)
  );
});

test("Q requires letters-only name", () => {
  assert.throws(
    () =>
      assertCheckMemberPhoneName({
        memberId: "1A23CD4EF56",
        phone: "5551234567",
        fullName: "Jane 9",
        checkStatus: "q",
      }),
    (err) => /letters only/i.test(err.message)
  );
});

test("valid Q fields normalize", () => {
  const r = assertCheckMemberPhoneName({
    memberId: "1A23-CD4-EF56",
    phone: "(555) 123-4567",
    fullName: "Jane Doe",
    checkStatus: "q",
  });
  assert.equal(r.memberId, "1A23CD4EF56");
  assert.equal(r.phone, "5551234567");
  assert.equal(r.fullName, "Jane Doe");
});
