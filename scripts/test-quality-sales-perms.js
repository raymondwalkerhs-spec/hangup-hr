#!/usr/bin/env node
/** Quality ticket + sales field permission checks */
const catalog = require("../lib/sales-field-catalog");

const permMap = Object.fromEntries(
  catalog.FIELDS.map((f) => {
    const d = catalog.getDefaultPermissions(f);
    return [
      f.key,
      {
        fieldKey: f.key,
        view_roles: d.viewRoles,
        edit_roles: d.editRoles,
        main_view_roles: d.mainViewRoles,
        quality_view_roles: d.qualityViewRoles,
      },
    ];
  })
);

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("  ok", name);
}

console.log("quality-sales-perms");

const sale = { formData: { assignVerifier: "OP1-01" } };
const opVerifier = { role: "op", employeeId: "OP1-01", username: "op1" };
const opOther = { role: "op", employeeId: "OP9-99", username: "op9" };

const qualityFields = catalog.listFieldsForRoleOnSurface("op", permMap, "quality", {
  user: opVerifier,
  sale,
});
assert("OP verifier sees quality-surface fields", qualityFields.some((f) => f.key === "verifierFeedback"));
assert(
  "assigned OP verifier can edit reviewer status",
  catalog.canEditVerifierFeedback(opVerifier, sale, permMap.verifierFeedback)
);
assert(
  "unassigned OP cannot edit reviewer status without edit role on other sales",
  !catalog.canEditVerifierFeedback(opOther, sale, permMap.verifierFeedback)
);

const agentFields = catalog.listFieldsForRoleOnSurface("agent", permMap, "quality");
assert("agent quality surface excludes assignVerifier by default", !agentFields.some((f) => f.key === "assignVerifier"));

assert("OP can upload confirmation attachment", catalog.canEditAttachmentKind("confirmation", "op"));
assert("agent cannot upload raw_call", !catalog.canEditAttachmentKind("raw_call", "agent"));
assert("quality can view raw_call", catalog.canViewAttachmentKind("raw_call", "quality"));

if (!process.exitCode) console.log("\nAll tests passed.");
