const assert = require("node:assert/strict");
const store = require("../lib/password-reset-pending-store");

{
  const a = store.createResetToken("alice", 120_000);
  assert.ok(a.resetToken);
  assert.equal(a.expiresInSec > 100, true);
  const peek = store.peekResetToken(a.resetToken);
  assert.equal(peek.username, "alice");

  // New token for same user invalidates the old one
  const b = store.createResetToken("alice", 120_000);
  assert.equal(store.peekResetToken(a.resetToken), null);
  assert.ok(store.peekResetToken(b.resetToken));

  const consumed = store.consumeResetToken(b.resetToken);
  assert.equal(consumed.username, "alice");
  assert.equal(store.peekResetToken(b.resetToken), null);
}

{
  const t = store.createResetToken("bob", 1_200);
  const start = Date.now();
  while (Date.now() - start < 1_400) {
    /* spin */
  }
  assert.equal(store.peekResetToken(t.resetToken), null);
  assert.equal(store.consumeResetToken(t.resetToken), null);
}

console.log("password-reset-pending-store.test.js OK");
