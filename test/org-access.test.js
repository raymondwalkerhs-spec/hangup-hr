const test = require('node:test');
const assert = require('node:assert/strict');

// Mirror src/pages/org/orgAccess.ts (kept in sync for node test runner)
function canManageOrgPage(user) {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (user.canManageOrg === true) return true;
  if (user.canManageEmployees === true) return true;
  return ['admin', 'ceo', 'hr'].includes(role);
}

test('canManageOrgPage uses canManageOrg from API status', () => {
  assert.equal(canManageOrgPage({ role: 'op', canManageOrg: true }), true);
  assert.equal(canManageOrgPage({ role: 'op', canManageOrg: false }), false);
});

test('canManageOrgPage allows HR admin roles and canManageEmployees', () => {
  assert.equal(canManageOrgPage({ role: 'hr' }), true);
  assert.equal(canManageOrgPage({ role: 'agent', canManageEmployees: true }), true);
  assert.equal(canManageOrgPage({ role: 'agent' }), false);
});
