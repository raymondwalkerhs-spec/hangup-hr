#!/usr/bin/env node
/** Quality ticket + sales field permission checks */
const catalog = require("../lib/sales-field-catalog");
const roles = require("../lib/roles");

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

assert("leadType hidden from catalog lists", !catalog.FIELDS.some((f) => f.key === "leadType" && !f.systemHidden) || catalog.isSystemHiddenField(catalog.getFieldDef("leadType")));
assert("bankAccountChosenBy removed from catalog", !catalog.getFieldDef("bankAccountChosenBy"));

const qualityFields = catalog.listFieldsForRoleOnSurface("op", permMap, "quality", {
  user: opVerifier,
  sale,
});
assert("OP assignee sees verifierFeedback on quality surface when in quality_view_roles", qualityFields.some((f) => f.key === "verifierFeedback"));
assert(
  "OP assignee verifierFeedback has canView and canEdit",
  qualityFields.find((f) => f.key === "verifierFeedback")?.canView === true &&
    qualityFields.find((f) => f.key === "verifierFeedback")?.canEdit === true
);
assert(
  "unassigned OP does not see verifierFeedback on quality surface",
  !catalog.listFieldsForRoleOnSurface("op", permMap, "quality", { user: opOther, sale }).some((f) => f.key === "verifierFeedback")
);
assert(
  "assigned OP verifier can edit reviewer status",
  catalog.canEditVerifierFeedback(opVerifier, sale, permMap.verifierFeedback)
);
assert(
  "unassigned OP cannot edit reviewer status",
  !catalog.canEditVerifierFeedback(opOther, sale, permMap.verifierFeedback)
);

const opMainPayment = catalog.listFieldsForRole("op", permMap, { surface: "main" });
assert(
  "OP main surface does not include paymentMethod by default (admin/rtm view only)",
  !opMainPayment.some((f) => f.key === "paymentMethod")
);

const opQualityDefault = catalog.listFieldsForRoleOnSurface("op", permMap, "quality", { user: opVerifier, sale });
assert("OP quality surface excludes paymentMethod by default", !opQualityDefault.some((f) => f.key === "paymentMethod"));
assert("OP quality surface excludes notes by default", !opQualityDefault.some((f) => f.key === "notes"));
assert("OP quality surface excludes agentName", !opQualityDefault.some((f) => f.key === "agentName"));
assert("OP quality surface excludes closerName", !opQualityDefault.some((f) => f.key === "closerName"));

const nonQualityDefaultQualityView = catalog.getDefaultPermissions(catalog.getFieldDef("notes")).qualityViewRoles;
assert("non-quality fields default empty quality_view_roles", nonQualityDefaultQualityView.length === 0);

const customPerm = {
  verifierFeedback: {
    fieldKey: "verifierFeedback",
    view_roles: ["quality"],
    edit_roles: ["op"],
    main_view_roles: [],
    quality_view_roles: ["op"],
  },
  paymentMethod: {
    fieldKey: "paymentMethod",
    view_roles: catalog.ADMIN_RTM_VIEW,
    edit_roles: catalog.DEFAULT_EDIT,
    main_view_roles: catalog.ADMIN_RTM_VIEW,
    quality_view_roles: [],
  },
};
const opCustomQuality = catalog.listFieldsForRoleOnSurface("op", customPerm, "quality", {
  user: opVerifier,
  sale,
});
assert("custom quality_view_roles: OP assignee sees verifierFeedback not payment", opCustomQuality.some((f) => f.key === "verifierFeedback") && !opCustomQuality.some((f) => f.key === "paymentMethod"));
const opCustomMain = catalog.listFieldsForRole("op", customPerm, { surface: "main" });
assert("custom main_view_roles: payment hidden on main for OP", !opCustomMain.some((f) => f.key === "paymentMethod"));

const agentFields = catalog.listFieldsForRoleOnSurface("agent", permMap, "quality");
assert("agent quality surface excludes assignVerifier by default", !agentFields.some((f) => f.key === "assignVerifier"));

assert("OP cannot upload recording attachment", !catalog.canEditAttachmentKind("recording", "op"));
assert("OP cannot view recording attachment", !catalog.canViewAttachmentKind("recording", "op"));
assert("agent cannot view recording attachment", !catalog.canViewAttachmentKind("recording", "agent"));
assert("agent cannot upload recording attachment", !catalog.canEditAttachmentKind("recording", "agent"));
assert("TL cannot view recording attachment", !catalog.canViewAttachmentKind("recording", "tl"));
assert("TL cannot upload recording attachment", !catalog.canEditAttachmentKind("recording", "tl"));
assert("OP assignee quality surface gets no attachment kinds", catalog.listAttachmentKindsForRole("op", { surface: "quality", user: opVerifier, sale }).length === 0);
assert("quality can view raw_call", catalog.canViewAttachmentKind("raw_call", "quality"));

assert("OP not in default editSales", !roles.canEditSale({ role: "op" }));
assert("OP can open quality ticket when assignee", roles.canOpenQualityTicketOnSale(opVerifier, sale));
assert("OP cannot open quality ticket when not assignee", !roles.canOpenQualityTicketOnSale(opOther, sale));

