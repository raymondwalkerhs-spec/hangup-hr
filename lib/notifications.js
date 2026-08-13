const hrms = require("./hrms-repo");

const store = require("./data-store");

const { useSupabase } = require("./backend");

const notifyStore = require("./notify-store");

const companyContext = require("./company-context");

async function notificationItemInCompany(item, company, scopedIds) {
  const et = String(item.entityType || item.type || "").toLowerCase();
  const eid = String(item.entityId || "");

  if (et === "employee" || et === "employee_note") {
    const empId = eid.split(":")[0] || eid;
    return scopedIds.has(empId);
  }
  if (et === "leave" || et === "leave_request" || item.type === "leave") {
    if (!eid) return true;
    const leaves = await hrms.readLeaveRequests({ company });
    return leaves.some((l) => String(l.id) === eid);
  }
  if (et === "expense" || item.type === "expense") {
    if (!eid) return true;
    try {
      const business = require("./business-repo");
      const exp = await business.getExpenseRequest(eid);
      return exp && (exp.company || "hangup") === company;
    } catch {
      return false;
    }
  }
  if (et === "it_request" || String(item.type || "").includes("it_request")) {
    if (!eid) return true;
    try {
      const itRequestsRepo = require("./it-requests-repo");
      const req = await itRequestsRepo.readItRequestById(eid);
      return req && scopedIds.has(req.employeeId);
    } catch {
      return false;
    }
  }
  if (et === "meeting_request" || String(item.type || "").includes("meeting")) {
    if (!eid) return true;
    try {
      const meetingRequestsRepo = require("./meeting-requests-repo");
      const req = await meetingRequestsRepo.readMeetingRequestById(eid);
      return req && scopedIds.has(req.requesterEmployeeId);
    } catch {
      return false;
    }
  }
  if (et === "loan_request" || String(item.type || "").includes("loan")) {
    if (!eid) return true;
    try {
      const loanReq = require("./loan-requests-repo");
      const rows = await loanReq.readLoanRequests({ company });
      const row = rows.find((r) => String(r.id) === eid);
      return row && (row.company || "hangup") === company && scopedIds.has(row.employeeId);
    } catch {
      return false;
    }
  }
  if (et === "bonus_request" || String(item.type || "").includes("bonus")) {
    if (!eid) return true;
    try {
      const business = require("./business-repo");
      const rows = await business.readBonusRequests({});
      const row = rows.find((r) => String(r.id) === eid);
      return row && scopedIds.has(row.employeeId);
    } catch {
      return false;
    }
  }
  if (et === "document" || item.type === "document") {
    const body = String(item.body || "");
    const empId = body.split(":")[0]?.trim();
    return empId ? scopedIds.has(empId) : true;
  }
  if (et === "quality_note" || item.type === "quality_note") {
    const empId = eid.split(":")[0] || "";
    return empId ? scopedIds.has(empId) : false;
  }
  if (et === "registration" || et === "registration_pending" || item.type === "registration") {
    if (!eid) return false;
    try {
      const registration = require("./registration");
      const pending = await registration.listPendingRegistrations(company);
      return pending.some((r) => String(r.id) === eid);
    } catch {
      return false;
    }
  }
  if (et === "announcement" || item.type === "announcement") {
    return true;
  }
  if (et === "sale" || item.type === "sale" || String(item.type || "").includes("sale")) {
    if (!eid) return false;
    try {
      const business = require("./business-repo");
      const sale = await business.getSale(eid);
      if (!sale) return false;
      return companyContext.filterSalesByCompanyContext([sale], company).length > 0;
    } catch {
      return false;
    }
  }
  if (item.type === "system") return true;
  return false;
}

async function collectNotifications(username, role, company = "hangup") {
  const items = [];
  const now = new Date();
  const scopedEmployees = companyContext.filterEmployeesByCompany(
    store.getEmployees({ hideOut: false }),
    company
  );
  const scopedIds = new Set(scopedEmployees.map((e) => e.id));

  if (useSupabase()) {
    try {
      const persisted = await notifyStore.readNotifications(username, { limit: 100, company });
      for (const n of persisted) {
        if (n.company && n.company !== company) continue;
        if (!(await notificationItemInCompany(n, company, scopedIds))) continue;
        items.push({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          createdAt: n.createdAt,
          entityType: n.entityType,
          entityId: n.entityId,
          readAt: n.readAt,
          persisted: true,
        });
      }

      const leave = await hrms.readLeaveRequests({ status: "pending", company });
      const approvers = ["mark", "raymond", "phoebe"];
      if (approvers.includes(String(username || "").toLowerCase())) {
        for (const l of leave.slice(0, 10)) {
          items.push({
            id: `leave-${l.id}`,
            type: "leave",
            title: "Leave request pending approval",
            body: `${l.employeeId}: ${l.startDate} – ${l.endDate}`,
            createdAt: l.createdAt,
          });
        }
      }
      const roles = require("./roles");
      if (roles.canApproveLoanRequest(username)) {
        const loanReq = require("./loan-requests-repo");
        const pendingLoans = await loanReq.readLoanRequests({ status: "pending", company });
        for (const r of pendingLoans.filter((x) => scopedIds.has(x.employeeId)).slice(0, 8)) {
          items.push({
            id: `loan-req-${r.id}`,
            type: "loan_request",
            title: "Loan request pending approval",
            body: `${r.employeeId}: ${r.totalAmount} EGP`,
            createdAt: r.createdAt,
          });
        }
      }

      const u = String(username || "").toLowerCase();
      if (roles.FINANCE_ACCESS_USERS.includes(u)) {
        const business = require("./business-repo");
        const expenses = await business.readExpenseRequests({ excludeArchived: true, company });
        const today = new Date().toISOString().slice(0, 10);
        for (const e of expenses.filter((x) => x.status === "pending_approval").slice(0, 5)) {
          items.push({
            id: `exp-approval-${e.id}`,
            type: "expense",
            title: "Expense needs approval",
            body: `${e.vendorName}: ${e.amount} EGP`,
            createdAt: e.createdAt,
          });
        }
        for (const e of expenses
          .filter((x) => x.dueDate && x.dueDate < today && !["paid", "archived", "denied"].includes(x.status))
          .slice(0, 5)) {
          items.push({
            id: `exp-overdue-${e.id}`,
            type: "expense",
            title: "Overdue expense",
            body: `${e.vendorName}: due ${e.dueDate}`,
            createdAt: e.createdAt,
          });
        }
      }

      const docs = store.getEmployeeDocuments();
      if (Array.isArray(docs)) {
        const soon = docs.filter((d) => {
          if (!scopedIds.has(d.employeeId)) return false;
          if (d.noExpiry || !d.expiry) return false;
          const exp = new Date(d.expiry);
          const days = (exp - now) / (86400000);
          return days >= 0 && days <= 30;
        });
        for (const d of soon.slice(0, 8)) {
          items.push({
            id: `doc-${d.employeeId}-${d.fileName}`,
            type: "document",
            title: "Document expiring soon",
            body: `${d.employeeId}: ${d.docType} expires ${d.expiry}`,
          });
        }
      }
    } catch (err) {
      items.push({
        id: "sync-warn",
        type: "system",
        title: "Notification check issue",
        body: err.message,
      });
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const item of items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))) {
    const key = item.id || `${item.type}-${item.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

module.exports = { collectNotifications, notificationItemInCompany };
