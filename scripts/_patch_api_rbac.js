const fs = require('fs');
const p = 'routes/api.js';
let s = fs.readFileSync(p, 'utf8');
const edits = [
  {
    name: 'middleware company',
    old: '    req.userRole.username = effectiveUsername;\n    if (!roles.hasAppAccess(req.userRole)) {',
    new: '    req.userRole.username = effectiveUsername;\n    // Resolve the company this request operates in (explicit switcher choice for managers,\n    // otherwise derived from the user\'s own unit) so per-company RBAC overrides apply.\n    try {\n      req.userRole.company = companyContext.resolveCompanyContextForRequest(req);\n    } catch {\n      req.userRole.company = "hangup";\n    }\n    if (!roles.hasAppAccess(req.userRole)) {',
  },
  {
    name: 'GET rbac/overrides',
    old: '  try {\n    const overrides = await rolePermissions.listOverrides();\n    const effective = await rolePermissions.getEffectiveMatrix();\n    res.json({ overrides, effective });',
    new: '  try {\n    const company = req.query.company || "hangup";\n    const overrides = await rolePermissions.listOverrides(company);\n    const effective = await rolePermissions.getEffectiveMatrix(company);\n    res.json({ company, overrides, effective });',
  },
  {
    name: 'PUT rbac/overrides',
    old: '    const result = await rolePermissions.saveOverrides(entries, req.realUsername || req.username);\n    res.json({ ok: true, ...result });',
    new: '    const company = req.query.company || req.body?.company || "hangup";\n    const result = await rolePermissions.saveOverrides(entries, req.realUsername || req.username, company);\n    res.json({ ok: true, ...result });',
  },
  {
    name: 'POST rbac/reset',
    old: '    const result = await rolePermissions.resetRole(role, keys);\n    res.json({ ok: true, ...result });',
    new: '    const company = req.query.company || req.body?.company || "hangup";\n    const result = await rolePermissions.resetRole(role, keys, company);\n    res.json({ ok: true, ...result });',
  },
  {
    name: 'deleteUnit getEffectiveMatrix',
    old: '  const effective = await rolePerms.getEffectiveMatrix();',
    new: '  const effective = await rolePerms.getEffectiveMatrix(req.userRole?.company || "hangup");',
  },
];
let ok = true;
for (const e of edits) {
  if (!s.includes(e.old)) { console.error('NOT FOUND:', e.name); ok = false; continue; }
  s = s.replace(e.old, e.new);
}
if (!ok) process.exit(2);
fs.writeFileSync(p, s);
console.log('api.js patched');
