#!/usr/bin/env node
/**
 * Audit departure payroll rules for all OUT employees with depart_date.
 */
require("dotenv").config();

const { normalizeNoticeType } = require("../lib/employee-depart");
const { noticePayPercent } = require("../lib/resignation-payroll");

function label(type) {
  const t = normalizeNoticeType(type);
  if (t === "company_decision") return "Company decision (no deductions)";
  if (t === "without_notice") return "Without notice (2wk basic + transport penalty)";
  return "With notice (sales-scaled basic)";
}

async function main() {
  const store = require("../lib/data-store");
  if (store.init) await store.init();

  const out = store.getEmployees().filter((e) => {
    const st = String(e.status || "").toLowerCase();
    return (st === "out" || st.includes("still get paid")) && e.depart_date;
  });

  console.log(`Departed employees: ${out.length}\n`);
  const byType = new Map();
  for (const emp of out) {
    const t = normalizeNoticeType(emp.notice_type);
    byType.set(t, (byType.get(t) || 0) + 1);
  }
  console.log("By notice_type:");
  for (const [t, n] of [...byType.entries()].sort()) {
    console.log(`  ${t}: ${n}`);
  }

  console.log("\nDetail:");
  for (const emp of out.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const t = normalizeNoticeType(emp.notice_type);
    const departYm = String(emp.depart_date).slice(0, 7);
    const adj = store.getPayrollAdjustment(departYm, emp.id);
    const dedEvents = store.getDeductionEvents(departYm, emp.id) || [];
    const leaveDed = dedEvents.filter((d) =>
      String(d.type || "").includes("No-Notice")
    );
    const noticePct = adj?.noticePayPercent;
    console.log(
      `  ${emp.id}  depart=${emp.depart_date}  ${label(t)}` +
        (leaveDed.length ? `  penalties=${leaveDed.length}` : "") +
        (noticePct != null ? `  noticePay=${noticePct}%` : "")
    );
  }

  console.log("\nNotice pay scale check:");
  for (let s = 4; s <= 10; s++) {
    console.log(`  ${s} sales → ${noticePayPercent(s)}%`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
