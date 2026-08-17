/**
 * RPM sales quality + ACL unit tests (no DB).
 */
const assert = require("assert");
const rpmStatus = require("../lib/rpm-sales-status");
const resolver = require("../lib/sales-rpm-access-resolver");
const catalog = require("../lib/sales-rpm-field-catalog");
const roles = require("../lib/roles");

function testStatusMapping() {
  const passed = rpmStatus.syncSaleStatusFromQuality({
    clientFeedback: "Approved",
    reviewerFeedback: "Done",
  });
  assert.strictEqual(passed.status, "passed");
  assert.strictEqual(passed.retransfer, false);

  const pending = rpmStatus.syncSaleStatusFromQuality({
    clientFeedback: "Pending",
    reviewerFeedback: "Pending",
  });
  assert.strictEqual(pending.status, "pending");
  assert.strictEqual(pending.formData.internalFeedback, "Pending process");

  const denied = rpmStatus.syncSaleStatusFromQuality({ clientFeedback: "Denied" });
  assert.strictEqual(denied.status, "denied");

  const retransfer = rpmStatus.syncSaleStatusFromQuality({ clientFeedback: "Retransfer" });
  assert.strictEqual(retransfer.status, "callback");
  assert.strictEqual(retransfer.formData.retransfer, true);
  assert.strictEqual(retransfer.retransfer, true);
}

function testSubmitExcludesQualityFields() {
  const submitKeys = catalog.listFieldsForSubmit("agent").map((f) => f.key);
  assert(!submitKeys.includes("reviewer"));
  assert(!submitKeys.includes("reviewerFeedback"));
  assert(!submitKeys.includes("clientFeedback"));
  assert(!submitKeys.includes("clientFeedbackComments"));
  assert(!submitKeys.includes("internalFeedback"));
  assert(!submitKeys.includes("assignVerifier"));
}

function testCloserCanViewClientFeedback() {
  const field = catalog.getFieldDef("clientFeedback");
  assert(resolver.canViewFieldOnSurface(field, "agent", null, "main"));
  assert(resolver.canViewFieldOnSurface(field, "tl", null, "quality"));
  assert(!resolver.canEditFieldOnSurface(field, "agent", null, "quality", { user: { role: "agent" } }));
  assert(resolver.canEditFieldOnSurface(field, "quality", null, "quality", { user: { role: "quality" } }));
}

function testQualitySurfaceFields() {
  const keys = catalog.listFieldsForRoleOnSurface("quality", {}, "quality").map((f) => f.key);
  assert(keys.includes("reviewer"));
  assert(keys.includes("reviewerFeedback"));
  assert(keys.includes("internalFeedback"));
  assert(keys.includes("clientFeedback"));
  assert(keys.includes("clientFeedbackComments"));
  assert(!keys.includes("assignVerifier"));
  assert(!keys.includes("verifierFeedback"));
  const internal = catalog.listFieldsForRoleOnSurface("quality", {}, "quality").find((f) => f.key === "internalFeedback");
  assert.strictEqual(internal?.canEdit, false, "quality cannot edit internal feedback by default");
  assert.strictEqual(internal?.defaultValue, "Pending process");
  const rtmInternal = catalog.listFieldsForRoleOnSurface("rtm", {}, "quality").find((f) => f.key === "internalFeedback");
  assert.strictEqual(rtmInternal?.canEdit, true, "RTM can edit internal feedback");
  const adminInternal = catalog.listFieldsForRoleOnSurface("admin", {}, "main").find((f) => f.key === "internalFeedback");
  assert.strictEqual(adminInternal?.canEdit, true, "admin can edit internal feedback on view/edit");
  assert(!catalog.listFieldsForRole("agent", {}, { surface: "main" }).some((f) => f.key === "internalFeedback"));
  assert(!catalog.listFieldsForRole("hr", {}, { surface: "main" }).some((f) => f.key === "internalFeedback"));
  const grantQuality = {
    internalFeedback: {
      view_roles: ["quality", "rtm", "admin"],
      edit_roles: ["admin", "rtm", "quality"],
      main_view_roles: ["quality", "rtm", "admin"],
      quality_view_roles: ["quality", "rtm", "admin"],
    },
  };
  const qualityGranted = catalog.listFieldsForRoleOnSurface("quality", grantQuality, "quality").find((f) => f.key === "internalFeedback");
  assert.strictEqual(qualityGranted?.canEdit, true, "quality can edit after Sales permissions grant");
}

function testRpmQualityTicketRoles() {
  assert(roles.canWorkQualityTicket({ role: "quality" }));
  assert(roles.canWorkQualityTicket({ role: "rtm" }));
  assert(roles.canWorkQualityTicket({ role: "admin" }));
  assert(roles.canWorkQualityTicket({ role: "ceo" }));
  assert(!roles.canWorkQualityTicket({ role: "agent" }));
  assert(!roles.canWorkQualityTicket({ role: "tl" }));
  assert(!roles.canWorkQualityTicket({ role: "op" }));
  assert(!roles.canWorkQualityTicket({ role: "hr" }));
}

function testNotesField() {
  const submitKeys = catalog.listFieldsForSubmit("agent").map((f) => f.key);
  assert(submitKeys.includes("notes"), "notes on RPM submit form");
  assert(!catalog.getFieldDef("notes")?.required, "notes optional on submit");

  const mainKeys = catalog.listFieldsForRole("agent", {}, { surface: "main" }).map((f) => f.key);
  assert(mainKeys.includes("notes"), "notes on main/view surface");

  const qualityKeys = catalog.listFieldsForRoleOnSurface("quality", {}, "quality").map((f) => f.key);
  assert(qualityKeys.includes("notes"), "notes on quality surface");
  assert(qualityKeys.includes("internalFeedback"), "internal feedback on quality surface");

  const mainKeysAdmin = catalog.listFieldsForRole("quality", {}, { surface: "main" }).map((f) => f.key);
  assert(mainKeysAdmin.includes("internalFeedback"), "internal feedback on view/edit");
}

function testRpmAttachmentUploadRoles() {
  const rtmKinds = catalog.listAttachmentKindsForRole("rtm", {
    surface: "quality",
    user: { role: "rtm" },
    sale: { id: "1" },
  });
  const recording = rtmKinds.find((k) => k.key === "recording");
  assert(recording?.canEdit === true, "RTM can upload RPM recording on quality surface");

  const qualityKinds = catalog.listAttachmentKindsForRole("quality", {
    surface: "quality",
    user: { role: "quality" },
  });
  for (const key of ["recording", "raw_call", "quality_record"]) {
    const kind = qualityKinds.find((k) => k.key === key);
    assert(kind?.canView === true, `quality can view RPM ${key}`);
    assert(kind?.canEdit === true, `quality can upload RPM ${key}`);
  }
  assert(catalog.canEditAttachmentKind("quality_record", "quality"));
  const restrictive = {
    quality_record: { viewRoles: ["admin"], editRoles: ["admin"] },
  };
  assert(
    catalog.canEditAttachmentKind("quality_record", "quality", restrictive),
    "quality still uploads RPM quality_record when Access Control omits quality"
  );
}

testStatusMapping();
testSubmitExcludesQualityFields();
testCloserCanViewClientFeedback();
testQualitySurfaceFields();
testRpmQualityTicketRoles();
testNotesField();
testRpmAttachmentUploadRoles();
console.log("test-rpm-sales-quality: OK");
