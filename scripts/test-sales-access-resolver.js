#!/usr/bin/env node
/** Sales field access — empty DB edit_roles must not block catalog defaults */
const resolver = require("../lib/sales-access-resolver");
const catalog = require("../lib/sales-field-catalog");

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("  ok", name);
}

const qualityComments = catalog.getFieldDef("qualityComments");
const emptyDbPerm = { fieldKey: "qualityComments", edit_roles: [], editRoles: [] };

assert(
  "quality can edit qualityComments when DB edit_roles empty",
  resolver.canEditFieldOnSurface(qualityComments, "quality", emptyDbPerm, "quality", { user: { role: "quality" }, sale: {} })
);

const sanitized = resolver.sanitizeFormPayload(
  { qualityComments: "Test note" },
  "quality",
  { qualityComments: emptyDbPerm },
  { create: false, sale: { formData: {} }, surface: "quality", qualityTicket: true, user: { role: "quality" } }
);
assert("sanitize applies qualityComments", sanitized.qualityComments === "Test note");

console.log("sales-access-resolver tests done");