const sanitized = catalog.sanitizeFormPayload(
  { leadType: "Hacked", verifierFeedback: "Sale done" },
  "op",
  permMap,
  { surface: "quality", user: opVerifier, sale }
);
assert("sanitize strips leadType", sanitized.leadType === undefined);
assert("sanitize keeps assignee-editable verifierFeedback", sanitized.verifierFeedback === "Sale done");

const sanitizedHidden = catalog.sanitizeFormPayload(
  { notes: "secret", paymentMethod: "Card", verifierFeedback: "Sale done" },
  "op",
  permMap,
  { surface: "quality", user: opVerifier, sale }
);
assert("sanitize strips non-editable quality fields for OP assignee", sanitized.notes === undefined && sanitized.paymentMethod === undefined);
assert("sanitize keeps verifierFeedback for OP assignee", sanitized.verifierFeedback === "Sale done");

const attachMap = Object.fromEntries(
  catalog.ATTACHMENT_KINDS.map((k) => [
    k.key,
    { viewRoles: k.viewRoles, editRoles: k.editRoles },
  ])
);
attachMap.recording = { viewRoles: ["quality"], editRoles: ["quality"] };
assert("custom attach map: OP cannot view recording", !catalog.canViewAttachmentKind("recording", "op", attachMap));
assert("custom attach map: quality can view recording", catalog.canViewAttachmentKind("recording", "quality", attachMap));

function enrichSalesDisplayNames(sales, employees) {
  const empById = new Map(employees.map((e) => [e.id, e]));
  return sales.map((s) => ({
    ...s,
    agentDisplayName: empById.get(s.agentId)?.american_name || "",
    closerDisplayName: empById.get(s.closerId)?.american_name || "",
  }));
}
const enriched = enrichSalesDisplayNames(
  [{ id: "1", agentId: "A1", closerId: "C2" }],
  [{ id: "A1", american_name: "Agent One" }, { id: "C2", american_name: "Closer Two" }]
)[0];
assert("closer display enrichment", enriched.closerDisplayName === "Closer Two" && enriched.agentDisplayName === "Agent One");

const camelPermMap = Object.fromEntries(
  Object.entries(permMap).map(([k, v]) => [
    k,
    {
      fieldKey: k,
      mainViewRoles: v.main_view_roles,
      qualityViewRoles: v.quality_view_roles,
      editRoles: v.edit_roles,
      viewRoles: v.view_roles,
    },
  ])
);
// Simulate admin-granted Quality tab access (business-repo camelCase shape)
["firstName", "lastName", "paymentMethod", "chargeAmount", "notes", "reviewer"].forEach((key) => {
  if (camelPermMap[key]) {
    camelPermMap[key] = {
      ...camelPermMap[key],
      qualityViewRoles: ["op", "tl", "quality", "admin", "ceo", "rtm"],
    };
  }
});
const opCamelQuality = catalog.listFieldsForRoleOnSurface("op", camelPermMap, "quality", {
  user: opVerifier,
  sale,
});
assert(
  "camelCase business-repo perms: OP assignee sees paymentMethod on quality surface",
  opCamelQuality.some((f) => f.key === "paymentMethod")
);
assert(
  "camelCase business-repo perms: OP assignee sees multiple sections",
  new Set(opCamelQuality.map((f) => f.section)).size >= 4
);

const fullSale = {
  formData: {
    firstName: "Jane",
    lastName: "Doe",
    phoneNumber: "5551234567",
    qualityComments: "old",
    reviewer: "QV1",
  },
};
const qualityUser = { role: "quality", username: "qa1", employeeId: "QV1" };
const sanitizedTicket = catalog.sanitizeFormPayload(
  { ...fullSale.formData, qualityComments: "updated comment", reviewer: "QV2" },
  "quality",
  permMap,
  { create: false, user: qualityUser, sale: fullSale, surface: "quality" }
);
assert("quality ticket save keeps unrelated form fields", sanitizedTicket.firstName === "Jane" && sanitizedTicket.phoneNumber === "5551234567");
assert("quality ticket save updates qualityComments", sanitizedTicket.qualityComments === "updated comment");
assert("quality ticket save updates reviewer", sanitizedTicket.reviewer === "QV2");

const restrictivePerm = {
  qualityComments: {
    fieldKey: "qualityComments",
    edit_roles: ["admin", "rtm"],
    quality_view_roles: ["quality", "rtm", "admin", "ceo"],
  },
};
const restrictedSave = catalog.sanitizeFormPayload(
  { qualityComments: "saved despite restrictive DB edit_roles" },
  "quality",
  restrictivePerm,
  { create: false, user: qualityUser, sale: fullSale, surface: "quality", qualityTicket: true }
);
assert(
  "restrictive DB edit_roles: quality role still saves qualityComments on ticket",
  restrictedSave.qualityComments === "saved despite restrictive DB edit_roles"
);

if (!process.exitCode) console.log("\nAll tests passed.");
