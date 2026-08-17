#!/usr/bin/env node
/** Reviewer picker + employee app role enrichment */
const assert = require("assert");
const employeeAppRole = require("../lib/employee-app-role");
const qualityAssignees = require("../lib/sales-quality-assignees");
const rpmCatalog = require("../lib/sales-rpm-field-catalog");

const employees = [
  { id: "HS3-90", american_name: "Quality User", team: "Quality", status: "Active" },
  { id: "RTM-01", american_name: "RTM Lead", team: "Quality", status: "Active" },
  { id: "HS3-10", american_name: "Agent", team: "Phoenix", status: "Active" },
  { id: "QA-legacy", american_name: "Legacy QA", team: "Quality", status: "Active" },
  { id: "HR-2", american_name: "Eva", team: "HR", status: "Active" },
];

const appUsers = [
  { username: "qa1", employee_id: "HS3-90", role: "quality" },
  { username: "rtm1", employee_id: "RTM-01", role: "rtm" },
  { username: "agent1", employee_id: "HS3-10", role: "agent" },
  { username: "Eva", employee_id: "HR-2", role: "quality" },
];

const enriched = employeeAppRole.enrichEmployeesWithAppRole(employees, appUsers);
assert.strictEqual(enriched.find((e) => e.id === "HS3-90")?.role, "quality");
assert.strictEqual(enriched.find((e) => e.id === "RTM-01")?.role, "rtm");
assert.strictEqual(enriched.find((e) => e.id === "QA-legacy")?.role, "quality");

const reviewers = enriched.filter((e) => qualityAssignees.isEligibleQualityReviewer(e));
assert.deepStrictEqual(
  reviewers.map((e) => e.id).sort(),
  ["HS3-90", "HR-2", "QA-legacy", "RTM-01"].sort()
);
assert.strictEqual(enriched.find((e) => e.id === "HR-2")?.role, "quality");
assert.strictEqual(
  qualityAssignees.isNonDialingReviewer(enriched.find((e) => e.id === "HR-2")),
  true,
  "Eva / HR-2 is a reviewer, not a dialing agent"
);

const reviewerField = rpmCatalog.listFieldsForRoleOnSurface("rtm", {}, "quality").find((f) => f.key === "reviewer");
assert.strictEqual(reviewerField?.canEdit, true, "RTM can edit reviewer on RPM quality ticket");

const rtmRecording = rpmCatalog.listAttachmentKindsForRole("rtm", {}, { surface: "quality" }).find((k) => k.key === "recording");
assert.strictEqual(rtmRecording?.canEdit, true, "RTM can upload RPM recording");

console.log("test-sales-reviewer-picker: OK");
