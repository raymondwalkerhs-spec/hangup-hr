const TRANSPORT_ELIGIBLE_FROM_MONTH = "2026-07";

function transportAllowedForMonth(month) {
  return String(month || "") >= TRANSPORT_ELIGIBLE_FROM_MONTH;
}

function transportCheckboxChecked(month, adj) {
  if (adj?.transportEligible === true) return true;
  if (adj?.transportEligible === false) return false;
  return transportAllowedForMonth(month);
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function splitStatusBadge(status) {
  const cls =
    status === "received" ? "badge-ok" : status === "deferred" ? "badge-warn" : "badge-status";
  return `<span class="badge ${cls}">${status}</span>`;
}

const SESSION_CHECK_MS = 5 * 60 * 1000;
const VERSION_NOTICE_KEY = "hr_version_notice_dismissed";
const APP_UPDATE_CHECK_MS = 30 * 60 * 1000;
const SAVED_USER_KEY = "hr_saved_user";
const SESSION_KEY = "hr_session_id";

function getSessionId() {
  try {
    return sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

function clearSessionId() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function getSavedUsername() {
  try {
    return localStorage.getItem(SAVED_USER_KEY) || "";
  } catch {
    return "";
  }
}

function localYearMonth(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const state = {
  user: null,
  page: "dashboard",
  month: localYearMonth(),
  unit: "",
  team: "",
  hideOut: true,
  hideZeroNet: false,
  companyContext: sessionStorage.getItem("companyContext") || "hangup",
  salesPickDate: new Date().toISOString().slice(0, 10),
  salesWeekDate: new Date().toISOString().slice(0, 10),
  tabSearch: { employees: "", attendance: "", payroll: "" },
  empFilter: { status: "", unit: "", nationality: "", workPermit: "", insuranceStatus: "" },
  changesFilter: { user: "", entity: "" },
  meta: { statuses: [], units: [], positions: [], backendPools: [] },
  pendingAttendance: new Map(),
  saveTimer: null,
};

let renderGeneration = 0;
let appReady = false;

function buildApiQuery(params = {}) {
  const q = listHideOutQuery();
  if (state.companyContext === "hs2") q.set("company", "hs2");
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") q.set(k, String(v));
  }
  return q;
}

function apiContextQuery(params = {}) {
  const s = buildApiQuery(params).toString();
  return s ? `?${s}` : "";
}

function employeesQuery() {
  return apiContextQuery();
}

function listHideOutQuery() {
  const q = new URLSearchParams();
  if (state.hideOut) q.set("hideOut", "true");
  else q.set("showOut", "true");
  return q;
}

function payrollRowNet(r) {
  if (r?.payrollKind === "dual") return r.combinedNet ?? r.netSalary ?? 0;
  return r?.netSalary ?? 0;
}

function payrollRowBasic(r) {
  if (r?.payrollKind === "dual") return r.combinedBasic ?? r.basicSalary ?? 0;
  return r?.basicSalary ?? 0;
}

function payrollNetAmount(row) {
  if (!row) return 0;
  if (row.hasSplits) return Number(row.calculatedNet ?? payrollRowNet(row) ?? 0);
  return Number(payrollRowNet(row) ?? 0);
}

function filterPayrollByZeroNet(rows) {
  if (!state.hideZeroNet) return rows;
  return rows.filter((r) => payrollNetAmount(r) !== 0);
}

function isOutEmployee(emp) {
  if (!emp) return true;
  if (emp.status === "Deleted" || emp.deleted_at) return true;
  if (emp.status === "Out") return true;
  if (!emp.status && !emp.american_name && !emp.arabic_name) return true;
  return false;
}

function isUnassignedIdStub(emp) {
  if (!emp?.id || emp.status === "Deleted" || emp.deleted_at) return false;
  if (emp.american_name || emp.arabic_name) return false;
  if (emp.promoted_to_id || emp.promoted_from_id) return false;
  return true;
}

function closeSidebarNav() {
  document.getElementById("app-sidebar")?.classList.remove("sidebar-open");
  const backdrop = document.getElementById("sidebar-backdrop");
  backdrop?.classList.remove("visible");
  backdrop?.classList.add("hidden");
  const toggle = document.getElementById("nav-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
  }
}

function openSidebarNav() {
  document.getElementById("app-sidebar")?.classList.add("sidebar-open");
  const backdrop = document.getElementById("sidebar-backdrop");
  backdrop?.classList.remove("hidden");
  requestAnimationFrame(() => backdrop?.classList.add("visible"));
  const toggle = document.getElementById("nav-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close menu");
  }
}

function initSidebarNav() {
  const toggle = document.getElementById("nav-toggle");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    const open = document.getElementById("app-sidebar")?.classList.contains("sidebar-open");
    if (open) closeSidebarNav();
    else openSidebarNav();
  });
  backdrop?.addEventListener("click", closeSidebarNav);
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeSidebarNav();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSidebarNav();
  });
}

function navPageAlias(page) {
  if (page === "leave") return "requests";
  return page;
}

function canNavigateToPage(page) {
  const btn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  if (!btn) return false;
  if (btn.classList.contains("hidden")) return false;
  return true;
}

function syncNavActiveState(page) {
  document.querySelectorAll(".nav-btn").forEach((b) => {
    const match = b.dataset.page === page && !b.classList.contains("hidden");
    b.classList.toggle("active", match);
  });
}

function ensureNavPageAllowed(page) {
  const normalized = navPageAlias(page);
  if (canNavigateToPage(normalized)) return normalized;
  return "dashboard";
}

const NATIONALITY_ALIASES = {
  egyptain: "egyptian",
  egypt: "egyptian",
  sudan: "sudanese",
  ethiopia: "ethiopian",
  eritrea: "eritrean",
  "south sudan": "south sudanese",
};

function normNationality(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return NATIONALITY_ALIASES[raw] || raw;
}

const TRANSPORT_OVERRIDE_STATUSES = new Set([
  "Half Day",
  "NSNC Half Day",
  "Lateness A",
  "Lateness B",
  "Quarter Day-Off",
]);

function isTransportOverrideStatus(status) {
  return TRANSPORT_OVERRIDE_STATUSES.has(status);
}

const TEAM_OPTIONS = [
  "Back-End",
  "Daemon",
  "Steven",
  "Justin",
  "Ayla",
  "Tris",
  "Jude",
  "HR",
  "Quality",
  "_____",
];

const CASH_BRANCHES = ["Makram", "Abbas", "Square", "Other"];

const PAYMENT_METHOD_OPTIONS = [
  { value: "Instapay / Wallet", label: "Instapay / Wallet" },
  { value: "Cash", label: "Cash" },
  { value: "Bank Account", label: "Bank Account" },
];

const TL_BONUS_TYPE = "Bonus from TL / OP";

function normalizePaymentMethodValue(method) {
  const m = String(method || "").trim().toLowerCase();
  if (!m) return "";
  if (m.includes("insta") || m.includes("wallet") || m.includes("instapay")) return "Instapay / Wallet";
  if (m.includes("cash")) return "Cash";
  if (m.includes("bank")) return "Bank Account";
  return String(method || "").trim();
}

function paymentMethodFieldsHtml(emp = {}) {
  const pm = normalizePaymentMethodValue(emp.payment_method);
  const branch = emp.alternative_payment || "";
  return `
    <label class="field"><span>Payment Method</span>
      <select name="payment_method" id="emp-payment-method">
        <option value="">— Select —</option>
        ${PAYMENT_METHOD_OPTIONS.map(
          (o) => `<option value="${o.value}" ${pm === o.value ? "selected" : ""}>${o.label}</option>`
        ).join("")}
      </select>
    </label>
    <div id="pay-insta-wrap" class="field ${pm === "Instapay / Wallet" ? "" : "hidden"}" style="grid-column:1/-1">
      <label class="field"><span>Instapay / wallet number or address</span>
        <input name="payment_details_insta_wallet" value="${emp.payment_details_insta_wallet || ""}" placeholder="Phone, username, or wallet ID" />
      </label>
    </div>
    <div id="pay-cash-wrap" class="${pm === "Cash" ? "" : "hidden"}" style="grid-column:1/-1">
      <label class="field"><span>Cash branch</span>
        <select name="alternative_payment" id="emp-cash-branch">
          <option value="">— Select branch —</option>
          ${CASH_BRANCHES.map(
            (b) => `<option value="${b}" ${branch === b ? "selected" : ""}>${b}</option>`
          ).join("")}
        </select>
      </label>
    </div>
    <div id="pay-bank-wrap" class="${pm === "Bank Account" ? "" : "hidden"}" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <label class="field"><span>Bank reference number</span>
        <input name="bank_refrence_number" value="${emp.bank_refrence_number || ""}" />
      </label>
      <label class="field"><span>Name in bank sheet</span>
        <input name="bank_name_as_bank_sheet" value="${emp.bank_name_as_bank_sheet || ""}" />
      </label>
    </div>`;
}

function bindPaymentMethodFields() {
  const sel = document.getElementById("emp-payment-method");
  if (!sel) return;
  const refresh = () => {
    const v = sel.value;
    document.getElementById("pay-insta-wrap")?.classList.toggle("hidden", v !== "Instapay / Wallet");
    document.getElementById("pay-cash-wrap")?.classList.toggle("hidden", v !== "Cash");
    document.getElementById("pay-bank-wrap")?.classList.toggle("hidden", v !== "Bank Account");
  };
  sel.onchange = refresh;
  refresh();
}

function isOutEmployeeStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  return s === "out" || s.includes("out but still");
}

function positionSelectHtml(name, value, id = "emp-position") {
  const v = value || "";
  const fromRates = state.meta?.positionRates || [];
  const fromPositions = state.meta?.positions || [];
  const opts = [...new Set([...fromRates, ...fromPositions, v].filter(Boolean))];
  return `<label class="field"><span>Position</span>
    <select name="${name}" id="${id}">
      <option value="">— Select position —</option>
      ${opts.map((p) => `<option value="${escapeHtml(p)}" ${v === p ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}
    </select>
  </label>`;
}

function teamSelectHtml(name, value, id = "emp-team", unitFilter = "") {
  const v = value || "";
  let orgTeams = (state.orgTeams || []).map((t) => t.name);
  if (unitFilter && state.orgTeams?.length) {
    orgTeams = state.orgTeams.filter((t) => t.unit === unitFilter).map((t) => t.name);
  }
  const opts = [...new Set([...orgTeams, v].filter(Boolean))];
  return `<label class="field"><span>Team</span>
    <select name="${name}" id="${id}">
      <option value="">— Select team —</option>
      ${opts.map((t) => `<option value="${t}" ${v === t ? "selected" : ""}>${t}</option>`).join("")}
    </select>
  </label>`;
}

async function ensureOrgTeams(api) {
  if (state.orgTeams?.length) return state.orgTeams;
  try {
    const res = await api("/hrms/teams");
    state.orgTeams = res.teams || [];
  } catch {
    state.orgTeams = state.orgTeams || [];
  }
  return state.orgTeams;
}

function teamsForUnit(unit) {
  const teams = state.orgTeams || [];
  if (!unit) return teams;
  return teams.filter((t) => t.unit === unit && t.dialsSales !== false);
}

function renderWizardTeamOptions(unit, selected = "") {
  const teams = teamsForUnit(unit);
  if (!teams.length && state.orgTeams?.length) {
    return state.orgTeams.map((t) => `<option value="${escapeHtml(t.name)}" ${selected === t.name ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
  }
  return teams.map((t) => `<option value="${escapeHtml(t.name)}" ${selected === t.name ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
}

function pageSkeleton(label = "Loading…") {
  return `<div class="page-loader">
    <div class="page-loader-inner">
      <div class="loader-orbit loader-orbit-sm">
        <div class="loader-orbit-ring"></div>
        <div class="loader-orbit-core"><img src="/img/hr-team.png" alt="" /></div>
      </div>
      <p class="page-loader-text">${label}</p>
      <div class="loader-dots"><span></span><span></span><span></span></div>
    </div>
  </div>`;
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.classList.toggle("is-loading", loading);
  btn.disabled = loading;
}

async function downloadFile(path, filename) {
  const sessionId = getSessionId();
  const res = await fetch(`/api${path}`, {
    headers: sessionId ? { "x-session-id": sessionId } : {},
  });
  if (res.status === 401) {
    window.location.href = "/login";
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function api(path, options = {}, timeoutMs = 120000) {
  if (typeof resetIdleTimer === "function") resetIdleTimer();
  const sessionId = getSessionId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(sessionId ? { "x-session-id": sessionId } : {}),
        ...options.headers,
      },
      ...options,
      signal: controller.signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try Refresh data.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    clearSessionId();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || res.statusText;
    if (msg.toLowerCase().includes("credentials") || msg.toLowerCase().includes("service account")) {
      throw new Error(msg);
    }
    if (data.offline) throw new Error("Internet required to sync HR data. Check your connection.");
    throw new Error(msg);
  }
  // Every successful write is pushed to the Google Sheet by the server; afterwards
  // we quietly pull the newest data back so the local view stays current with edits
  // made by other users. Sync calls themselves are excluded to avoid a loop.
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && !path.startsWith("/sync/")) {
    scheduleSilentRefresh();
  }
  return data;
}

let silentRefreshTimer = null;

function scheduleSilentRefresh() {
  clearTimeout(silentRefreshTimer);
  silentRefreshTimer = setTimeout(runSilentRefresh, 3000);
}

function isModalOpen() {
  return !!document.getElementById("modal-root")?.childElementCount;
}

async function runSilentRefresh() {
  if (state.pendingAttendance.size > 0 || isModalOpen()) {
    scheduleSilentRefresh();
    return;
  }
  try {
    await api("/sync/refresh", { method: "POST" });
    await refreshStatus();
  } catch {
    /* offline or transient — next write/refresh will retry */
  }
}

function showSyncOverlay(show) {
  document.getElementById("sync-overlay")?.classList.toggle("hidden", !show);
}

function showSaveIndicator(msg, type = "info") {
  const el = document.getElementById("save-indicator");
  if (!el) return;
  el.textContent = msg;
  el.className = `save-indicator save-${type}`;
  el.classList.remove("hidden");
  if (type === "saved") setTimeout(() => el.classList.add("hidden"), 2000);
}

async function initialSync() {
  // First run on a fresh PC starts with an empty local cache, so the post-login
  // sync must succeed before the app is usable. Retry a few times to ride out a
  // slow/flaky first connection; if it still fails, let boot() show the retry card.
  showSyncOverlay(true);
  try {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await api("/sync/refresh", { method: "POST" });
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw lastErr;
  } finally {
    showSyncOverlay(false);
    await refreshStatus();
  }
}

async function refreshData() {
  showSyncOverlay(true);
  try {
    await api("/sync/refresh", { method: "POST" });
    showSaveIndicator("Data refreshed", "saved");
    await refreshStatus();
    render();
  } catch (e) {
    showSaveIndicator(e.message, "error");
  } finally {
    showSyncOverlay(false);
  }
}

async function checkSession() {
  try {
    const data = await api("/session-check");
    if (data.action === "session_revoked") {
      clearSessionId();
      alert(data.message || "Session ended. Sign in again.");
      window.location.href = "/login";
      return false;
    }
    if (data.action === "version_blocked") {
      showVersionBlockedScreen(data.message, data.versionCheck || data);
      return false;
    }
    if (data.action === "uninstall" && window.hrDesktop) {
      await window.hrDesktop.triggerUninstall();
      return false;
    }
    if (data.action === "admin") {
      clearSessionId();
      alert(data.message || "Contact Admin.");
      window.location.href = "/login";
      return false;
    }
    // Always check GitHub for app updates (all users, not role-based).
    checkForAppUpdate(data.versionNotice || null);
    if (data.settingsRevision && window.HRSalesConfigBreaks) {
      window.HRSalesConfigBreaks.onSettingsRevision(api, data.settingsRevision, state);
    }
    if (data.activeBreak && window.HRSalesConfigBreaks) {
      window.HRSalesConfigBreaks.handleActiveBreak(data.activeBreak);
    }
    return true;
  } catch {
    return true;
  }
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function monthPayrollFolderName(ym) {
  return `${monthLabel(ym).replace(/ /g, "_")}_Payroll`;
}

function parseTlSourceFromReason(reason) {
  const m = String(reason || "").match(/deducted from\s+(\S+)\)/i);
  return m ? m[1] : "";
}

function parseTlTargetFromReason(reason) {
  const m = String(reason || "").match(/paid to\s+(\S+)/i);
  return m ? m[1] : "";
}

function bonusRecipientCell(d, empById) {
  const targetId = d.bonusRecipientId || parseTlTargetFromReason(d.reason);
  if (!targetId) return `<span class="muted">—</span>`;
  const target = empById.get(targetId);
  const american = d.bonusRecipientAmericanName || target?.american_name || "";
  const fallback = american || target?.arabic_name || targetId;
  return `<div class="bonus-recipient-cell">
    <strong>${escapeHtml(targetId)}</strong><br>
    <span>${escapeHtml(american || fallback)}</span>
    ${american && target?.arabic_name ? `<br><span class="muted">${escapeHtml(target.arabic_name)}</span>` : ""}
  </div>`;
}

function deductionActionCells(d, canEdit) {
  if (!canEdit) return "";
  const key = JSON.stringify({ employeeId: d.employeeId, date: d.date, type: d.type });
  return `<td class="btn-row">
    <button class="btn btn-sm" data-edit-ded='${key}'>Edit</button>
    <button class="btn btn-sm btn-danger" data-del-ded='${key}'>Delete</button>
  </td>`;
}

function bindDeductionTableActions(root, deductions, employees, dedTypes) {
  root.querySelectorAll("[data-edit-ded]").forEach((btn) => {
    btn.onclick = () => {
      const key = JSON.parse(btn.dataset.editDed);
      const d = deductions.find((x) => x.employeeId === key.employeeId && x.date === key.date && x.type === key.type);
      if (d) openDeductionEditModal(d, employees, dedTypes || []);
    };
  });
  root.querySelectorAll("[data-del-ded]").forEach((btn) => {
    btn.onclick = () => {
      const payload = JSON.parse(btn.dataset.delDed);
      openConfirmDeleteModal({
        title: "Delete deduction",
        message: `Delete ${payload.type} on ${payload.date}?`,
        onConfirm: async () => {
          await api("/deductions", { method: "DELETE", body: JSON.stringify(payload) });
          render();
        },
      });
    };
  });
}

function formatPayslipDate(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function attendanceDetailHtml(records) {
  const lines = (records || [])
    .filter((r) => ["Lateness A", "Lateness B", "Quarter Day-Off", "Half Day"].includes(r.status))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((r) => {
      const when = formatPayslipDate(r.date);
      if (r.status === "Lateness A") return `<div class="muted" style="font-size:.85rem;padding-left:.5rem">Lateness A — 25 EGP on ${when}</div>`;
      if (r.status === "Lateness B") return `<div class="muted" style="font-size:.85rem;padding-left:.5rem">Lateness B — 50 EGP on ${when}</div>`;
      if (r.status === "Quarter Day-Off") return `<div class="muted" style="font-size:.85rem;padding-left:.5rem">Quarter day on ${when}</div>`;
      if (r.status === "Half Day") return `<div class="muted" style="font-size:.85rem;padding-left:.5rem">Half day on ${when}</div>`;
      return "";
    })
    .join("");
  return lines;
}

function canManagePayrollEvents() {
  return state.user?.canManageEmployees === true || ["admin", "ceo", "hr"].includes(state.user?.role);
}

function canManageOrgStructure() {
  return state.user?.canManageOrg === true;
}

function canViewEmployeeNotes() {
  return state.user?.canViewEmployeeNotes === true;
}

function canWriteEmployeeNotes() {
  return state.user?.canWriteEmployeeNotes === true;
}

function canViewQualityNotes() {
  return state.user?.canViewQualityNotes === true;
}

function canWriteQualityNotes() {
  return state.user?.canWriteQualityNotes === true;
}

function canExportSales() {
  return state.user?.canExportSales === true;
}

function canViewEquipmentNav() {
  return state.user?.canViewEquipmentInventory === true;
}

function canEditAttendance() {
  return state.user?.canEditAttendance === true;
}

function canViewTransportControls() {
  return state.user?.canViewTransportControls === true;
}

function canViewBonusTransferSource() {
  return state.user?.canViewBonusTransferSource === true;
}

function canViewTlOpBonusTransfers() {
  return state.user?.canViewTlOpBonusTransfers === true;
}

function canViewReports() {
  return state.user?.canViewReports === true;
}

function canViewEmployeeNationality() {
  return state.user?.canViewEmployeeNationality === true;
}

function canViewEmployeeCompliance() {
  return state.user?.canViewEmployeeCompliance === true;
}

function canViewEmployeeComplianceFilters() {
  return state.user?.canViewEmployeeComplianceFilters === true;
}

function canUseEmployeeFilters() {
  return state.user?.canUseEmployeeFilters === true;
}

function canAddEmployee() {
  return state.user?.canAddEmployee === true;
}

function canViewEmployeeInternalId() {
  return state.user?.role !== "agent";
}

function canEditTlBonuses() {
  return canManagePayrollEvents() || state.user?.canTransferBonus === true;
}

function canViewBonusesDeductions() {
  if (state.user?.canViewBonuses === true) return true;
  return ["admin", "ceo", "hr", "finance", "op", "tl", "quality", "rtm", "agent", "office_assistant"].includes(
    state.user?.role
  );
}

function canSubmitBonusRequest() {
  return state.user?.canSubmitBonusRequest === true || ["tl", "op", "quality", "rtm", "admin", "hr"].includes(state.user?.role);
}

function canApproveBonusRequest() {
  return state.user?.canApproveBonusRequest === true || ["admin", "ceo", "hr"].includes(state.user?.role);
}

function employeeSelectOptions(employees, selectedId = "") {
  return employees
    .map(
      (e) =>
        `<option value="${e.id}" ${e.id === selectedId ? "selected" : ""}>${e.id} — ${escapeHtml(e.american_name || e.arabic_name || e.id)}</option>`
    )
    .join("");
}

function isLeadershipEmployeeId(id) {
  const s = String(id || "").trim().toUpperCase();
  return /^(TL|CL|OP)/.test(s);
}

function sortEmployeesForLeadDeduct(employees) {
  const rank = (e) => {
    const id = String(e?.id || "").toUpperCase();
    if (id.startsWith("TL")) return 0;
    if (id.startsWith("CL")) return 1;
    if (id.startsWith("OP")) return 2;
    if (e?.lead_role) {
      const lr = String(e.lead_role).toUpperCase();
      if (lr === "TL") return 0;
      if (lr === "CL") return 1;
      if (lr === "OP") return 2;
    }
    return 99;
  };
  return [...employees].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  });
}

function employeeSelectOptionsForTlDeduct(employees, selectedId = "") {
  return sortEmployeesForLeadDeduct(employees)
    .map((e) => {
      const tag = isLeadershipEmployeeId(e.id) ? " ★" : "";
      return `<option value="${e.id}" ${e.id === selectedId ? "selected" : ""}>${e.id}${tag} — ${escapeHtml(e.american_name || e.arabic_name || e.id)}</option>`;
    })
    .join("");
}

function dayHeader(cal) {
  return `${cal.weekdayName} ${cal.dayOfMonth}`;
}

function isWeekend(d) {
  const dow = new Date(d + "T12:00:00").getDay();
  return dow === 0 || dow === 6;
}

function statusClass(status) {
  if (!status) return "st-empty";
  if (status === "Attended") return "st-attended";
  if (status === "Day-OFF") return "st-dayoff";
  if (status.includes("Lateness")) return "st-late";
  if (status === "NSNC" || status === "NSNC Half Day" || status.includes("Not Approved")) return "st-nsnc";
  return "";
}

function statusBadge(status) {
  if (!status) return '<span class="badge badge-out">—</span>';
  if (status === "Active") return '<span class="badge badge-active">Active</span>';
  if (status.includes("Paused")) return '<span class="badge badge-paused">Paused</span>';
  if (status.includes("OUT")) return '<span class="badge badge-paused">OUT</span>';
  if (status === "Out") return '<span class="badge badge-out">Out</span>';
  return `<span class="badge badge-status">${status}</span>`;
}

function payrollStatusBadge(status) {
  const s = (status || "pending").toLowerCase();
  const cls =
    s === "closed" || s === "received"
      ? "badge-active"
      : s.includes("pending")
        ? "badge-paused"
        : "badge-status";
  return `<span class="badge ${cls}">${status || "pending"}</span>`;
}

function initials(name) {
  return (name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function avatarHtml(emp, sizeClass = "") {
  if (!emp) return `<span class="emp-avatar ${sizeClass}">?</span>`;
  const name = emp.american_name || emp.name || emp.id;
  if (emp.profile_photo_file_id) {
    const v = emp.profile_photo_updated
      ? `?v=${encodeURIComponent(emp.profile_photo_updated)}`
      : "";
    const ini = initials(name);
    return `<span class="emp-avatar has-photo ${sizeClass}" data-ini="${ini}">
      <img src="/api/employees/${emp.id}/avatar${v}" alt="" loading="lazy"
        onerror="this.remove();this.parentElement.classList.remove('has-photo');this.parentElement.textContent=this.parentElement.dataset.ini;" />
    </span>`;
  }
  return `<span class="emp-avatar ${sizeClass}">${initials(name)}</span>`;
}

async function uploadProfilePhotoFile(employeeId, file) {
  if (!file?.size) throw new Error("Choose an image file");
  const contentBase64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return api(`/employees/${employeeId}/profile-photo`, {
    method: "POST",
    body: JSON.stringify({ fileName: file.name, contentBase64 }),
  });
}

function bindProfilePhotoUpload(employeeId, onDone) {
  const input = document.getElementById("profile-photo-input");
  const removeBtn = document.getElementById("remove-photo-btn");
  const uploadBtn = document.getElementById("upload-photo-btn") || document.getElementById("payslip-photo-btn");
  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      setButtonLoading(uploadBtn, true);
      await uploadProfilePhotoFile(employeeId, file);
      if (employeeId === state.user?.employeeId) await updateSidebarBrand();
      onDone?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setButtonLoading(uploadBtn, false);
      input.value = "";
    }
  });
  removeBtn?.addEventListener("click", async () => {
    if (!confirm("Remove profile photo?")) return;
    try {
      await api(`/employees/${employeeId}/profile-photo`, { method: "DELETE" });
      if (employeeId === state.user?.employeeId) await updateSidebarBrand();
      onDone?.();
    } catch (e) {
      alert(e.message);
    }
  });
}

function fmt(n) {
  return Math.round(n || 0).toLocaleString();
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

function closeModal() {
  const root = document.getElementById("modal-root");
  const backdrop = root?.querySelector(".modal-backdrop");
  if (!backdrop) {
    if (root) root.innerHTML = "";
    return;
  }
  if (backdrop.classList.contains("modal-closing")) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduceMotion) {
    root.innerHTML = "";
    return;
  }
  backdrop.classList.add("modal-closing");
  const cleanup = () => {
    if (root.querySelector(".modal-closing") === backdrop) root.innerHTML = "";
  };
  backdrop.addEventListener("animationend", cleanup, { once: true });
  setTimeout(cleanup, 260);
}

function versionNoticeDismissKey(currentVersion) {
  return `${VERSION_NOTICE_KEY}_${currentVersion || "unknown"}`;
}

function formatGitHubUpdateSize(bytes) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `~${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
  return `~${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function githubUpdateActionHint(githubInfo) {
  if (githubInfo?.updateDescription) return githubInfo.updateDescription;
  if (githubInfo?.installKind === "nsis") {
    return "Downloads the installer and upgrades silently. The app will close so the installer can finish.";
  }
  if (githubInfo?.installKind === "mac") {
    return "Downloads the full app and replaces it. The app will restart when finished.";
  }
  return "Downloads the full update package and applies it. The app will restart when finished.";
}

async function handleGitHubUpdateApply(statusEl, onFail) {
  const result = await window.hrDesktop.applyGitHubUpdate();
  if (result?.needsQuit) {
    if (statusEl) statusEl.textContent = "Installer started. The app will close…";
    return result;
  }
  if (statusEl) statusEl.textContent = "Update ready. Restarting…";
  setTimeout(() => window.hrDesktop.relaunchApp?.(), 800);
  return result;
}

function showVersionUpdateNotice(notice, githubInfo = null) {
  if (!githubInfo?.updateAvailable && !notice?.message) return;
  const latest = githubInfo?.latest || notice?.currentVersion;
  const key = versionNoticeDismissKey(latest);
  try {
    if (sessionStorage.getItem(key) === "1") return;
  } catch (_) {}

  const canAutoUpdate = Boolean(githubInfo?.updateAvailable && window.hrDesktop?.applyGitHubUpdate);
  const message =
    (githubInfo?.updateAvailable
      ? `Version ${githubInfo.latest} is available on GitHub (you have ${githubInfo.current || notice?.appVersion || "this version"}).`
      : "") ||
    notice?.message ||
    "A newer app version is available.";

  openModal(`
    <div class="modal-header">
      <h2>Update available</h2>
      <button type="button" class="btn btn-ghost btn-sm" data-close aria-label="Close">×</button>
    </div>
    <div class="modal-body">
      <div class="alert alert-warn">${escapeHtml(message)}</div>
      <p class="muted">You are on <strong>${escapeHtml(notice?.appVersion || githubInfo?.current || "this version")}</strong>.
      The latest version is <strong>${escapeHtml(latest || "unknown")}</strong>.</p>
      ${
        canAutoUpdate
          ? `<p class="muted">Click <strong>Update now</strong> to ${escapeHtml(githubUpdateActionHint(githubInfo))}${
              githubInfo?.assetSize ? ` Download size: ${formatGitHubUpdateSize(githubInfo.assetSize)}.` : ""
            }</p>`
          : `<p class="muted">You can keep working for now. Install the latest build when convenient.</p>`
      }
      <div id="version-update-status" class="muted" style="margin-top:.5rem;display:none"></div>
    </div>
    <div class="modal-footer">
      ${canAutoUpdate ? `<button type="button" class="btn btn-primary" id="version-notice-update">Update now</button>` : ""}
      <button type="button" class="btn" id="version-notice-continue">Continue</button>
    </div>`);

  const root = document.getElementById("modal-root");
  root.querySelector("#version-notice-continue")?.addEventListener("click", () => {
    try {
      sessionStorage.setItem(key, "1");
    } catch (_) {}
    closeModal();
  });

  root.querySelector("#version-notice-update")?.addEventListener("click", async () => {
    const btn = root.querySelector("#version-notice-update");
    const statusEl = root.querySelector("#version-update-status");
    if (!btn || !window.hrDesktop?.applyGitHubUpdate) return;
    btn.disabled = true;
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.textContent = "Downloading update…";
    }
    try {
      await handleGitHubUpdateApply(statusEl);
    } catch (e) {
      btn.disabled = false;
      if (statusEl) statusEl.textContent = e.message || "Update failed";
      alert(e.message || "Update failed");
    }
  });
}

async function fetchGitHubUpdateInfo() {
  if (window.hrDesktop?.checkGitHubUpdate) {
    try {
      const info = await window.hrDesktop.checkGitHubUpdate();
      if (info?.enabled !== false) return info;
    } catch (_) {
      /* fall through to API */
    }
  }
  try {
    const res = await fetch("/api/github-update");
    if (res.ok) return await res.json();
  } catch (_) {
    /* non-fatal */
  }
  return null;
}

async function checkForAppUpdate(notice = null) {
  try {
    const githubInfo = await fetchGitHubUpdateInfo();
    if (githubInfo?.enabled && githubInfo.updateAvailable) {
      showVersionUpdateNotice(notice, githubInfo);
      return;
    }
  } catch (_) {
    /* non-fatal */
  }
  if (notice?.message) showVersionUpdateNotice(notice);
}

async function checkDesktopGitHubUpdate(notice = null) {
  return checkForAppUpdate(notice);
}

function showVersionBlockedScreen(message, details) {
  const root = document.getElementById("app");
  if (!root) return;
  document.querySelector(".app-shell")?.classList.add("version-blocked-shell");
  const canAutoUpdate = Boolean(window.hrDesktop?.applyGitHubUpdate);
  root.innerHTML = `
    <div class="version-block-screen">
      <div class="card" style="max-width:560px;margin:3rem auto;text-align:center">
        <h2>App update required</h2>
        <div class="alert alert-warn">${escapeHtml(message || "This app version is no longer supported.")}</div>
        ${
          details
            ? `<p class="muted">Your version: <strong>${escapeHtml(details.appVersion || "unknown")}</strong><br>
               Required version: <strong>${escapeHtml(details.currentVersion || "unknown")}</strong></p>`
            : ""
        }
        <p class="muted">${canAutoUpdate ? "Install the update below or contact your Admin." : "Contact your Admin to install the latest version. The app cannot be used until then."}</p>
        <div id="version-block-status" class="muted" style="margin:.5rem 0"></div>
        <div style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">
          ${canAutoUpdate ? `<button class="btn btn-primary" id="version-block-update">Update now</button>` : ""}
          <button class="btn" id="version-block-logout">Return to sign in</button>
        </div>
      </div>
    </div>`;
  root.querySelector("#version-block-logout")?.addEventListener("click", () => performLogout());
  root.querySelector("#version-block-update")?.addEventListener("click", async () => {
    const btn = root.querySelector("#version-block-update");
    const statusEl = root.querySelector("#version-block-status");
    if (!btn) return;
    btn.disabled = true;
    if (statusEl) statusEl.textContent = "Downloading update…";
    try {
      await handleGitHubUpdateApply(statusEl);
    } catch (e) {
      btn.disabled = false;
      if (statusEl) statusEl.textContent = e.message || "Update failed";
    }
  });
}

function consumePendingVersionNotice() {
  try {
    const raw = sessionStorage.getItem("hr_pending_version_notice");
    if (!raw) {
      checkForAppUpdate();
      return;
    }
    sessionStorage.removeItem("hr_pending_version_notice");
    checkForAppUpdate(JSON.parse(raw));
  } catch (_) {
    checkForAppUpdate();
  }
}

function openModal(html, wide = false) {
  closeSidebarNav();
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop">
    <div class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true">${html}</div>
  </div>`;
  const backdrop = root.querySelector("#modal-backdrop");
  const modal = root.querySelector(".modal");
  backdrop.addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
  modal?.addEventListener("click", (e) => e.stopPropagation());
  modal?.addEventListener("mousedown", (e) => e.stopPropagation());
  root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
  root.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", (e) => e.preventDefault());
  });
  requestAnimationFrame(() => {
    const auto = modal?.querySelector("[autofocus], [data-autofocus]");
    const focusable = auto || modal?.querySelector(
      'input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]), select:not([disabled])'
    );
    focusable?.focus();
  });
}

function setUserInfo(username, role) {
  const el = document.getElementById("user-info");
  if (!el) return;
  const name = username || getSavedUsername() || "";
  el.textContent = name ? (role ? `${name} · ${role}` : name) : "";
}

async function updateSidebarBrand() {
  const wrap = document.getElementById("brand-logo-wrap");
  if (!wrap) return;
  const empId = state.user?.employeeId;
  if (!empId) {
    wrap.innerHTML = `<img src="/img/hr-team.png" alt="HR Team" class="brand-logo" />`;
    return;
  }
  try {
    const data = await api(`/employees/${empId}${apiContextQuery()}`);
    const emp = data.employee;
    if (emp?.profile_photo_file_id) {
      wrap.innerHTML = avatarHtml(emp, "brand-user-avatar");
      return;
    }
  } catch {
    /* fall back to default logo */
  }
  wrap.innerHTML = `<img src="/img/hr-team.png" alt="HR Team" class="brand-logo" />`;
}

function applyCompanyBranding() {
  const title = document.getElementById("brand-title");
  if (title) title.textContent = state.companyContext === "hs2" ? "Hangup HS-2" : "Hangup Portal";
  document.body.classList.toggle("company-hs2", state.companyContext === "hs2");
  const wrap = document.getElementById("company-toggle-wrap");
  if (!wrap) return;
  const ctx = state.companyContext === "hs2" ? "hs2" : "hangup";
  wrap.innerHTML = `<div class="company-switcher" role="group" aria-label="Company to manage">
    <span class="company-switcher-label">Managing</span>
    <button type="button" class="company-switch-btn ${ctx === "hangup" ? "active" : ""}" data-company="hangup">Main Hangup</button>
    <button type="button" class="company-switch-btn ${ctx === "hs2" ? "active" : ""}" data-company="hs2">HS-2</button>
  </div>`;
  wrap.querySelectorAll("[data-company]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.company;
      if (next === state.companyContext) return;
      state.companyContext = next;
      sessionStorage.setItem("companyContext", state.companyContext);
      applyCompanyBranding();
      render();
    });
  });
}

function openConfirmDeleteModal({ title, message, onConfirm }) {
  openModal(
    `<div class="modal-header"><h2>${escapeHtml(title || "Confirm deletion")}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      <p>${escapeHtml(message || "This action cannot be undone.")}</p>
      <label class="field"><input type="checkbox" id="confirm-del-check" /> I confirm this deletion</label>
    </div>
    <div class="modal-footer">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-danger" id="confirm-del-btn">Delete</button>
    </div>`,
    true
  );
  document.getElementById("confirm-del-btn").onclick = async () => {
    if (!document.getElementById("confirm-del-check")?.checked) {
      alert("Please check the confirmation box.");
      return;
    }
    closeModal();
    try {
      await onConfirm();
    } catch (e) {
      alert(e.message);
    }
  };
}

function openConfirmModal({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
  openModal(
    `<div class="modal-header"><h2>${escapeHtml(title || "Confirm")}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body"><p>${escapeHtml(message || "Are you sure?")}</p></div>
    <div class="modal-footer">
      <button class="btn" data-close>Cancel</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confirm-action-btn">${escapeHtml(confirmLabel)}</button>
    </div>`,
    true
  );
  document.getElementById("confirm-action-btn").onclick = async () => {
    closeModal();
    try {
      await onConfirm?.();
    } catch (e) {
      alert(e.message);
    }
  };
}

/** Styled handoff modal for newly approved registrations (replaces alert with copyable credentials). */
function showRegistrationCredentialsModal(res, note = "") {
  const copyRow = (label, value) => `
    <div class="cred-row">
      <div><span class="muted small">${escapeHtml(label)}</span><strong class="cred-value">${escapeHtml(value ?? "—")}</strong></div>
      <button type="button" class="btn btn-sm" data-copy-value="${escapeHtml(value ?? "")}">Copy</button>
    </div>`;
  openModal(
    `<div class="modal-header"><h2>Registration approved</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      <p class="muted" style="margin-top:0">Share these credentials with the new agent. The account stays <strong>inactive</strong> until Mark or Raymond activates it on the Users page.</p>
      <div class="cred-box">
        ${copyRow("User ID (login)", res.username)}
        ${copyRow("Temp password", res.tempPassword)}
        ${res.employeeId ? copyRow("Employee ID", res.employeeId) : ""}
      </div>
      ${note ? `<p class="muted small" style="margin-bottom:0">${escapeHtml(note)}</p>` : ""}
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" data-close>Done</button>
    </div>`
  );
  document.querySelectorAll("#modal-root [data-copy-value]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copyValue || "");
        const old = btn.textContent;
        btn.textContent = "Copied!";
        btn.classList.add("btn-success");
        setTimeout(() => {
          btn.textContent = old;
          btn.classList.remove("btn-success");
        }, 1400);
      } catch {
        /* clipboard unavailable */
      }
    });
  });
}

function openPromptModal({ title, message = "", defaultValue = "", inputType = "text", placeholder = "", confirmLabel = "OK", required = false, onSubmit }) {
  openModal(
    `<div class="modal-header"><h2>${escapeHtml(title || "Enter value")}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      ${message ? `<p class="muted">${escapeHtml(message)}</p>` : ""}
      <label class="field"><span>${escapeHtml(placeholder || "Value")}</span>
        <input id="prompt-modal-input" type="${inputType}" value="${escapeHtml(defaultValue)}" ${required ? "required" : ""} />
      </label>
    </div>
    <div class="modal-footer">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="prompt-modal-submit">${escapeHtml(confirmLabel)}</button>
    </div>`,
    true
  );
  const input = document.getElementById("prompt-modal-input");
  input?.focus();
  if (defaultValue) input?.select();
  const submit = async () => {
    const val = String(input?.value || "").trim();
    if (required && !val) {
      alert("This field is required.");
      return;
    }
    closeModal();
    try {
      await onSubmit?.(val);
    } catch (e) {
      alert(e.message);
    }
  };
  document.getElementById("prompt-modal-submit").onclick = submit;
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
}

window.openConfirmModal = openConfirmModal;
window.openPromptModal = openPromptModal;

function openDeferAmountModal({ title, message, defaultMonth, defaultAmount, maxAmount, onSubmit }) {
  openModal(
    `<div class="modal-header"><h2>${escapeHtml(title || "Defer payment")}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body field-grid">
      ${message ? `<p class="muted" style="grid-column:1/-1">${escapeHtml(message)}</p>` : ""}
      <label class="field"><span>Amount to defer (EGP)</span>
        <input id="defer-amount-input" type="number" step="0.01" min="0.01" max="${maxAmount || ""}" value="${defaultAmount || ""}" required />
      </label>
      <label class="field"><span>Defer to month</span>
        <input id="defer-month-input" type="month" value="${escapeHtml(defaultMonth || "")}" required />
      </label>
    </div>
    <div class="modal-footer">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="defer-amount-submit">Defer</button>
    </div>`,
    true
  );
  const amountInput = document.getElementById("defer-amount-input");
  const monthInput = document.getElementById("defer-month-input");
  amountInput?.focus();
  document.getElementById("defer-amount-submit").onclick = async () => {
    const amount = Number(amountInput?.value);
    const deferToMonth = String(monthInput?.value || "").trim();
    if (!(amount > 0)) return alert("Enter an amount greater than 0");
    if (maxAmount && amount > maxAmount + 0.01) {
      return alert(`Cannot defer more than ${fmt(maxAmount)} EGP`);
    }
    if (!/^\d{4}-\d{2}$/.test(deferToMonth)) return alert("Choose a valid month");
    closeModal();
    try {
      await onSubmit?.({ amount, deferToMonth });
    } catch (e) {
      alert(e.message);
    }
  };
}

window.openDeferAmountModal = openDeferAmountModal;

// Full audit logs are restricted to Admin + CEO roles.
function isChangesViewer() {
  return ["admin", "ceo"].includes(state.user?.role);
}

function isUserManager() {
  return state.user?.canManageUsers === true;
}

function applyChangesButtonVisibility() {
  const btn = document.getElementById("nav-changes");
  if (btn) btn.classList.toggle("hidden", !isChangesViewer());
  const usersBtn = document.getElementById("nav-users");
  if (usersBtn) usersBtn.classList.toggle("hidden", !isUserManager());
  const accessBtn = document.getElementById("nav-access-control");
  if (accessBtn) accessBtn.classList.toggle("hidden", state.user?.canManageAccessControl !== true);
  const salesPermsBtn = document.getElementById("nav-sales-permissions");
  const salesColsBtn = document.getElementById("nav-sales-log-columns");
  const showSalesAdmin =
    state.user?.canViewSalesAdmin === true || state.user?.canManageSalesFieldPermissions === true;
  if (salesPermsBtn) salesPermsBtn.classList.toggle("hidden", !showSalesAdmin);
  if (salesColsBtn) salesColsBtn.classList.toggle("hidden", !showSalesAdmin);
  const payrollPages = ["payroll", "loans", "salaries"];
  const showPayroll = state.user?.canViewPayroll === true || ["admin", "ceo", "hr", "finance"].includes(state.user?.role);
  payrollPages.forEach((page) => {
    document.querySelector(`.nav-btn[data-page="${page}"]`)?.classList.toggle("hidden", !showPayroll);
  });
  const bonusPages = ["bonuses", "deductions"];
  const showBonuses = canViewBonusesDeductions();
  bonusPages.forEach((page) => {
    document.querySelector(`.nav-btn[data-page="${page}"]`)?.classList.toggle("hidden", !showBonuses);
  });
  const salesBtn = document.getElementById("nav-sales");
  const teamDashBtn = document.getElementById("nav-team-dashboard");
  const showSales = state.user?.canViewSales !== false || canViewBonusesDeductions();
  if (salesBtn) salesBtn.classList.toggle("hidden", !showSales);
  if (teamDashBtn) teamDashBtn.classList.toggle("hidden", !showSales);
  const costsBtn = document.getElementById("nav-costs");
  if (costsBtn) {
    const showCosts = state.user?.canAccessCosts === true || state.user?.canSubmitExpense === true;
    costsBtn.classList.toggle("hidden", !showCosts);
  }
  const loanApprovalsBtn = document.getElementById("nav-loan-approvals");
  if (loanApprovalsBtn) {
    const showLoanApprovals =
      state.user?.canApproveLoan === true &&
      !["agent", "office_assistant", "tl"].includes(state.user?.role);
    loanApprovalsBtn.classList.toggle("hidden", !showLoanApprovals);
  }
  const equipmentBtn = document.getElementById("nav-equipment");
  if (equipmentBtn) {
    equipmentBtn.classList.toggle("hidden", !canViewEquipmentNav());
  }
  const reportsBtn = document.querySelector('.nav-btn[data-page="reports"]');
  if (reportsBtn) reportsBtn.classList.toggle("hidden", !canViewReports());
  const payslipBtn = document.getElementById("nav-payslip");
  if (payslipBtn) {
    payslipBtn.classList.toggle("hidden", state.user?.canViewAgentPayslipNav !== true);
  }
  const active = ensureNavPageAllowed(state.page || "dashboard");
  if (active !== state.page) {
    state.page = active;
    syncNavActiveState(active);
  } else {
    syncNavActiveState(active);
  }
}

async function refreshStatus() {
  setUserInfo(state.user?.username);
  applyCompanyBranding();
  try {
    const s = await api("/status");
    state.user = s.user || null;
    state.impersonation = s.impersonation || null;
    state.hideOut = s.hideOutEmployees !== false;
    setUserInfo(s.user?.username, s.user?.role);
    applyImpersonationBanner();
    applyChangesButtonVisibility();
    document.getElementById("sync-badge").textContent = "Synced";
    document.getElementById("sync-badge").className = "badge badge-online";
    document.getElementById("last-sync").textContent = s.lastSync
      ? `Last sync: ${timeAgo(s.lastSync)}`
      : "";
    await updateSidebarBrand();
  } catch {
    document.getElementById("sync-badge").textContent = "Offline";
    document.getElementById("sync-badge").className = "badge badge-offline";
  }
}

function applyImpersonationBanner() {
  const banner = document.getElementById("impersonation-banner");
  if (!banner) return;
  const imp = state.impersonation;
  if (imp?.active && imp.as) {
    banner.classList.remove("hidden");
    banner.innerHTML = `<strong>Viewing as ${escapeHtml(imp.as)}</strong>
      <span class="muted">(signed in as ${escapeHtml(imp.realUsername || "raymond")}) — actions use this user's permissions</span>
      <button type="button" class="btn btn-sm btn-ghost" id="impersonation-stop-btn">Exit view</button>`;
    banner.querySelector("#impersonation-stop-btn")?.addEventListener("click", async () => {
      try {
        await api("/impersonate/stop", { method: "POST", body: "{}" });
        await refreshStatus();
        await render();
      } catch (e) {
        alert(e.message);
      }
    });
  } else {
    banner.classList.add("hidden");
    banner.innerHTML = "";
  }
}

function monthToolbar(extra = "") {
  return `<div class="toolbar">
    <button class="btn" id="prev-month">←</button>
    <strong>${monthLabel(state.month)}</strong>
    <button class="btn" id="next-month">→</button>
    <input type="month" id="month-input" value="${state.month}" />
    ${extra}
  </div>`;
}

function bindMonthNav(root) {
  root.querySelector("#prev-month")?.addEventListener("click", () => {
    state.month = shiftMonth(state.month, -1);
    render();
  });
  root.querySelector("#next-month")?.addEventListener("click", () => {
    state.month = shiftMonth(state.month, 1);
    render();
  });
  root.querySelector("#month-input")?.addEventListener("change", (e) => {
    state.month = e.target.value;
    render();
  });
}

function hideOutToggle() {
  return `<label class="toggle-label"><input type="checkbox" id="hide-out" ${state.hideOut ? "checked" : ""} /> Hide out / inactive</label>`;
}

function bindHideOut(root) {
  root.querySelector("#hide-out")?.addEventListener("change", (e) => {
    state.hideOut = e.target.checked;
    if (canManagePayrollEvents()) {
      api(`/settings/hide-out`, {
        method: "PUT",
        body: JSON.stringify({ hide: state.hideOut }),
      }).catch(() => {});
    }
    render();
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeSearchQuery(q) {
  return String(q || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function employeeSearchHaystack(emp) {
  return [
    emp?.id,
    emp?.employeeId,
    emp?.internal_id,
    emp?.american_name,
    emp?.arabic_name,
    emp?.arabicName,
    emp?.name,
    emp?.team,
    emp?.unit,
    emp?.position,
    emp?.email,
    emp?.phone,
    emp?.paymentMethod,
    emp?.payrollStatus,
  ]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
}

function matchesEmployeeSearch(emp, q) {
  const needle = normalizeSearchQuery(q);
  if (!needle) return true;
  const hay = employeeSearchHaystack(emp);
  const hayLower = hay.toLowerCase();
  const tokens = needle.split(" ").filter(Boolean);
  return tokens.every((tok) => hayLower.includes(tok) || hay.includes(tok));
}

function getTabSearch(tabKey) {
  return state.tabSearch[tabKey] || "";
}

function pageSearchInputHtml(tabKey, placeholder = "Search name or ID…") {
  const q = getTabSearch(tabKey);
  return `<label class="field field-inline field-search"><span>Search</span><input class="search-input" id="search-${tabKey}" type="search" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(q)}" autocomplete="off" spellcheck="false" /></label>`;
}

function bindTabSearch(root, tabKey, onFilter, debounceMs = 0) {
  const input = root.querySelector(`#search-${tabKey}`);
  if (!input) return;
  let rafId = 0;
  let debounceTimer = 0;
  const runFilter = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      onFilter();
    });
  };
  const apply = () => {
    state.tabSearch[tabKey] = input.value;
    if (debounceMs > 0) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runFilter, debounceMs);
      return;
    }
    runFilter();
  };
  input.addEventListener("input", apply);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      state.tabSearch[tabKey] = "";
      apply();
    }
  });
}

function filterEmployeesList(employees) {
  let list = employees;
  if (state.hideOut) {
    list = list.filter((e) => !isOutEmployee(e) || isUnassignedIdStub(e));
  }
  if (getTabSearch("employees")) list = list.filter((e) => matchesEmployeeSearch(e, getTabSearch("employees")));
  if (state.empFilter.status) list = list.filter((e) => e.status === state.empFilter.status);
  if (state.empFilter.unit) list = list.filter((e) => e.unit === state.empFilter.unit);
  if (state.empFilter.nationality) {
    const want = normNationality(state.empFilter.nationality);
    list = list.filter((e) => normNationality(e.nationality) === want);
  }
  if (state.empFilter.workPermit) {
    list = list.filter((e) => e.work_permit === state.empFilter.workPermit);
  }
  if (state.empFilter.insuranceStatus) {
    list = list.filter((e) => e.insurance_status === state.empFilter.insuranceStatus);
  }
  return list;
}

function employeeListRowHtml(e) {
  const stub = isUnassignedIdStub(e);
  const name = stub ? `(Unassigned ID)` : (e.american_name || e.arabic_name || e.id);
  const appId = e.archived_app_id && String(e.id || "").startsWith("DEL-") ? e.archived_app_id : e.id;
  const dbIdHtml =
    canViewEmployeeInternalId() && e.internal_id
      ? `<div class="muted" style="font-size:.7rem" title="Database ID">${String(e.internal_id).slice(0, 8)}…</div>`
      : "";
  const isSelf = state.user?.employeeId === e.id;
  const canEdit = canManagePayrollEvents();
  const showNotes = canViewEmployeeNotes();
  const showQualityNotes = canViewQualityNotes() || canWriteQualityNotes();
  const showDocs = canEdit || isSelf;
  const showNat = canViewEmployeeNationality() || isSelf;
  const showCompliance = canViewEmployeeCompliance() || isSelf;
  const actions = [
    stub ? `<button class="btn btn-sm btn-danger" data-release="${e.id}">Release ID</button>` : "",
    showDocs ? `<button class="btn btn-sm" data-docs="${e.id}">${isSelf && !canEdit ? "My docs" : "Docs"}</button>` : "",
    showNotes ? `<button class="btn btn-sm" data-warn="${e.id}">HR notes${e.hasWarnings ? " •" : ""}</button>` : "",
    showQualityNotes ? `<button class="btn btn-sm" data-quality-notes="${e.id}">Quality notes</button>` : "",
    canEdit ? `<button class="btn btn-sm" data-edit="${e.id}">Edit</button>` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const rowClass = canEdit || (state.user?.role === "tl" || state.user?.role === "op") ? "clickable" : "";
  return `<tr class="${rowClass}${stub ? " row-stub" : ""}" data-emp="${e.id}">
    <td><div class="emp-cell">${avatarHtml(e)}<strong>${name}</strong>${stub ? '<span class="stub-badge">No user assigned</span>' : ""}</div></td>
    <td><code>${appId}</code>${dbIdHtml}</td>
    <td>${e.unit || "—"}</td><td>${e.team || "—"}</td>
    <td>${e.position || "—"}</td>
    ${showNat ? `<td>${e.nationality || "—"}</td>` : ""}
    ${showCompliance ? `<td>${employeeComplianceLabel(e)}</td>` : ""}
    <td>${statusBadge(e.status)}</td>
    <td>${actions}</td>
  </tr>`;
}

function bindEmployeesTableActions(root, allEmployees) {
  root.querySelectorAll("[data-edit]").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      openEmployeeModal(allEmployees.find((x) => x.id === b.dataset.edit));
    };
  });
  root.querySelectorAll("[data-warn]").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      openEmployeeWarningsModal(b.dataset.warn);
    };
  });
  root.querySelectorAll("[data-quality-notes]").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      openEmployeeQualityNotesModal(b.dataset.qualityNotes);
    };
  });
  root.querySelectorAll("[data-docs]").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      openEmployeeDocsModal(b.dataset.docs);
    };
  });
  root.querySelectorAll("[data-release]").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const id = b.dataset.release;
      openConfirmDeleteModal({
        title: "Release app ID",
        message: `Release ${id}? The ID can be assigned to someone new; history stays in the database.`,
        onConfirm: async () => {
          b.disabled = true;
          const prev = b.textContent;
          b.textContent = "Releasing…";
          try {
            const res = await api(`/employees/${encodeURIComponent(id)}/release-app-id`, { method: "POST" });
            if (res.employees) replaceEmployeesInCache(res.employees);
            showSaveIndicator("App ID released", "saved");
            render();
          } catch (e) {
            alert(e.message || "Release failed");
          } finally {
            b.disabled = false;
            b.textContent = prev;
          }
        },
      });
    };
  });
  root.querySelectorAll("tr[data-emp]").forEach((tr) => {
    if (!canManagePayrollEvents()) return;
    tr.onclick = () =>
      openEmployeeModal(allEmployees.find((x) => x.id === tr.dataset.emp));
  });
}

function updateEmployeesTable(root) {
  const data = root.__employeesData;
  if (!data) return;
  const list = filterEmployeesList(data.employees);
  const tbody = root.querySelector("#emp-tbody");
  const countEl = root.querySelector("#emp-count");
  if (tbody) {
    tbody.innerHTML = list.length
      ? list.map(employeeListRowHtml).join("")
      : `<tr><td colspan="${root.__empColSpan || 7}" class="muted">No employees match your search</td></tr>`;
  }
  if (countEl) countEl.textContent = `${list.length} shown`;
  bindEmployeesTableActions(root, data.employees);
}

function patchEmployeeInCache(employee) {
  if (!employee?.id) return;
  const root = document.getElementById("app");
  if (root?.__employeesData?.employees) {
    const list = root.__employeesData.employees;
    const idx = list.findIndex((e) => e.id === employee.id);
    if (idx >= 0) list[idx] = employee;
    else list.push(employee);
    if (state.page === "employees") updateEmployeesTable(root);
  }
  if (state.meta?.employees) {
    const idx = state.meta.employees.findIndex((e) => e.id === employee.id);
    if (idx >= 0) state.meta.employees[idx] = employee;
    else state.meta.employees.push(employee);
  }
}

function replaceEmployeesInCache(employees) {
  if (!Array.isArray(employees)) return;
  const root = document.getElementById("app");
  if (root?.__employeesData) root.__employeesData.employees = employees;
  if (state.meta) state.meta.employees = employees;
  if (state.page === "employees" && root) updateEmployeesTable(root);
}

async function refreshPayrollRowAfterSave(employeeId) {
  const root = document.getElementById("app");
  if (state.page !== "payroll" || !root?.__payrollData) return;
  try {
    const row = await api(`/payroll/${employeeId}?month=${state.month}`);
    const p = row.payslip;
    if (!p) return;
    const idx = root.__payrollData.payroll.findIndex((r) => r.employeeId === employeeId);
    const merged = { ...p, employeeId, id: employeeId };
    if (idx >= 0) root.__payrollData.payroll[idx] = { ...root.__payrollData.payroll[idx], ...merged };
    else root.__payrollData.payroll.push(merged);
    updatePayrollTable(root);
  } catch {
    /* payroll page will refresh on next visit */
  }
}

function attendanceEmployeeRowHtml(emp, ctx) {
  const { days, statuses, canEdit, recordMap, summaryMap, data } = ctx;
  window.__attendanceStatuses = statuses;
  const s = summaryMap.get(emp.id) || {};
  const editable = canEdit && canEditAttendance();
  return `<tr data-emp-row="${emp.id}">
    <td class="att-sticky att-sticky-id">${emp.id}</td>
    <td class="att-sticky att-sticky-name" title="${emp.position || ""}"><div class="emp-cell emp-cell-compact">${avatarHtml({ id: emp.id, american_name: emp.american_name || emp.name, profile_photo_file_id: emp.profile_photo_file_id, profile_photo_updated: emp.profile_photo_updated })}<span>${emp.name}</span></div></td>
    <td class="att-sticky att-sticky-team">${emp.team || "—"}</td>
    <td class="text-center">${s.workingDays || 0}</td>
    <td class="text-center">${s.lateness || 0}</td>
    <td class="text-center">${s.latenessDeductions || 0}</td>
    ${days.map((d) => {
      const rec = recordMap.get(`${emp.id}|${d}`);
      const st = rec?.status || "";
      const depart = String(emp.depart_date || "").slice(0, 10);
      const locked = depart && d > depart;
      const dayCls =
        window.HRMSFeatures?.attendanceDayClass(d, data) || (isWeekend(d) ? "weekend-col" : "");
      const holidayName = window.HRMSFeatures?.attendanceDayHolidayName(d, data) || "";
      const dayTitle = holidayName ? (window.HRMSFeatures?.attendanceDayTitle(d, data) || holidayName) : "";
      const holidayNote = holidayName
        ? `<div class="att-holiday-cell-note" title="${escapeHtml(dayTitle)}">${escapeHtml(holidayName)}</div>`
        : "";
      const lockNote = locked ? `<div class="att-lock-note" title="After depart date">🔒</div>` : "";
      const displaySt = locked ? "OUT" : st;
      return `<td class="att-cell ${dayCls}${locked ? " att-locked" : ""}"${dayTitle ? ` title="${escapeHtml(dayTitle)}"` : ""}>
        ${holidayNote}${lockNote}
        ${attendanceStatusCellHtml(emp.id, d, displaySt, rec, editable, locked)}
      </td>`;
    }).join("")}
  </tr>`;
}

function bindAttendanceGridEvents(root, ctx) {
  const { canEdit } = ctx;
  if (!canEdit || !canEditAttendance()) return;

  function onTransportOverrideChange(e) {
    const el = e.target;
    const status =
      el.closest(".att-cell")?.querySelector(".status-select")?.value || "";
    queueAttendanceSave(el.dataset.emp, el.dataset.date, status, el.value);
  }

  root.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const el = e.target;
      el.className = `status-select ${statusClass(el.value)}`;
      const cell = el.closest(".att-cell");
      const ovSel = cell?.querySelector(".transport-ov-select");
      if (ovSel) {
        if (isTransportOverrideStatus(el.value)) {
          ovSel.classList.remove("hidden");
        } else {
          ovSel.classList.add("hidden");
          ovSel.value = "";
        }
      } else if (isTransportOverrideStatus(el.value) && cell && canEdit) {
        cell.insertAdjacentHTML(
          "beforeend",
          transportOverrideHtml(el.dataset.emp, el.dataset.date, el.value, "", true)
        );
        const newOv = cell.querySelector(".transport-ov-select");
        newOv?.addEventListener("change", onTransportOverrideChange);
      }
      const ov = cell?.querySelector(".transport-ov-select")?.value || "";
      queueAttendanceSave(el.dataset.emp, el.dataset.date, el.value, ov);
    });
  });

  root.querySelectorAll(".transport-ov-select").forEach((sel) => {
    sel.addEventListener("change", onTransportOverrideChange);
  });
}

function updateAttendanceTable(root) {
  const ctx = root.__attendanceCtx;
  if (!ctx) return;
  let employees = ctx.data.employees;
  if (state.hideOut) {
    employees = employees.filter((e) => !isOutEmployee(e));
  }
  if (getTabSearch("attendance")) {
    employees = employees.filter((e) => matchesEmployeeSearch(e, getTabSearch("attendance")));
  }
  const tbody = root.querySelector("#att-tbody");
  const countEl = root.querySelector("#att-emp-count");
  if (tbody) {
    tbody.innerHTML = employees.length
      ? employees.map((emp) => attendanceEmployeeRowHtml(emp, ctx)).join("")
      : `<tr><td colspan="99" class="muted">No employees match your search</td></tr>`;
  }
  if (countEl) countEl.textContent = `${employees.length} employees · ${monthLabel(state.month)}`;
  bindAttendanceGridEvents(root, ctx);
}

function payrollRowHtml(r) {
  const dualBadge =
    r.payrollKind === "dual"
      ? `<span class="badge badge-ok" style="font-size:.65rem;margin-left:.25rem">Training + Agent</span>`
      : r.payrollKind === "training"
        ? `<span class="badge" style="font-size:.65rem;margin-left:.25rem">Training</span>`
        : "";
  return `<tr class="clickable" data-pay="${r.employeeId}">
    <td><div class="emp-cell">${avatarHtml({ id: r.employeeId, american_name: r.name, profile_photo_file_id: r.profile_photo_file_id, profile_photo_updated: r.profile_photo_updated })}<div><strong>${r.name}</strong>${dualBadge}<div class="muted">${r.employeeId} · ${r.unit || "—"}</div></div></div></td>
    <td>${payrollStatusBadge(r.payrollStatus)}</td>
    <td class="text-center">${r.salesCount || (r.agent?.salesCount) || "—"}</td>
    <td class="text-right">${r.commissionAmount || r.agent?.commissionAmount ? fmt(r.commissionAmount || r.agent?.commissionAmount) : "—"}</td>
    <td><span class="badge badge-status">${r.paymentMethod || "—"}</span></td>
    <td class="text-center">${r.totalWorkingDays || (r.training?.totalWorkingDays || 0) + (r.agent?.totalWorkingDays || 0)}</td>
    <td class="text-right">${fmt(payrollRowBasic(r))}</td>
    <td class="text-right amount-pos">${fmt((r.transportAllowance || 0) + (r.agent?.transportAllowance || 0))}</td>
    <td class="text-right amount-neg">${r.loanDeductionTotal ? `-${fmt(r.loanDeductionTotal)}` : "—"}</td>
    <td class="text-right"><strong>${fmt(payrollRowNet(r))}</strong>${r.hasSplits ? `<div class="muted" style="font-size:.7rem">calc ${fmt(r.calculatedNet)}</div>` : ""}${r.receivedTotal ? `<div class="muted" style="font-size:.7rem">paid ${fmt(r.receivedTotal)}</div>` : ""}</td>
    <td><button class="btn btn-sm" data-slip="${r.employeeId}">Payslip</button></td>
  </tr>`;
}

function bindPayrollRowClicks(root) {
  root.querySelectorAll("[data-slip], tr[data-pay]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") e.stopPropagation();
      openPayslipModal(el.dataset.slip || el.dataset.pay);
    });
  });
}

function updatePayrollTable(root) {
  const data = root.__payrollData;
  if (!data) return;
  let rows = data.payroll;
  rows = filterPayrollByZeroNet(rows);
  if (getTabSearch("payroll")) {
    rows = rows.filter((r) => matchesEmployeeSearch(r, getTabSearch("payroll")));
  }
  const tbody = root.querySelector("#payroll-tbody");
  const countEl = root.querySelector("#payroll-emp-count");
  if (tbody) {
    tbody.innerHTML = rows.length
      ? rows.map(payrollRowHtml).join("")
      : `<tr><td colspan="11" class="muted">No employees match your search</td></tr>`;
  }
  if (countEl) {
    countEl.textContent = `${rows.length} employees · ${monthLabel(state.month)} · ${data.workingDays} working days · Transport 3,000 EGP/mo`;
  }
  bindPayrollRowClicks(root);
}

function transportOverrideHtml(empId, date, status, currentOverride, canEdit) {
  if (!canViewTransportControls()) return "";
  if (!isTransportOverrideStatus(status)) return "";
  const dis = canEdit ? "" : "disabled";
  const ov = currentOverride || "";
  return `<select class="transport-ov-select" data-emp="${empId}" data-date="${date}" ${dis} title="Transport allowance for this day">
    <option value="" ${!ov ? "selected" : ""}>No transport</option>
    <option value="full" ${ov === "full" ? "selected" : ""}>Full transport</option>
    <option value="half" ${ov === "half" ? "selected" : ""}>Half transport</option>
  </select>`;
}

function attendanceStatusCellHtml(empId, d, displaySt, rec, canEdit, locked) {
  if (!canEdit || locked) {
    const label = displaySt || "—";
    const transport =
      canViewTransportControls() && rec?.transportOverride
        ? `<div class="muted" style="font-size:.65rem">${rec.transportOverride === "half" ? "½ transport" : rec.transportOverride === "full" ? "Full transport" : "No transport"}</div>`
        : "";
    return `<span class="badge ${statusClass(displaySt)}">${escapeHtml(label)}</span>${transport}`;
  }
  const statuses = window.__attendanceStatuses || [];
  return `<select class="status-select ${statusClass(displaySt)}" data-emp="${empId}" data-date="${d}">
        <option value="">—</option>
        ${statuses.map((x) => `<option value="${x}" ${displaySt === x ? "selected" : ""}>${x === "Day-OFF" && isWeekend(d) ? "OFF★" : x}</option>`).join("")}
      </select>
      ${transportOverrideHtml(empId, d, displaySt, rec?.transportOverride, true)}`;
}

function queueAttendanceSave(employeeId, date, status, transportOverride) {
  const key = `${employeeId}|${date}`;
  const prev = state.pendingAttendance.get(key);
  let to = transportOverride;
  if (to === undefined) to = prev?.transportOverride;
  if (!isTransportOverrideStatus(status)) to = "";
  state.pendingAttendance.set(key, {
    employeeId,
    date,
    status,
    transportOverride: to || "",
    isWeekendDefault: isWeekend(date) && status === "Day-OFF",
  });
  showSaveIndicator("Saving…", "info");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushAttendanceSaves, 500);
}

async function flushAttendanceSaves() {
  const records = [...state.pendingAttendance.values()];
  if (!records.length) return;
  state.pendingAttendance.clear();
  try {
    await api("/attendance/batch", {
      method: "POST",
      body: JSON.stringify({ records }),
    });
    showSaveIndicator("Saved", "saved");
  } catch (e) {
    showSaveIndicator(e.message, "error");
  }
}

async function renderDashboard(root) {
  const month = state.month;
  const salesPromise =
    state.user?.canViewSales !== false
      ? api(`/sales/dashboard?period=month&date=${month}-01&groupBy=team${state.companyContext === "hs2" ? "&company=hs2" : ""}`, {}, 10000).catch(() => null)
      : Promise.resolve(null);
  const [empData, payData, salesDash] = await Promise.all([
    api(`/employees${apiContextQuery()}`),
    api(`/payroll?${buildApiQuery({ month })}`).catch(() => null),
    salesPromise,
  ]);
  state.meta = empData;

  const salesStats = salesDash
    ? `<div class="card" style="margin-top:1rem"><h3>Sales this month</h3>
        <p><strong>${salesDash.totals?.passed ?? 0}</strong> passed ·
        <strong>${salesDash.totals?.pending ?? 0}</strong> pending ·
        <strong>${salesDash.totals?.callback ?? 0}</strong> callback ·
        <strong>${salesDash.totals?.denied ?? 0}</strong> denied
        <button class="btn btn-sm" data-go="sales" style="margin-left:.5rem">View sales</button></p></div>`
    : "";

  const showFullDash = state.user?.canViewDashboardFull !== false;
  const showPayrollStat = state.user?.canViewDashboardPayroll === true;
  const activeCount = empData.employees.filter((e) => e.status === "Active").length;

  root.innerHTML = `
    <div class="page-header"><div><h1>Dashboard</h1><p class="muted">${monthLabel(state.month)}</p></div></div>
    <div class="grid-4">
      ${showFullDash ? `<div class="card card-stat"><strong>${empData.employees.length}</strong><span class="muted">Employees</span></div>
      <div class="card card-stat"><strong>${activeCount}</strong><span class="muted">Active</span></div>
      <div class="card card-stat"><strong>${empData.units.length}</strong><span class="muted">Units</span></div>` : ""}
      ${showPayrollStat ? `<div class="card card-stat"><strong>${payData ? fmt(payData.totals.totalNet) : "—"}</strong><span class="muted">Net payroll (EGP)</span></div>` : ""}
    </div>
    ${salesStats}
    <div class="grid-2">
      <div class="card">
        <h3>Quick actions</h3>
        <div class="quick-actions">
          ${canManagePayrollEvents() ? '<button class="btn btn-primary" data-go="employees">Manage employees</button>' : ""}
          ${state.user?.canEditAttendance ? '<button class="btn" data-go="attendance">Edit attendance</button>' : ""}
          ${showPayrollStat ? '<button class="btn" data-go="payroll">View payroll</button>' : ""}
          ${state.user?.canViewAgentPayslipNav ? '<button class="btn" data-go="payslip">My payslip</button>' : ""}
        </div>
      </div>
      ${showFullDash ? `<div class="card"><h3>Units</h3><p class="muted">${empData.units.join(" · ") || "—"}</p></div>` : ""}
    </div>`;
  root.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => navigate(b.dataset.go))
  );
  window.HRMSFeatures?.enhanceDashboard(root, api).catch(() => {});
}

function openAddAgentWizard() {
  let step = 1;
  let wizard = { unit: "", team: "", backendPool: "NW", suggestedId: "", inTraining: false, phase1Start: "" };

  function defaultPhase1Monday() {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 1 : day === 6 ? 2 : day === 5 ? 3 : 8 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  async function renderWizard() {
    await ensureOrgTeams(api);

    if (step === 1) {
      openModal(`
        <div class="modal-header"><h2>Add agent — Step 1</h2><button class="btn btn-sm" data-close>✕</button></div>
        <div class="modal-body">
          <label class="field"><span>Unit *</span>
            <select id="wiz-unit"><option value="">Select unit…</option>
              ${state.meta.units.map((u) => `<option value="${u}" ${wizard.unit === u ? "selected" : ""}>${u}</option>`).join("")}
            </select>
          </label>
          <label class="field"><span>Team *</span>
            <select id="wiz-team" required>
              <option value="">Select team…</option>
              ${renderWizardTeamOptions(wizard.unit, wizard.team)}
            </select>
          </label>
          <label class="field ${wizard.unit === "HS-Back-End" ? "" : "hidden"}" id="wiz-pool-wrap"><span>ID pool (Back-End)</span>
            <select id="wiz-pool">${(state.meta.backendPools || ["NW", "HR", "MG", "OF"]).map((p) =>
              `<option value="${p}">${p}</option>`
            ).join("")}</select>
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn" data-close>Cancel</button>
          <button class="btn btn-primary" id="wiz-next">Next →</button>
        </div>`);

      const unitSel = document.getElementById("wiz-unit");
      const teamSel = document.getElementById("wiz-team");
      unitSel.onchange = () => {
        wizard.unit = unitSel.value;
        wizard.team = "";
        document.getElementById("wiz-pool-wrap")?.classList.toggle("hidden", wizard.unit !== "HS-Back-End");
        teamSel.innerHTML = `<option value="">Select team…</option>${renderWizardTeamOptions(wizard.unit)}`;
      };

      document.getElementById("wiz-next").onclick = async () => {
        wizard.unit = unitSel.value;
        wizard.team = document.getElementById("wiz-team").value;
        wizard.backendPool = document.getElementById("wiz-pool")?.value || "NW";
        if (!wizard.unit || !wizard.team) {
          alert("Unit and team are required");
          return;
        }
        const poolQ = wizard.unit === "HS-Back-End" ? `&backendPool=${wizard.backendPool}` : "";
        const { suggestedId } = await api(
          `/employees/next-id?unit=${encodeURIComponent(wizard.unit)}${poolQ}`
        );
        wizard.suggestedId = suggestedId;
        step = 2;
        renderWizard();
      };
    } else {
      openModal(`
        <div class="modal-header"><h2>Add agent — Step 2</h2><button class="btn btn-sm" data-close>✕</button></div>
        <div class="modal-body">
          <p class="muted">${wizard.unit} · ${wizard.team}</p>
          <form id="wiz-form" class="field-grid">
            <label class="field"><span>Employee ID</span><input name="id" value="${wizard.suggestedId}" required /></label>
            <label class="field"><span>American Name</span><input name="american_name" required /></label>
            <label class="field"><span>Arabic Name</span><input name="arabic_name" /></label>
            <label class="field"><span>Position</span><select name="position"><option value="">—</option>
              ${[...new Set([...(state.meta.positionRates || []), ...(state.meta.positions || [])])].map((p) => `<option value="${p}">${p}</option>`).join("")}
            </select></label>
            ${paymentMethodFieldsHtml()}
            <label class="field"><span>Phone</span><input name="phone" /></label>
            <label class="field"><span>Email</span><input name="email" type="email" /></label>
            <label class="field"><span>Employment date</span><input name="employment_date" type="date" id="wiz-employment-date" value="${new Date().toISOString().slice(0, 10)}" /></label>
            <label class="toggle-label" style="grid-column:1/-1"><input type="checkbox" id="wiz-in-training" ${wizard.inTraining ? "checked" : ""} /> In training program (4 weekly phases, Mon–Fri)</label>
            <label class="field wiz-training-field ${wizard.inTraining ? "" : "hidden"}" id="wiz-phase1-wrap"><span>Phase 1 week starts (Monday)</span>
              <input type="date" id="wiz-phase1-start" value="${wizard.phase1Start || defaultPhase1Monday()}" />
              <span class="muted" style="font-size:.8rem">Phases 2–4 auto-fill as following work weeks. Edit later if agent pauses.</span>
            </label>
            ${nationalityFormFieldsHtml()}
            <input type="hidden" name="unit" value="${wizard.unit}" />
            <input type="hidden" name="team" value="${wizard.team}" />
            <input type="hidden" name="status" value="Active" />
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn" id="wiz-back">← Back</button>
          <button class="btn btn-primary" id="wiz-create">Create agent</button>
        </div>`);

      document.getElementById("wiz-back").onclick = () => {
        step = 1;
        renderWizard();
      };
      bindPaymentMethodFields();
      bindNationalityFormFields();
      const inTrainingBox = document.getElementById("wiz-in-training");
      const phase1Wrap = document.getElementById("wiz-phase1-wrap");
      inTrainingBox?.addEventListener("change", () => {
        wizard.inTraining = inTrainingBox.checked;
        phase1Wrap?.classList.toggle("hidden", !wizard.inTraining);
      });
      document.getElementById("wiz-create").onclick = async () => {
        const btn = document.getElementById("wiz-create");
        const form = document.getElementById("wiz-form");
        const body = Object.fromEntries(new FormData(form));
        if (body.nationality === "__other__") {
          body.nationality = form.querySelector("#emp-nationality-other")?.value?.trim() || "";
        }
        if (!body.employment_date) body.employment_date = new Date().toISOString().slice(0, 10);
        if (inTrainingBox?.checked) {
          body.inTraining = true;
          body.phase1Start = document.getElementById("wiz-phase1-start")?.value || defaultPhase1Monday();
        }
        btn.disabled = true;
        try {
          const res = await api("/employees", { method: "POST", body: JSON.stringify(body) });
          try {
            await api("/attendance/init-month", {
              method: "PATCH",
              body: JSON.stringify({ month: state.month, employeeId: res.employee?.id }),
            });
          } catch {
            /* optional */
          }
          closeModal();
          if (res.employee) patchEmployeeInCache(res.employee);
          showSaveIndicator("Agent created", "saved");
        } catch (e) {
          alert(e.message);
        } finally {
          btn.disabled = false;
        }
      };
    }
  }
  renderWizard();
}

function isEgyptianNationality(nationality) {
  const n = String(nationality || "").trim().toLowerCase();
  return n === "egyptian" || n === "egyptain" || n === "egypt";
}

function workPermitLabel(value) {
  if (value === "have_permit") return "Have permit";
  if (value === "no_permit") return "Don't have permit";
  return "—";
}

function insuranceStatusLabel(value) {
  if (value === "insured") return "Insured";
  if (value === "not_insured") return "Not insured";
  return "—";
}

function employeeComplianceLabel(emp) {
  if (isEgyptianNationality(emp.nationality)) return insuranceStatusLabel(emp.insurance_status);
  if (emp.nationality) return workPermitLabel(emp.work_permit);
  return "—";
}

function nationalityFormFieldsHtml(emp = {}) {
  const egyptian = isEgyptianNationality(emp.nationality);
  const nonEgyptian = emp.nationality && !egyptian;
  const insured = emp.insurance_status === "insured";
  const hasInsuranceDetails =
    insured &&
    (emp.insurance_type || emp.insurance_amount != null || emp.insurance_employee_deduction != null);
  const suggestions = state.meta.nationalities?.length
    ? state.meta.nationalities
    : ["Egyptian", "Sudanese", "Ethiopian", "Eritrean", "South Sudanese"];
  const isOther = emp.nationality && !suggestions.includes(emp.nationality);
  return `
    <label class="field"><span>Nationality</span>
      <select name="nationality" id="emp-nationality">
        <option value="">—</option>
        ${suggestions.map((n) => `<option value="${escapeHtml(n)}" ${emp.nationality === n ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
        <option value="__other__" ${isOther ? "selected" : ""}>Other…</option>
      </select>
      <input type="text" id="emp-nationality-other" class="${isOther ? "" : "hidden"}" value="${isOther ? escapeHtml(emp.nationality) : ""}" placeholder="Enter nationality" />
    </label>
    <div id="work-permit-fields" class="field-grid" style="grid-column:1/-1;${nonEgyptian ? "" : "display:none"}">
      <label class="field"><span>Work permit</span>
        <select name="work_permit" id="emp-work-permit">
          <option value="">—</option>
          <option value="have_permit" ${emp.work_permit === "have_permit" ? "selected" : ""}>Have permit</option>
          <option value="no_permit" ${emp.work_permit === "no_permit" ? "selected" : ""}>Don't have permit</option>
        </select>
      </label>
    </div>
    <div id="insurance-fields" class="field-grid" style="grid-column:1/-1;${egyptian ? "" : "display:none"}">
      <label class="field"><span>Social insurance</span>
        <select name="insurance_status" id="emp-insurance-status">
          <option value="">—</option>
          <option value="insured" ${emp.insurance_status === "insured" ? "selected" : ""}>Insured</option>
          <option value="not_insured" ${emp.insurance_status === "not_insured" ? "selected" : ""}>Not insured</option>
        </select>
      </label>
      <div id="insurance-detail-fields" style="grid-column:1/-1;${insured ? "" : "display:none"}">
        <label class="toggle-label" style="margin-bottom:.5rem">
          <input type="checkbox" id="emp-insurance-details-toggle" ${hasInsuranceDetails ? "checked" : ""} /> Add insurance details (optional)
        </label>
        <div id="insurance-detail-inputs" class="field-grid" style="${hasInsuranceDetails ? "" : "display:none"}">
          <label class="field"><span>Insurance type</span><input name="insurance_type" value="${escapeHtml(emp.insurance_type || "")}" placeholder="e.g. Social insurance" /></label>
          <label class="field"><span>Total amount (EGP)</span><input name="insurance_amount" type="number" min="0" step="0.01" value="${emp.insurance_amount ?? ""}" /></label>
          <label class="field"><span>Deducted from employee (EGP)</span><input name="insurance_employee_deduction" type="number" min="0" step="0.01" value="${emp.insurance_employee_deduction ?? ""}" /></label>
        </div>
      </div>
    </div>
    <div id="identity-doc-fields" class="field-grid" style="grid-column:1/-1">
      <label class="field" id="emp-national-id-wrap" style="${egyptian || !emp.nationality ? "" : "display:none"}"><span>National ID</span>
        <input name="national_id" id="emp-national-id" inputmode="numeric" maxlength="14" value="${escapeHtml(emp.national_id || emp.identification || "")}" placeholder="14 digits" />
      </label>
      <label class="field" id="emp-passport-wrap" style="${nonEgyptian ? "" : "display:none"}"><span>Passport number</span>
        <input name="passport_number" id="emp-passport" value="${escapeHtml(emp.passport_number || "")}" />
      </label>
    </div>`;
}

function bindNationalityFormFields(root = document) {
  const nationalityInput = root.querySelector("#emp-nationality");
  const nationalityOther = root.querySelector("#emp-nationality-other");
  const workPermitBlock = root.querySelector("#work-permit-fields");
  const insuranceBlock = root.querySelector("#insurance-fields");
  const nationalIdWrap = root.querySelector("#emp-national-id-wrap");
  const passportWrap = root.querySelector("#emp-passport-wrap");
  const insuranceStatus = root.querySelector("#emp-insurance-status");
  const insuranceDetailFields = root.querySelector("#insurance-detail-fields");
  const insuranceDetailsToggle = root.querySelector("#emp-insurance-details-toggle");
  const insuranceDetailInputs = root.querySelector("#insurance-detail-inputs");
  if (!nationalityInput) return;

  const selectedNationality = () => {
    if (nationalityInput.value === "__other__") return nationalityOther?.value || "";
    return nationalityInput.value || "";
  };

  const refresh = () => {
    if (nationalityOther) {
      nationalityOther.classList.toggle("hidden", nationalityInput.value !== "__other__");
    }
    const egyptian = isEgyptianNationality(selectedNationality());
    const hasNationality = Boolean(String(selectedNationality()).trim());
    if (workPermitBlock) workPermitBlock.style.display = hasNationality && !egyptian ? "" : "none";
    if (insuranceBlock) insuranceBlock.style.display = egyptian ? "" : "none";
    if (nationalIdWrap) nationalIdWrap.style.display = egyptian || !hasNationality ? "" : "none";
    if (passportWrap) passportWrap.style.display = hasNationality && !egyptian ? "" : "none";
    if (insuranceDetailFields) {
      insuranceDetailFields.style.display = egyptian && insuranceStatus?.value === "insured" ? "" : "none";
    }
  };

  nationalityInput.addEventListener("change", refresh);
  nationalityOther?.addEventListener("input", refresh);
  insuranceStatus?.addEventListener("change", refresh);
  insuranceDetailsToggle?.addEventListener("change", () => {
    if (insuranceDetailInputs) {
      insuranceDetailInputs.style.display = insuranceDetailsToggle.checked ? "" : "none";
      if (!insuranceDetailsToggle.checked) {
        insuranceDetailInputs.querySelectorAll("input").forEach((i) => {
          i.value = "";
        });
      }
    }
  });
  refresh();
}

function employeeFormFields(emp = {}) {
  const historyNote = emp.promoted_to_id
    ? `<p class="muted identity-note">Historical ID — records before promotion effective month stay under <strong>${escapeHtml(emp.id)}</strong>. Active record: <strong>${escapeHtml(emp.promoted_to_id)}</strong></p>`
    : emp.promoted_from_id
      ? `<p class="muted identity-note">Promoted from <strong>${escapeHtml(emp.promoted_from_id)}</strong>${emp.effective_from_month ? ` · active from <strong>${escapeHtml(emp.effective_from_month)}</strong>` : ""}${emp.former_ids ? ` · former IDs: ${escapeHtml(emp.former_ids)}` : ""}</p>`
      : "";
  const dbIdNote =
    canViewEmployeeInternalId() && emp.internal_id
      ? `<label class="field"><span>Database ID (permanent)</span><input value="${escapeHtml(emp.internal_id)}" readonly title="Never changes — links attendance, payroll &amp; all history" /></label>`
      : "";
  const appIdDisplay = emp.archived_app_id && String(emp.id || "").startsWith("DEL-")
    ? emp.archived_app_id
    : emp.id;
  return `<form id="emp-form" class="field-grid">
    <label class="field"><span>App ID (shown in HR screens)</span>
      ${canManagePayrollEvents() && emp.status !== "Deleted" && !isUnassignedIdStub(emp)
        ? `<div class="btn-row"><input type="text" id="change-app-id-input" value="${escapeHtml(appIdDisplay || "")}" placeholder="App ID" style="max-width:10rem" />
          <button type="button" class="btn btn-sm" id="change-app-id-btn">Save ID</button></div>
          <label class="toggle-label" style="margin-top:.35rem;display:block"><input type="checkbox" id="change-app-id-enforce-prefix" checked /> Enforce unit ID prefix</label>`
        : `<input name="app_id_display" value="${escapeHtml(appIdDisplay || "")}" readonly />`}
    </label>
    <label class="field"><span>Never pay (trial/test)</span><input name="payroll_exempt" type="checkbox" ${emp.payroll_exempt ? "checked" : ""} ${canManagePayrollEvents() ? "" : "disabled"} /></label>
    ${dbIdNote}
    ${historyNote}
    <label class="field"><span>American Name</span><input name="american_name" value="${emp.american_name || ""}" /></label>
    <label class="field"><span>Arabic Name</span><input name="arabic_name" value="${emp.arabic_name || ""}" /></label>
    <label class="field"><span>Status</span><select name="status">${state.meta.statuses.map((s) =>
      `<option value="${s}" ${emp.status === s ? "selected" : ""}>${s || "(blank)"}</option>`
    ).join("")}</select></label>
    <label class="field"><span>Unit</span><select name="unit">${state.meta.units.map((u) =>
      `<option value="${u}" ${emp.unit === u ? "selected" : ""}>${u}</option>`
    ).join("")}</select></label>
    ${teamSelectHtml("team", emp.team)}
    ${positionSelectHtml("position", emp.position)}
    ${paymentMethodFieldsHtml(emp)}
    <label class="field"><span>Phone</span><input name="phone" value="${emp.phone || ""}" /></label>
    <label class="field"><span>Email</span><input name="email" value="${emp.email || ""}" /></label>
    <label class="field"><span>Employment date</span><input name="employment_date" type="date" value="${(emp.employment_date || "").slice(0, 10)}" /></label>
    <label class="field"><span>Probation end</span><input name="probation_end_date" type="date" value="${(emp.probation_end_date || "").slice(0, 10)}" /></label>
    <label class="field"><span>Contract end</span><input name="contract_end_date" type="date" value="${(emp.contract_end_date || "").slice(0, 10)}" /></label>
    <label class="field"><span>FP number (biometric)</span><input name="fp_number" value="${emp.fp_number || ""}" placeholder="Device enroll ID" /></label>
    ${nationalityFormFieldsHtml(emp)}
  </form>`;
}

function parseEquipmentEmployeeFromUrl() {
  try {
    const hash = window.location.hash || "";
    const q = window.location.search || "";
    const fromHash = hash.match(/equipment\?employee=([^&]+)/i)?.[1];
    const fromQuery = new URLSearchParams(q.startsWith("?") ? q : hash.split("?")[1] || "").get("employee");
    const id = fromHash || fromQuery;
    if (id) state.hrmsEmployeeFilter = decodeURIComponent(id);
  } catch (_) {}
}

function navigateToHrmsEmployeeSection(section, employeeId) {
  if (!employeeId) return;
  closeModal();
  if (section === "equipment") {
    state.hrmsEmployeeFilter = employeeId;
    navigate("equipment");
    return;
  }
  const emp =
    (state.meta?.employees || []).find((e) => e.id === employeeId) ||
    (document.getElementById("app")?.__employeesData?.employees || []).find((e) => e.id === employeeId);
  if (emp) {
    if (section === "quality-notes") openEmployeeQualityNotesModal(employeeId);
    else if (section === "notes") openEmployeeWarningsModal(employeeId);
    else openEmployeeModal(emp, { focusSection: section });
    return;
  }
  api(`/employees/${encodeURIComponent(employeeId)}`)
    .then((d) => {
      if (!d.employee) return alert("Employee not found");
      if (section === "quality-notes") openEmployeeQualityNotesModal(employeeId);
      else if (section === "notes") openEmployeeWarningsModal(employeeId);
      else openEmployeeModal(d.employee, { focusSection: section });
    })
    .catch((e) => alert(e.message));
}

function openEmployeeById(employeeId, section) {
  navigateToHrmsEmployeeSection(section, employeeId);
}

function openEmployeeModal(emp, options = {}) {
  const canPhoto = true;
  const canPromote =
    canManagePayrollEvents() && !emp.promoted_to_id && !emp.promoted_from_id && emp.status !== "Out" && emp.status !== "Deleted";
  const canRevert = canManagePayrollEvents() && emp.promoted_from_id && !emp.promoted_to_id;
  const canChangeAppId = canManagePayrollEvents() && emp.status !== "Deleted" && !isUnassignedIdStub(emp);
  const canRelease = canManagePayrollEvents() && (isUnassignedIdStub(emp) || emp.status !== "Deleted");
  const canPurgeUser = isUserManager() && emp.status !== "Deleted" && !isUnassignedIdStub(emp);
  openModal(`
    <div class="modal-header"><h2>Edit employee</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body" id="emp-modal-body">
      ${canPhoto ? `<div class="profile-photo-block">
        ${avatarHtml(emp, "profile-photo-lg")}
        <div class="profile-photo-actions">
          <label class="btn btn-sm btn-primary" id="upload-photo-btn">Upload photo
            <input type="file" id="profile-photo-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
          </label>
          ${emp.profile_photo_file_id ? '<button type="button" class="btn btn-sm btn-danger" id="remove-photo-btn">Remove</button>' : ""}
          <p class="muted" style="margin:.35rem 0 0;font-size:.75rem">JPG, PNG, WebP or GIF · stored securely</p>
        </div>
      </div>` : ""}
      ${employeeFormFields(emp)}
      ${canChangeAppId ? `` : ""}
      ${canRevert ? `<div class="card card-flat" style="margin-top:1rem;grid-column:1/-1">
        <h4>Revert mistaken promotion</h4>
        <p class="muted" style="margin:.25rem 0 .75rem">Merges records back to <strong>${escapeHtml(emp.promoted_from_id)}</strong> and removes this promotion record.</p>
        <button type="button" class="btn btn-sm btn-danger" id="revert-promotion-btn">Revert promotion</button>
      </div>` : ""}
      ${canPromote ? `<div class="card card-flat" style="margin-top:1rem;grid-column:1/-1">
        <h4>Promote — new ID &amp; position</h4>
        <p class="muted" style="margin:.25rem 0 .75rem">Keeps <strong>${escapeHtml(emp.id)}</strong> for all months before the effective month. From that month on, payroll &amp; attendance use the new ID.</p>
        <button type="button" class="btn btn-sm btn-primary" id="promote-emp-btn">Reposition agent…</button>
      </div>` : ""}
      ${canRelease ? `<div class="card card-flat" style="margin-top:1rem;grid-column:1/-1">
        <h4>Release / delete app ID</h4>
        <p class="muted" style="margin:.25rem 0 .75rem">Sets status to <strong>Deleted</strong>, frees the app ID (e.g. C01) for reuse. Permanent database record and all history are kept.</p>
        <button type="button" class="btn btn-sm btn-danger" id="release-app-id-btn">Release app ID</button>
      </div>` : ""}
      ${canPurgeUser ? `<div class="card card-flat" style="margin-top:1rem;grid-column:1/-1">
        <h4>Purge user &amp; release ID</h4>
        <p class="muted" style="margin:.25rem 0 .75rem">Removes the app login and releases <strong>${escapeHtml(emp.id)}</strong> in one step. History stays under a DEL-… record.</p>
        <button type="button" class="btn btn-sm btn-danger" id="purge-user-emp-btn">Purge user &amp; release ID</button>
      </div>` : ""}
      <div class="card card-flat" style="margin-top:1rem;grid-column:1/-1">
        <h4>Export employee data</h4>
        <div class="btn-row" style="margin-top:.5rem">
          <button type="button" class="btn btn-sm" id="export-emp-payrolls-btn">All payroll PDFs</button>
          <button type="button" class="btn btn-sm" id="export-emp-att-csv-btn">Attendance summary (CSV)</button>
          <button type="button" class="btn btn-sm" id="export-emp-att-pdf-btn">Attendance summary (PDF)</button>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="save-emp">Save</button>
    </div>`);
  bindProfilePhotoUpload(emp.id, () => {
    api(`/employees/${emp.id}`)
      .then((d) => {
        if (d.employee) patchEmployeeInCache(d.employee);
        openEmployeeModal(d.employee);
      })
      .catch((e) => alert(e.message));
  });
  bindPaymentMethodFields();
  bindNationalityFormFields();
  document.getElementById("promote-emp-btn")?.addEventListener("click", () => openPromoteEmployeeModal(emp));
  document.getElementById("change-app-id-btn")?.addEventListener("click", async () => {
    const newId = document.getElementById("change-app-id-input")?.value?.trim();
    if (!newId) return alert("Enter a new app ID");
    if (!confirm(`Change app ID from ${emp.id} to ${newId}?`)) return;
    try {
      const res = await api(`/employees/${emp.id}/change-app-id`, {
        method: "POST",
        body: JSON.stringify({
          newId,
          enforcePrefix: document.getElementById("change-app-id-enforce-prefix")?.checked !== false,
        }),
      });
      closeModal();
      if (res.employee) patchEmployeeInCache(res.employee);
      showSaveIndicator("App ID changed", "saved");
      render();
    } catch (e) {
      alert(e.message);
    }
  });
  document.getElementById("revert-promotion-btn")?.addEventListener("click", async () => {
    if (!confirm(`Revert promotion and merge back to ${emp.promoted_from_id}?`)) return;
    try {
      const res = await api(`/employees/${emp.id}/revert-promotion`, { method: "POST" });
      closeModal();
      if (res.employee) patchEmployeeInCache(res.employee);
      showSaveIndicator("Promotion reverted", "saved");
      render();
    } catch (e) {
      alert(e.message);
    }
  });
  document.getElementById("release-app-id-btn")?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const label = isUnassignedIdStub(emp) ? emp.id : `app ID ${emp.id}`;
    const btn = document.getElementById("release-app-id-btn");
    openConfirmDeleteModal({
      title: "Release app ID",
      message: `Release ${label}? The ID can be assigned to someone new; history stays in the database.`,
      onConfirm: async () => {
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = "Releasing…";
        try {
          const res = await api(`/employees/${encodeURIComponent(emp.id)}/release-app-id`, { method: "POST" });
          if (res.employees) replaceEmployeesInCache(res.employees);
          closeModal();
          showSaveIndicator("App ID released", "saved");
          await render();
        } catch (e) {
          alert(e.message || "Release failed");
        } finally {
          btn.disabled = false;
          btn.textContent = prev;
        }
      },
    });
  });
  document.getElementById("purge-user-emp-btn")?.addEventListener("click", () => {
    openConfirmModal({
      title: "Purge user & release ID",
      message: `Remove login and release ${emp.id}? History stays under a DEL-… record.`,
      confirmLabel: "Continue",
      danger: true,
      onConfirm: () => {
        openConfirmModal({
          title: "Confirm purge",
          message: "This cannot be undone.",
          confirmLabel: "Yes, purge",
          danger: true,
          onConfirm: async () => {
            try {
              const res = await api(`/admin/users/${encodeURIComponent(emp.id)}/purge`, {
                method: "POST",
                body: "{}",
              });
              closeModal();
              showSaveIndicator(
                res.releasedAppId ? `Purged — ID ${res.releasedAppId} released` : "User purged",
                "saved"
              );
              render();
            } catch (e) {
              alert(e.message);
            }
          },
        });
      },
    });
  });
  document.getElementById("export-emp-payrolls-btn")?.addEventListener("click", () =>
    exportEmployeePayrolls(emp).catch((e) => alert(e.message))
  );
  document.getElementById("export-emp-att-csv-btn")?.addEventListener("click", () =>
    downloadFile(`/employees/${emp.id}/attendance-summary?format=csv`, `attendance-summary-${emp.id}.csv`).catch((e) => alert(e.message))
  );
  document.getElementById("export-emp-att-pdf-btn")?.addEventListener("click", () =>
    downloadFile(`/employees/${emp.id}/attendance-summary?format=pdf`, `attendance-summary-${emp.id}.pdf`).catch((e) => alert(e.message))
  );
  document.getElementById("save-emp").onclick = async () => {
    const btn = document.getElementById("save-emp");
    const body = Object.fromEntries(new FormData(document.getElementById("emp-form")));
    if (body.nationality === "__other__") {
      body.nationality = document.getElementById("emp-nationality-other")?.value?.trim() || "";
    }
    body.payroll_exempt = document.querySelector("#emp-form [name=payroll_exempt]")?.checked === true;
    delete body.id;
    delete body.app_id_display;

    const newStatus = body.status;
    if (newStatus === "Deleted") {
      if (!confirm(`Release app ID ${emp.id}? History stays in the database; the ID can be reused.`)) return;
      try {
        const res = await api(`/employees/${emp.id}/release-app-id`, { method: "POST" });
        if (res.employees) replaceEmployeesInCache(res.employees);
        closeModal();
        showSaveIndicator("App ID released", "saved");
        render();
      } catch (e) {
        alert(e.message);
      }
      return;
    }
    const markingOut = isOutEmployeeStatus(newStatus) && !isOutEmployeeStatus(emp.status);
    if (markingOut) {
      openModal(`
        <div class="modal-header"><h2>Mark depart</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="emp-depart-form" class="modal-body field-grid">
          <p class="muted">Setting status to <strong>${escapeHtml(newStatus)}</strong> requires a depart date and notice type.</p>
          <label class="field"><span>Depart date</span><input name="departDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
          <label class="field"><span>Notice</span>
            <select name="notice_type" required>
              <option value="with_notice">Left with 2 weeks notice</option>
              <option value="without_notice">Left without 2 weeks notice</option>
            </select>
          </label>
        </form>
        <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="confirm-emp-depart">Save depart</button></div>`);
      document.getElementById("confirm-emp-depart").onclick = async () => {
        const fd = new FormData(document.getElementById("emp-depart-form"));
        const departBtn = document.getElementById("confirm-emp-depart");
        departBtn.disabled = true;
        try {
          const otherFields = { ...body };
          delete otherFields.status;
          if (Object.keys(otherFields).length) {
            const pre = await api(`/employees/${emp.id}`, { method: "PUT", body: JSON.stringify(otherFields) });
            if (pre.employee) patchEmployeeInCache(pre.employee);
          }
          await api(`/hrms/employment-periods/${emp.id}/depart`, {
            method: "POST",
            body: JSON.stringify({
              departDate: fd.get("departDate"),
              status: newStatus === "OUT BUT STILL GET PAID" ? "out_still_paid" : "out",
              notice_type: fd.get("notice_type") || "with_notice",
            }),
          });
          closeModal();
          const fresh = await api(`/employees/${emp.id}`);
          if (fresh.employee) patchEmployeeInCache(fresh.employee);
          showSaveIndicator("Employee departed", "saved");
        } catch (e) {
          alert(e.message);
        } finally {
          departBtn.disabled = false;
        }
      };
      return;
    }

    btn.disabled = true;
    const prevLabel = btn.textContent;
    btn.textContent = "Saving…";
    try {
      const res = await api(`/employees/${emp.id}`, { method: "PUT", body: JSON.stringify(body) });
      closeModal();
      if (res.employee) patchEmployeeInCache(res.employee);
      showSaveIndicator("Employee saved", "saved");
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  };
  const focusLifecycle = () => {
    if (!options.focusSection) return;
    if (options.focusSection === "offboarding" || options.focusSection === "clearance") {
      const details = document.getElementById("hrms-offboarding-section");
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  };
  const lifecycleMount = window.HRMSFeatures?.mountEmployeeLifecyclePanel?.(emp, api, {
    escapeHtml,
    openModal,
    closeModal,
    canManagePayrollEvents,
  });
  if (lifecycleMount && typeof lifecycleMount.then === "function") {
    lifecycleMount.then(focusLifecycle);
  } else {
    requestAnimationFrame(focusLifecycle);
  }
}
window.openEmployeeModal = openEmployeeModal;
window.openEmployeeById = openEmployeeById;

async function openPromoteEmployeeModal(emp) {
  let leadRole = "TL";
  let suggestedId = "";
  const ratesRes = await api("/position-rates").catch(() => ({ rates: [] }));
  const positionRates = ratesRes.rates || [];
  const positionOptions = positionRates
    .map((r) => `<option value="${escapeHtml(r.position)}">${escapeHtml(r.position)}</option>`)
    .join("");
  const loadSuggested = async () => {
    let url = `/employees/next-id?leadRole=${encodeURIComponent(leadRole)}`;
    if (leadRole === "Agent" && emp.unit) {
      url += `&unit=${encodeURIComponent(emp.unit)}`;
    }
    const data = await api(url);
    suggestedId = data.suggestedId || "";
    const input = document.getElementById("promote-new-id");
    if (input && !input.dataset.userEdited) input.value = suggestedId;
    const dl = document.getElementById("promote-id-list");
    if (!dl) return;
    try {
      if (leadRole === "Agent" && emp.unit) {
        const avail = await api(`/employees/available-ids?unit=${encodeURIComponent(emp.unit)}&limit=15`);
        dl.innerHTML = (avail.ids || []).map((id) => `<option value="${escapeHtml(id)}">`).join("");
      } else if (["HR", "RTM", "IT"].includes(leadRole)) {
        const avail = await api(
          `/employees/available-ids?unit=${encodeURIComponent("HS-Back-End")}&backendPool=${encodeURIComponent(leadRole)}&limit=15`
        );
        dl.innerHTML = (avail.ids || []).map((id) => `<option value="${escapeHtml(id)}">`).join("");
      } else {
        dl.innerHTML = "";
      }
    } catch {
      dl.innerHTML = "";
    }
  };

  openModal(
    `<div class="modal-header"><h2>Reposition ${escapeHtml(emp.american_name || emp.id)}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      <p class="muted">Agent ID <strong>${escapeHtml(emp.id)}</strong> stays in the system for past attendance &amp; payroll. New records use the leadership ID below.</p>
      <form id="promote-form" class="field-grid" style="margin-top:1rem">
        <label class="field"><span>Lead role</span>
          <select name="leadRole" id="promote-lead-role">
            <option value="TL">Team Leader (TL)</option>
            <option value="CL">Closer / Supervisor (CL)</option>
            <option value="OP">OP</option>
            <option value="HR">HR (back-office)</option>
            <option value="RTM">RTM</option>
            <option value="IT">IT</option>
            <option value="Agent">Agent transfer</option>
          </select></label>
        <label class="field"><span>New ID</span>
          <input name="newId" id="promote-new-id" list="promote-id-list" required placeholder="TL04" />
          <datalist id="promote-id-list"></datalist></label>
        <label class="field"><span>New position</span>
          <select name="position" id="promote-position">
            <option value="">— select —</option>
            ${positionOptions}
          </select></label>
        <label class="field"><span>New team</span>
          <select name="team" id="promote-team">
            <option value="">— keep current —</option>
            ${(state.orgTeams || []).map((t) => `<option value="${escapeHtml(t.name)}" ${emp.team === t.name ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
          </select></label>
        <label class="field"><span>Effective from month</span>
          <input name="effectiveFromMonth" id="promote-effective" type="month" value="${state.month}" required /></label>
        <label class="field" style="grid-column:1/-1">
          <label class="toggle-label"><input type="checkbox" id="promote-enforce-prefix" checked /> Enforce unit / role ID prefix (e.g. HR-, HS3-, TL01)</label>
        </label>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="confirm-promote-btn">Reposition</button>
    </div>`,
    true
  );

  const idInput = document.getElementById("promote-new-id");
  idInput?.addEventListener("input", () => {
    idInput.dataset.userEdited = "1";
  });
  const positionDefaults = { TL: "Team Leader", CL: "Closer", OP: "OP", HR: "HR", RTM: "RTM", IT: "IT Support" };
  const positionInput = document.getElementById("promote-position");
  const setDefaultPosition = () => {
    if (positionInput && !positionInput.dataset.userEdited) {
      const def = positionDefaults[leadRole] || "Team Leader";
      const match = [...positionInput.options].find((o) => o.value === def);
      positionInput.value = match ? def : positionInput.options[1]?.value || "";
    }
  };
  setDefaultPosition();

  document.getElementById("promote-lead-role")?.addEventListener("change", async (e) => {
    leadRole = e.target.value;
    if (idInput) idInput.dataset.userEdited = "";
    if (positionInput) positionInput.dataset.userEdited = "";
    setDefaultPosition();
    await loadSuggested();
  });
  positionInput?.addEventListener("change", () => {
    positionInput.dataset.userEdited = "1";
  });
  await loadSuggested();

  document.getElementById("confirm-promote-btn").onclick = async () => {
    const fd = new FormData(document.getElementById("promote-form"));
    const newId = String(fd.get("newId") || "").trim();
    const effectiveFromMonth = String(fd.get("effectiveFromMonth") || "").trim();
    if (!newId) {
      alert("Enter the new TL / CL / OP ID.");
      return;
    }
    if (!effectiveFromMonth) {
      alert("Choose the month when the new ID and position take effect.");
      return;
    }
    if (
      !confirm(
        `Reposition ${emp.id} → ${newId} from ${effectiveFromMonth}?\n\nBefore ${effectiveFromMonth}: ${emp.id}\nFrom ${effectiveFromMonth}: ${newId}`
      )
    )
      return;
    try {
      const res = await api(`/employees/${emp.id}/promote`, {
        method: "POST",
        body: JSON.stringify({
          newId,
          leadRole: fd.get("leadRole"),
          effectiveFromMonth,
          position: fd.get("position") || undefined,
          team: fd.get("team") || undefined,
          enforcePrefix: document.getElementById("promote-enforce-prefix")?.checked !== false,
        }),
      });
      closeModal();
      alert(`Repositioned. ${res.newId} active from ${res.effectiveFromMonth}.`);
      render();
    } catch (e) {
      alert(e.message);
    }
  };
}

async function exportEmployeePayrolls(emp) {
  if (!window.hrDesktop?.pickFolder) {
    alert("Export requires the Hangup Portal desktop app.");
    return;
  }
  const data = await api(`/employees/${emp.id}/payroll-months`);
  if (!data.months?.length) {
    alert("No payroll months found for this employee.");
    return;
  }
  const folder = await window.hrDesktop.pickFolder();
  if (!folder) return;
  const safeName = String(data.name || emp.id)
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const subfolder = `${folder}\\${safeName}_${emp.id}_Payrolls`;
  const sessionId = getSessionId();
  let ok = 0;
  for (const row of data.months) {
    const res = await fetch(`/api/payslip/${row.employeeId}/pdf?month=${row.month}`, {
      headers: sessionId ? { "x-session-id": sessionId } : {},
    });
    if (!res.ok) continue;
    const buf = await res.arrayBuffer();
    await window.hrDesktop.writeFileBuffer(`${subfolder}\\payslip-${row.month}-${row.employeeId}.pdf`, buf);
    ok++;
  }
  alert(`Exported ${ok} payslip PDF(s) to:\n${subfolder}`);
}

async function openPayslipModal(employeeId) {
  const [data, empListRes] = await Promise.all([
    api(`/payroll/${employeeId}?month=${state.month}`),
    api(`/employees${employeesQuery()}`).catch(() => ({ employees: [] })),
  ]);
  const deductCandidates = sortEmployeesForLeadDeduct(
    (empListRes.employees || []).filter((e) => e.id !== employeeId)
  );
  const empById = new Map((empListRes.employees || []).map((e) => [e.id, e]));
  const p = data.payslip;
  const isDual = p.payrollKind === "dual";
  const activeSlip = isDual ? p.training || p : p;
  const dualBanner = isDual
    ? `<div class="alert alert-info" style="margin-bottom:1rem">
        <strong>Dual payslip month</strong> — Training: ${fmt(p.training?.netSalary || 0)} EGP · Agent: ${fmt(p.agent?.netSalary || 0)} EGP · Combined: <strong>${fmt(p.combinedNet || 0)} EGP</strong>
        <div class="btn-row" style="margin-top:.5rem">
          <button type="button" class="btn btn-sm" id="pdf-training-btn">Training PDF</button>
          <button type="button" class="btn btn-sm" id="pdf-agent-btn">Agent PDF</button>
        </div>
        <div class="btn-row payslip-tabs" style="margin-top:.5rem">
          <button type="button" class="btn btn-sm btn-primary" data-payslip-tab="training">Training</button>
          <button type="button" class="btn btn-sm" data-payslip-tab="agent">Agent</button>
          <button type="button" class="btn btn-sm" data-payslip-tab="combined">Combined</button>
        </div>
      </div>`
    : "";
  const emp = data.employee || { id: employeeId, american_name: p.name, profile_photo_file_id: p.profile_photo_file_id };
  const slipForRender = activeSlip;
  const bonusRows = Object.entries(slipForRender.bonuses || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<div class="payslip-row"><span>${k}</span><span class="amount-pos">+${fmt(v)}</span></div>`)
    .join("");
  const dedRows = Object.entries(slipForRender.deductions || {})
    .filter(([k, v]) => v > 0 && k !== "Lateness Deduction" && k !== TL_BONUS_TYPE)
    .map(([k, v]) => `<div class="payslip-row"><span>${k}</span><span class="amount-neg">-${fmt(v)}</span></div>`)
    .join("");
  const bonusTransferRow = slipForRender.bonusTransferPayroll
    ? `<div class="payslip-row"><span>Agent bonuses (from payroll)</span><span class="amount-neg">-${fmt(p.bonusTransferPayroll)}</span></div>`
    : "";
  const attDetail = attendanceDetailHtml(data.attendance);

  const bonusList = (data.bonuses || [])
    .map((b) => {
      const tlFrom = parseTlSourceFromReason(b.reason);
      const tlLabel = canViewBonusTransferSource() && tlFrom ? ` · deducted from ${tlFrom}` : "";
      const reason = String(b.reason || "").replace(/\s*\(deducted from[^)]+\)\s*/i, "").trim();
      return `<div class="adj-row"><span>${b.type}: ${fmt(b.amount)} EGP — ${formatPayslipDate(b.date)}${reason ? ` — ${escapeHtml(reason)}` : ""}${tlLabel}
          </span><button class="btn btn-sm btn-danger" data-del-bonus='${JSON.stringify({ employeeId: b.employeeId, date: b.date, type: b.type })}'>Delete</button></div>`;
    })
    .join("");
  const dedList = (data.deductions || [])
    .map((d) => {
      let linked = "";
      if (d.type === "Bonus from TL / OP") {
        const targetId = d.bonusRecipientId || parseTlTargetFromReason(d.reason);
        if (targetId) {
          const american = d.bonusRecipientAmericanName || empById.get(targetId)?.american_name || targetId;
          linked = ` · bonus for ${american} (${targetId})`;
        }
      }
      return `<div class="adj-row"><span>${d.type}: ${fmt(d.amount)} EGP — ${formatPayslipDate(d.date)}${d.reason ? ` — ${escapeHtml(d.reason)}` : ""}${linked}
          </span><button class="btn btn-sm btn-danger" data-del-ded='${JSON.stringify({ employeeId: d.employeeId, date: d.date, type: d.type })}'>Delete</button></div>`;
    })
    .join("");

  const gateNotes = data.payslipGateNotes || p.payslipGateNotes || [];
  const gateBanner = gateNotes.length
    ? `<div class="alert alert-warn" style="margin-bottom:1rem">
        <strong>Offboarding / clearance pending</strong>
        <ul style="margin:.5rem 0 0 1rem">${gateNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
        <div class="btn-row" style="margin-top:.5rem">
          <a class="btn btn-sm" href="#offboarding?employee=${encodeURIComponent(employeeId)}" data-hrms-nav="offboarding" data-employee-id="${escapeHtml(employeeId)}">Offboarding</a>
          <a class="btn btn-sm" href="#clearance?employee=${encodeURIComponent(employeeId)}" data-hrms-nav="clearance" data-employee-id="${escapeHtml(employeeId)}">Clearance</a>
          <a class="btn btn-sm" href="#equipment?employee=${encodeURIComponent(employeeId)}" data-hrms-nav="equipment" data-employee-id="${escapeHtml(employeeId)}">Equipment</a>
        </div>
      </div>`
    : "";
  const adj = data.adjustment || {};
  const departDate = String(emp.depart_date || "").slice(0, 10);
  const departDay = departDate ? parseInt(departDate.slice(8, 10), 10) : 0;
  const finalPayBanner =
    departDay > 15
      ? `<div class="alert alert-warn" style="margin-bottom:1rem">Final payment due next payroll cycle (paid on 15th) — depart ${departDate}</div>`
      : "";
  const statuses = data.payrollStatuses || ["pending", "pending papers", "pending hardware", "received", "closed"];
  const statusOpts = statuses
    .map((s) => `<option value="${s}" ${(adj.payrollStatus || p.payrollStatus) === s ? "selected" : ""}>${s}</option>`)
    .join("");

  openModal(
    `<div class="modal-header"><h2>Payslip — ${p.name}${isDual ? " (Training + Agent)" : ""}</h2>
      <div class="btn-row">
        <button class="btn btn-sm" id="hist-slip-btn">History</button>
        <button class="btn btn-sm" id="pdf-slip-btn">PDF</button>
        <button class="btn btn-sm" onclick="window.print()">Print</button>
        <button class="btn btn-sm" data-close>✕</button>
      </div></div>
    <div class="modal-body payslip" id="payslip-modal-body">
      ${dualBanner}
      ${gateBanner}
      ${finalPayBanner}
      <div class="payslip-header">
        <div class="payslip-identity">
          ${avatarHtml(emp, "profile-photo-lg")}
          <div>
          <strong style="font-size:1.2rem">${slipForRender.name || p.name}</strong>
          <div class="muted">${slipForRender.employeeId || p.employeeId} · ${slipForRender.unit || p.unit || "—"} · ${slipForRender.position || p.position || "—"}</div>
          <div class="muted">${monthLabel(state.month)} · ${slipForRender.paymentMethod || p.paymentMethod || "—"}</div>
          <div style="margin-top:.35rem">${payrollStatusBadge(slipForRender.payrollStatus || p.payrollStatus)}</div>
          <label class="btn btn-sm" style="margin-top:.5rem" id="payslip-photo-btn">Change photo
            <input type="file" id="profile-photo-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
          </label>
          </div>
        </div>
        <div class="text-right"><div class="muted">Monthly salary</div><strong>${fmt(slipForRender.monthlySalary ?? p.monthlySalary)} EGP</strong>
          ${slipForRender.salaryRaise || p.salaryRaise ? `<div class="muted">incl. raise +${fmt(slipForRender.salaryRaise || p.salaryRaise)}</div>` : ""}</div>
      </div>
      <div class="grid-2" id="payslip-detail-grid">
        <div class="payslip-section">
          <h4>Attendance</h4>
          <div class="payslip-row"><span>Working days</span><span>${slipForRender.totalWorkingDays ?? p.totalWorkingDays}</span></div>
          ${slipForRender.extraDays || p.extraDays ? `<div class="payslip-row"><span>Extra days</span><span>${slipForRender.extraDays || p.extraDays}</span></div>` : ""}
          ${slipForRender.nsnc || p.nsnc ? `<div class="payslip-row"><span>NSNC</span><span>${slipForRender.nsnc || p.nsnc}</span></div>` : ""}
          ${slipForRender.nsncHalf || p.nsncHalf ? `<div class="payslip-row"><span>NSNC Half Day</span><span>${slipForRender.nsncHalf || p.nsncHalf}</span></div>` : ""}
          <div class="payslip-row"><span>Daily rate (${slipForRender.workingDaysInMonth ?? p.workingDaysInMonth}d)</span><span>${slipForRender.dailyRate ?? p.dailyRate} EGP</span></div>
          <div class="payslip-row"><span>Basic salary</span><strong>${fmt(slipForRender.basicSalary ?? p.basicSalary)} EGP</strong></div>
          ${slipForRender.transportAllowance || p.transportAllowance ? `<div class="payslip-row"><span>Transport (${(slipForRender.transportDays ?? p.transportDays) % 1 === 0 ? (slipForRender.transportDays ?? p.transportDays) : (slipForRender.transportDays ?? p.transportDays)} day-units)</span><span class="amount-pos">+${fmt(slipForRender.transportAllowance || p.transportAllowance)}</span></div>` : ""}
          ${slipForRender.salesCount || p.salesCount ? `<div class="payslip-row"><span>Sales this month</span><span>${slipForRender.salesCount || p.salesCount}</span></div>` : ""}
          ${((slipForRender.commissionBreakdown || p.commissionBreakdown) || []).length ? `<div class="payslip-row"><span>Commission tiers</span><span class="amount-pos">${(slipForRender.commissionBreakdown || p.commissionBreakdown).map((b) => `${b.label}: ${fmt(b.amount)}`).join(" + ")}</span></div>` : ""}
          ${slipForRender.twoWeekHold || p.twoWeekHold ? `<div class="payslip-row"><span>2-week hold</span><span class="amount-neg">-${fmt(slipForRender.holdAmount || p.holdAmount)}</span></div>` : ""}
        </div>
        <div class="payslip-section">
          <h4>Net pay</h4>
          ${bonusRows || '<div class="muted">No bonuses</div>'}
          <div class="payslip-row"><span>Lateness</span><span class="amount-neg">-${fmt(slipForRender.latenessDeduction ?? p.latenessDeduction)}</span></div>
          ${attDetail}
          ${dedRows}
          ${bonusTransferRow}
          ${slipForRender.deferredIn || p.deferredIn ? `<div class="payslip-row"><span>Carried from prior month</span><span class="amount-pos">+${fmt(slipForRender.deferredIn || p.deferredIn)}</span></div>` : ""}
          <div class="payslip-row"><span>Calculated net</span><span>${fmt(slipForRender.calculatedNet ?? slipForRender.netSalary ?? p.calculatedNet ?? p.netSalary)} EGP</span></div>
          ${slipForRender.receivedTotal || p.receivedTotal ? `<div class="payslip-row"><span>Paid (splits)</span><span class="amount-neg">-${fmt(slipForRender.receivedTotal || p.receivedTotal)}</span></div>` : ""}
          ${slipForRender.deferredOut || p.deferredOut ? `<div class="payslip-row"><span>Deferred to later month</span><span class="amount-neg">-${fmt(slipForRender.deferredOut || p.deferredOut)}</span></div>` : ""}
          <div class="payslip-row payslip-total"><span>Balance due</span><span>${fmt(isDual ? (p.combinedNet ?? payrollRowNet(p)) : (slipForRender.remainingBalance ?? slipForRender.netSalary ?? p.remainingBalance ?? p.netSalary))} EGP</span></div>
        </div>
      </div>
      <div class="grid-2" style="margin-top:1rem">
        <div class="card">
          <h4>Bonuses</h4>${bonusList || '<p class="muted">None</p>'}
          <form id="bonus-form" class="field-grid" style="margin-top:.75rem">
            <label class="field"><span>Type</span><select name="type" id="bonus-type">${data.bonusTypes.map((t) => `<option value="${t}">${t}</option>`).join("")}</select></label>
            <label class="field hidden" id="deduct-from-wrap" style="grid-column:1/-1"><span>Deduct from agent (pays for this bonus)</span>
              <select name="deductFromEmployeeId">
                <option value="">— Select agent —</option>
                ${employeeSelectOptionsForTlDeduct(deductCandidates)}
              </select>
            </label>
            <label class="field"><span>Amount</span><input name="amount" type="number" min="0" required /></label>
            <label class="field"><span>Date</span><input name="date" type="date" value="${state.month}-15" required /></label>
            <label class="field" style="grid-column:1/-1"><span>Reason</span><input name="reason" /></label>
          </form>
          <button class="btn btn-primary btn-sm" id="add-bonus-btn" style="margin-top:.5rem">Add bonus</button>
        </div>
        <div class="card">
          <h4>Deductions</h4>${dedList || '<p class="muted">None</p>'}
          <form id="deduction-form" class="field-grid" style="margin-top:.75rem">
            <label class="field"><span>Type</span><select name="type">${data.deductionTypes.map((t) => `<option value="${t}">${t}</option>`).join("")}</select></label>
            <label class="field"><span>Amount</span><input name="amount" type="number" min="0" required /></label>
            <label class="field"><span>Date</span><input name="date" type="date" value="${state.month}-15" required /></label>
            <label class="field" style="grid-column:1/-1"><span>Reason</span><input name="reason" /></label>
          </form>
          <button class="btn btn-primary btn-sm" id="add-ded-btn" style="margin-top:.5rem">Add deduction</button>
        </div>
      </div>
      <div class="card" style="margin-top:1rem">
        <h4>Month profile — ${monthLabel(state.month)}</h4>
        <p class="muted" style="margin:0 0 .75rem">Payment method and salary apply to this month only (historical reports stay correct).</p>
        <form id="adj-form" class="field-grid">
          <label class="field"><span>Position</span><input name="position" value="${adj.position || p.position || ""}" /></label>
          <label class="field"><span>Salary raise (EGP)</span><input name="salaryRaise" type="number" min="0" value="${adj.salaryRaise ?? p.salaryRaise ?? 0}" /></label>
          <label class="field"><span>Salary override</span><input name="monthlySalaryOverride" type="number" min="0" placeholder="optional" value="${adj.monthlySalaryOverride ?? ""}" /></label>
          <label class="field"><span>Payment method</span><input name="paymentMethod" value="${adj.paymentMethod || p.paymentMethod || ""}" /></label>
          <label class="field"><span>Payroll status</span><select name="payrollStatus">${statusOpts}</select></label>
          <label class="field"><span>Extra days</span><input name="extraDays" type="number" step="0.5" value="${adj.extraDays ?? 0}" /></label>
          <label class="field"><span>2-week hold</span><input name="twoWeekHold" type="checkbox" ${adj.twoWeekHold ? "checked" : ""} /></label>
          <label class="field"><span>Transport eligible</span><input name="transportEligible" type="checkbox" ${transportCheckboxChecked(state.month, adj) ? "checked" : ""} />
            <span class="muted" style="font-size:.75rem;display:block;margin-top:.25rem">${transportAllowedForMonth(state.month) ? "Default on from July 2026" : "June default off — check to enable for this agent"}</span></label>
          <label class="field"><span>No payroll this month</span><input name="noPayroll" type="checkbox" ${adj.noPayroll || p.noPayroll ? "checked" : ""} />
            <span class="muted" style="font-size:.75rem;display:block;margin-top:.25rem">Zeros net pay; attendance still counts</span></label>
          <label class="field"><span>Show payslip to agent</span><input name="payslipVisibleToAgent" type="checkbox" ${adj.payslipVisibleToAgent ? "checked" : ""} />
            <span class="muted" style="font-size:.75rem;display:block;margin-top:.25rem">Agent can view (not export) this month in My payslip</span></label>
          <label class="field"><span>Sales count (month)</span><input name="salesCount" type="number" min="0" step="1" value="${adj.salesCount ?? p.salesCount ?? 0}" /></label>
          ${canManagePayrollEvents() ? `<button type="button" class="btn btn-sm" id="recalc-sales-btn">Recalc from sales</button>` : ""}
          <label class="field" style="grid-column:1/-1"><span>Bank reference</span><input name="bankReference" value="${adj.bankReference || ""}" /></label>
          <label class="field" style="grid-column:1/-1"><span>Month notes</span><textarea name="monthNotes">${adj.monthNotes || p.monthNotes || ""}</textarea></label>
        </form>
        <button class="btn btn-primary btn-sm" id="save-adj-btn" style="margin-top:.5rem">Save month profile</button>
        <button class="btn btn-sm" id="emp-loans-btn" style="margin-top:.5rem;margin-left:.5rem">Loans</button>
      </div>
      <div class="card" style="margin-top:1rem">
        <div class="flex-between" style="margin-bottom:.75rem">
          <div>
            <h4 style="margin:0">Payment splits</h4>
            <p class="muted" style="margin:.25rem 0 0">Partial payments, defer remainder to a future month, or corrections — multiple splits per month allowed.</p>
          </div>
          <button class="btn btn-sm" id="defer-remainder-btn" type="button">Defer balance → next month</button>
          ${(data.splits || []).some((s) => s.status === "received")
            ? `<button class="btn btn-sm" id="export-splits-zip-btn" type="button">Export all splits (ZIP)</button>`
            : ""}
        </div>
        <div id="splits-list" class="stack">${(data.splits || []).length ? (data.splits || []).map((s) => `
          <div class="adj-row" data-split-id="${s.id}">
            <span>${splitStatusBadge(s.status)} <strong>${fmt(s.amount)}</strong> EGP
              ${s.splitKind === "correction" ? " (correction)" : s.splitKind === "training_bonus" ? " (training bonus)" : ""}
              ${s.status === "deferred" && s.deferToMonth ? ` → ${monthLabel(s.deferToMonth)}` : ""}
              ${s.notes ? ` · ${s.notes}` : ""}</span>
            <span class="btn-row">
              ${s.status === "pending" ? `<button class="btn btn-sm btn-primary" data-split-received="${s.id}">Mark received</button>` : ""}
              ${s.status === "pending" ? `<button class="btn btn-sm" data-split-defer="${s.id}">Defer</button>` : ""}
              ${s.status === "received" ? `<button class="btn btn-sm" data-split-pdf="${s.id}">Export PDF</button>` : ""}
              <button class="btn btn-sm btn-danger" data-split-del="${s.id}">Delete</button>
            </span>
          </div>`).join("") : '<p class="muted">No payment splits yet.</p>'}</div>
        <form id="split-form" class="field-grid" style="margin-top:.75rem">
          <label class="field"><span>Amount (EGP)</span><input name="amount" type="number" step="0.01" required /></label>
          <label class="field"><span>Type</span><select name="splitKind">
            <option value="payment">Payment</option>
            <option value="training_bonus">Training bonus</option>
            <option value="training_payroll">Training payroll</option>
            <option value="correction">Correction (+/−)</option>
          </select></label>
          <label class="field"><span>Status</span><select name="status">
            <option value="pending">Pending</option>
            <option value="received">Received</option>
            <option value="deferred">Defer to month</option>
          </select></label>
          <label class="field split-defer-field hidden"><span>Defer to month</span><input name="deferToMonth" type="month" value="${shiftMonth(state.month, 1)}" /></label>
          <label class="field" style="grid-column:1/-1"><span>Notes</span><input name="notes" placeholder="e.g. First installment, correction" /></label>
        </form>
        <button class="btn btn-primary btn-sm" id="add-split-btn" style="margin-top:.5rem">Add split</button>
      </div>
      <div id="payroll-history-panel" class="card hidden" style="margin-top:1rem"></div>
    </div>`,
    true
  );

  document.querySelectorAll("[data-hrms-nav]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      navigateToHrmsEmployeeSection(a.dataset.hrmsNav, a.dataset.employeeId);
    });
  });

  document.getElementById("pdf-slip-btn").onclick = async () => {
    try {
      await downloadFile(`/payslip/${employeeId}/pdf?month=${state.month}`, `payslip-${employeeId}-${state.month}.pdf`);
    } catch (e) {
      alert(e.message);
    }
  };
  document.getElementById("pdf-training-btn")?.addEventListener("click", async () => {
    try {
      await downloadFile(
        `/payslip/${employeeId}/pdf?month=${state.month}&kind=training`,
        `payslip-${employeeId}-${state.month}-training.pdf`
      );
    } catch (e) {
      alert(e.message);
    }
  });
  document.getElementById("pdf-agent-btn")?.addEventListener("click", async () => {
    try {
      await downloadFile(
        `/payslip/${employeeId}/pdf?month=${state.month}&kind=agent`,
        `payslip-${employeeId}-${state.month}-agent.pdf`
      );
    } catch (e) {
      alert(e.message);
    }
  });

  bindProfilePhotoUpload(employeeId, () => {
    openPayslipModal(employeeId);
  });

  document.getElementById("hist-slip-btn").onclick = async () => {
    const panel = document.getElementById("payroll-history-panel");
    if (!panel.classList.contains("hidden")) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    panel.innerHTML = '<p class="muted">Loading history…</p>';
    const hist = await api(`/payroll/history/${employeeId}?months=12`);
    panel.innerHTML = `<h4>Payroll history</h4>
      <div class="table-wrap"><table>
        <thead><tr><th>Month</th><th>Status</th><th>Payment</th><th class="text-right">Net</th><th class="text-right">Transport</th></tr></thead>
        <tbody>${hist.history.map((h) => `<tr>
          <td>${h.yearMonth}</td>
          <td>${payrollStatusBadge(h.payrollStatus)}</td>
          <td>${h.paymentMethod || "—"}</td>
          <td class="text-right">${fmt(h.netSalary)}</td>
          <td class="text-right">${fmt(h.transportAllowance)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  };

  const recalcBtn = document.getElementById("recalc-sales-btn");
  if (recalcBtn) {
    recalcBtn.onclick = async () => {
      recalcBtn.disabled = true;
      try {
        const res = await api(`/payroll-adjustments/${employeeId}/recalc-sales-count`, {
          method: "POST",
          body: JSON.stringify({ yearMonth: state.month }),
        });
        const input = document.querySelector('#adj-form input[name="salesCount"]');
        if (input) input.value = res.salesCount ?? 0;
        showSaveIndicator(`Sales count: ${res.salesCount ?? 0}`, "saved");
      } catch (e) {
        alert(e.message);
      } finally {
        recalcBtn.disabled = false;
      }
    };
  }

  document.getElementById("save-adj-btn").onclick = async () => {
    const btn = document.getElementById("save-adj-btn");
    const fd = new FormData(document.getElementById("adj-form"));
    btn.disabled = true;
    const prevLabel = btn.textContent;
    btn.textContent = "Saving…";
    try {
      await api(`/payroll-adjustments/${employeeId}`, {
        method: "PUT",
        body: JSON.stringify({
          yearMonth: state.month,
          position: fd.get("position"),
          salaryRaise: Number(fd.get("salaryRaise")) || 0,
          monthlySalaryOverride: fd.get("monthlySalaryOverride") || null,
          paymentMethod: fd.get("paymentMethod"),
          payrollStatus: fd.get("payrollStatus"),
          extraDays: Number(fd.get("extraDays")) || 0,
          twoWeekHold: fd.get("twoWeekHold") === "on",
          transportEligible: fd.get("transportEligible") === "on",
          salesCount: Number(fd.get("salesCount")) || 0,
          bankReference: fd.get("bankReference") || "",
          monthNotes: fd.get("monthNotes") || "",
          noPayroll: fd.get("noPayroll") === "on",
          payslipVisibleToAgent: fd.get("payslipVisibleToAgent") === "on",
        }),
      });
      closeModal();
      showSaveIndicator("Month profile saved", "saved");
      refreshPayrollRowAfterSave(employeeId);
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  };

  document.getElementById("emp-loans-btn").onclick = () => openEmployeeLoansModal(employeeId);

  const splitForm = document.getElementById("split-form");
  const splitStatusSel = splitForm?.querySelector("[name=status]");
  const deferField = splitForm?.querySelector(".split-defer-field");
  const splitAmountInput = splitForm?.querySelector("[name=amount]");
  const defaultBalance = p.remainingBalance ?? p.grossPayable ?? p.calculatedNet ?? p.netSalary;
  splitStatusSel?.addEventListener("change", () => {
    const isDeferred = splitStatusSel.value === "deferred";
    deferField?.classList.toggle("hidden", !isDeferred);
    if (isDeferred && splitAmountInput && !splitAmountInput.value) {
      splitAmountInput.value = String(Math.max(0, defaultBalance));
    }
  });

  document.getElementById("add-split-btn")?.addEventListener("click", async () => {
    const fd = new FormData(splitForm);
    try {
      await api("/payroll-splits", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          yearMonth: state.month,
          amount: Number(fd.get("amount")),
          splitKind: fd.get("splitKind") || "payment",
          status: fd.get("status") || "pending",
          deferToMonth: fd.get("status") === "deferred" ? fd.get("deferToMonth") : "",
          notes: fd.get("notes") || "",
        }),
      });
      openPayslipModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("defer-remainder-btn")?.addEventListener("click", async () => {
    const balance = p.remainingBalance ?? p.grossPayable ?? p.calculatedNet ?? p.netSalary;
    if (!(balance > 0)) return alert("No balance left to defer");
    openDeferAmountModal({
      title: "Defer remainder",
      message: `Maximum deferrable: ${fmt(balance)} EGP`,
      defaultMonth: shiftMonth(state.month, 1),
      defaultAmount: balance,
      maxAmount: balance,
      onSubmit: async ({ amount, deferToMonth }) => {
        await api("/payroll-splits", {
          method: "POST",
          body: JSON.stringify({
            employeeId,
            yearMonth: state.month,
            amount,
            status: "deferred",
            deferToMonth,
            notes: "Deferred remainder",
          }),
        });
        openPayslipModal(employeeId);
      },
    });
  });

  document.querySelectorAll("[data-split-pdf]").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await downloadFile(
          `/payslip/${encodeURIComponent(employeeId)}/pdf?month=${state.month}&splitId=${encodeURIComponent(btn.dataset.splitPdf)}`,
          `payslip-${employeeId}-${state.month}-split-${btn.dataset.splitPdf}.pdf`
        );
      } catch (e) {
        alert(e.message);
      }
    };
  });

  document.getElementById("export-splits-zip-btn")?.addEventListener("click", async () => {
    try {
      await downloadFile(
        `/payslip/${encodeURIComponent(employeeId)}/splits-zip?month=${state.month}`,
        `payslip-splits-${employeeId}-${state.month}.zip`
      );
    } catch (e) {
      alert(e.message);
    }
  });

  document.querySelectorAll("[data-split-received]").forEach((btn) => {
    btn.onclick = async () => {
      const split = (data.splits || []).find((s) => s.id === btn.dataset.splitReceived);
      if (!split) return;
      try {
        await api(`/payroll-splits/${split.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...split, status: "received" }),
        });
        closeModal();
        openPayslipModal(employeeId);
      } catch (e) {
        alert(e.message);
      }
    };
  });

  document.querySelectorAll("[data-split-defer]").forEach((btn) => {
    btn.onclick = () => {
      const split = (data.splits || []).find((s) => s.id === btn.dataset.splitDefer);
      if (!split) return;
      const maxAmount = p.remainingBalance != null ? p.remainingBalance + Number(split.amount || 0) : split.amount;
      openDeferAmountModal({
        title: "Defer split",
        message: `Defer payment of ${fmt(split.amount)} EGP (max ${fmt(maxAmount)} EGP)`,
        defaultMonth: shiftMonth(state.month, 1),
        defaultAmount: split.amount,
        maxAmount,
        onSubmit: async ({ amount, deferToMonth }) => {
          await api(`/payroll-splits/${split.id}`, {
            method: "PATCH",
            body: JSON.stringify({ ...split, status: "deferred", deferToMonth, amount }),
          });
          closeModal();
          openPayslipModal(employeeId);
        },
      });
    };
  });

  document.querySelectorAll("[data-split-del]").forEach((btn) => {
    btn.onclick = () => {
      openConfirmModal({
        title: "Delete split",
        message: "Delete this payment split?",
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          await api(`/payroll-splits/${btn.dataset.splitDel}`, { method: "DELETE" });
          closeModal();
          openPayslipModal(employeeId);
        },
      });
    };
  });

  document.getElementById("add-bonus-btn").onclick = async () => {
    const body = Object.fromEntries(new FormData(document.getElementById("bonus-form")));
    if (body.type === TL_BONUS_TYPE && !body.deductFromEmployeeId) {
      alert("Select which agent this TL bonus is deducted from.");
      return;
    }
    try {
      await api("/bonuses", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          employeeId,
          amount: Number(body.amount),
          deductFromEmployeeId: body.deductFromEmployeeId || undefined,
        }),
      });
      openPayslipModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  };
  const bonusTypeSel = document.getElementById("bonus-type");
  const deductWrap = document.getElementById("deduct-from-wrap");
  if (bonusTypeSel && deductWrap) {
    const toggleDeduct = () => {
      deductWrap.classList.toggle("hidden", bonusTypeSel.value !== TL_BONUS_TYPE);
    };
    bonusTypeSel.onchange = toggleDeduct;
    toggleDeduct();
  }
  document.getElementById("add-ded-btn").onclick = async () => {
    const body = Object.fromEntries(new FormData(document.getElementById("deduction-form")));
    try {
      await api("/deductions", {
        method: "POST",
        body: JSON.stringify({ ...body, employeeId, amount: Number(body.amount) }),
      });
      openPayslipModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  };

  document.querySelectorAll("[data-del-bonus]").forEach((btn) => {
    btn.onclick = () => {
      const payload = JSON.parse(btn.dataset.delBonus);
      openConfirmDeleteModal({
        title: "Delete bonus",
        message: `Delete ${payload.type} bonus on ${payload.date}?`,
        onConfirm: async () => {
          await api("/bonuses", { method: "DELETE", body: JSON.stringify(payload) });
          openPayslipModal(employeeId);
        },
      });
    };
  });
  document.querySelectorAll("[data-del-ded]").forEach((btn) => {
    btn.onclick = () => {
      const payload = JSON.parse(btn.dataset.delDed);
      openConfirmDeleteModal({
        title: "Delete deduction",
        message: `Delete ${payload.type} deduction on ${payload.date}?`,
        onConfirm: async () => {
          await api("/deductions", { method: "DELETE", body: JSON.stringify(payload) });
          openPayslipModal(employeeId);
        },
      });
    };
  });
}

async function renderEmployees(root) {
  const data = await api(`/employees${employeesQuery()}`);
  state.meta = data;
  root.__employeesData = data;

  const list = filterEmployeesList(data.employees);
  const showFilters = canUseEmployeeFilters();
  const showComplianceFilters = canViewEmployeeComplianceFilters();
  const showNatCol = canViewEmployeeNationality();
  const showComplianceCol = canViewEmployeeCompliance();
  const nationalities = data.nationalities || ["Egyptian", "Sudanese"];
  const baseColSpan = 7 + (showNatCol ? 1 : 0) + (showComplianceCol ? 1 : 0);

  root.innerHTML = `
    <div class="page-header">
      <div><h1>Employees</h1><p class="muted" id="emp-count">${list.length} shown</p></div>
      ${canAddEmployee() ? '<button class="btn btn-primary" id="add-emp">+ Add agent</button>' : ""}
    </div>
    ${showFilters ? `<div class="toolbar">
      ${pageSearchInputHtml("employees", "Search name, Arabic name, or ID…")}
      <select id="filter-status"><option value="">All statuses</option>${data.statuses.map((s) =>
        `<option value="${s}" ${state.empFilter.status === s ? "selected" : ""}>${s || "(blank)"}</option>`
      ).join("")}</select>
      <select id="filter-unit"><option value="">All units</option>${data.units.map((u) =>
        `<option value="${u}" ${state.empFilter.unit === u ? "selected" : ""}>${u}</option>`
      ).join("")}</select>
      ${showComplianceFilters ? `<select id="filter-nationality"><option value="">All nationalities</option>${nationalities.map((n) =>
        `<option value="${escapeHtml(n)}" ${state.empFilter.nationality === n ? "selected" : ""}>${escapeHtml(n)}</option>`
      ).join("")}</select>
      <select id="filter-work-permit"><option value="">All work permits</option>
        <option value="have_permit" ${state.empFilter.workPermit === "have_permit" ? "selected" : ""}>Have permit</option>
        <option value="no_permit" ${state.empFilter.workPermit === "no_permit" ? "selected" : ""}>Don't have permit</option>
      </select>
      <select id="filter-insurance"><option value="">All insurance</option>
        <option value="insured" ${state.empFilter.insuranceStatus === "insured" ? "selected" : ""}>Insured</option>
        <option value="not_insured" ${state.empFilter.insuranceStatus === "not_insured" ? "selected" : ""}>Not insured</option>
      </select>` : ""}
      ${hideOutToggle()}
    </div>` : `<div class="toolbar">${pageSearchInputHtml("employees", "Search name, Arabic name, or ID…")}</div>`}
    <div class="table-wrap"><table>
      <thead><tr><th>Employee</th><th>ID</th><th>Unit</th><th>Team</th><th>Position</th>${showNatCol ? "<th>Nationality</th>" : ""}${showComplianceCol ? "<th>Permit / Insurance</th>" : ""}<th>Status</th><th></th></tr></thead>
      <tbody id="emp-tbody">${list.map(employeeListRowHtml).join("")}</tbody>
    </table></div>`;
  root.__empColSpan = baseColSpan;

  root.querySelector("#add-emp")?.addEventListener("click", () => openAddAgentWizard());
  bindTabSearch(root, "employees", () => updateEmployeesTable(root));
  if (showFilters) {
    bindHideOut(root);
    root.querySelector("#filter-status")?.addEventListener("change", (e) => {
      state.empFilter.status = e.target.value;
      updateEmployeesTable(root);
    });
    root.querySelector("#filter-unit")?.addEventListener("change", (e) => {
      state.empFilter.unit = e.target.value;
      updateEmployeesTable(root);
    });
    if (showComplianceFilters) {
      root.querySelector("#filter-nationality")?.addEventListener("change", (e) => {
        state.empFilter.nationality = e.target.value;
        updateEmployeesTable(root);
      });
      root.querySelector("#filter-work-permit")?.addEventListener("change", (e) => {
        state.empFilter.workPermit = e.target.value;
        updateEmployeesTable(root);
      });
      root.querySelector("#filter-insurance")?.addEventListener("change", (e) => {
        state.empFilter.insuranceStatus = e.target.value;
        updateEmployeesTable(root);
      });
    }
  }
  bindEmployeesTableActions(root, data.employees);
}

async function renderAttendance(root) {
  const q = buildApiQuery({ month: state.month, unit: state.unit || "", team: state.team || "" });
  const data = await api(`/attendance?${q}`);
  const recordMap = new Map(data.records.map((r) => [`${r.employeeId}|${r.date}`, r]));
  const summaryMap = new Map(data.summaries.map((s) => [s.employeeId, s]));
  const calMap = new Map((data.calendar || []).map((c) => [c.date, c]));
  const ctx = {
    data,
    days: data.days,
    statuses: data.statuses,
    canEdit: data.canEdit,
    recordMap,
    summaryMap,
    calMap,
  };
  root.__attendanceCtx = ctx;

  let employees = data.employees;
  if (getTabSearch("attendance")) {
    employees = employees.filter((e) => matchesEmployeeSearch(e, getTabSearch("attendance")));
  }

  const federalHolidays = (data.holidays || []).filter((h) => h.country !== "EGY" && h.active !== false);
  const attEditable = data.canEdit && canEditAttendance();
  const transportHint = canViewTransportControls()
    ? `<p class="muted" style="grid-column:1/-1;margin:0">Half days, lateness, and quarter days: use the transport dropdown to grant full or half transport allowance for that day only.</p>`
    : "";
  const editToolbar = attEditable
    ? `${pageSearchInputHtml("attendance", "Search name, Arabic name, or ID…")}
    <select id="unit-filter"><option value="">All units</option>${(data.units || []).map((u) =>
      `<option value="${u}" ${state.unit === u ? "selected" : ""}>${u}</option>`
    ).join("")}</select>
    <select id="team-filter"><option value="">All teams</option>${(data.teams || []).map((t) =>
      `<option value="${t}" ${state.team === t ? "selected" : ""}>${t}</option>`
    ).join("")}</select>
    <label>Working days <input type="number" id="wd-input" min="1" max="31" value="${data.workingDays || 22}" style="width:4rem" /></label>
    <button class="btn" id="save-wd">Save</button>
    <button class="btn" id="init-month">Init weekends</button>
    <button class="btn" id="bulk-attended">Mark weekdays Attended</button>
    <select id="bulk-agent-select" title="Agent for month mark"><option value="">Agent…</option>${employees.map((e) =>
      `<option value="${e.id}">${escapeHtml(e.id)} — ${escapeHtml(e.name)}</option>`
    ).join("")}</select>
    <button class="btn" id="bulk-agent-month" title="Mark all weekdays Attended for selected agent">Mark month Attended</button>
    ${federalHolidays.length ? federalHolidays.map((h) => {
      const d = String(h.date || h.holidayDate || "").slice(0, 10);
      return `<button class="btn btn-sm" data-federal-off="${d}" title="Mark Day-OFF for all active agents">Federal OFF: ${escapeHtml(h.name || d)}</button>`;
    }).join("") : ""}
    <button class="btn btn-primary" id="import-fp-btn">Import FP file</button><button class="btn" id="fp-rules-btn">FP rules</button>
    ${hideOutToggle()}
    ${transportHint}`
    : pageSearchInputHtml("attendance", "Search name, Arabic name, or ID…");

  root.innerHTML = `
    <div class="page-header"><div><h1>Attendance</h1><p class="muted" id="att-emp-count">${employees.length} employees · ${monthLabel(state.month)}</p></div></div>
    ${window.HRMSFeatures?.attendanceBannersHtml(data) || ""}
    ${monthToolbar(editToolbar)}
    <div class="table-wrap attendance-grid"><table>
      <thead><tr>
        <th class="att-sticky att-sticky-id">ID</th><th class="att-sticky att-sticky-name">Name</th><th class="att-sticky att-sticky-team">Team</th>
        <th class="text-center">Work</th><th class="text-center">Late</th><th class="text-center">Ded.</th>
        ${data.days.map((d) => {
          const cal = calMap.get(d);
          const label = cal ? dayHeader(cal) : d.slice(8);
          const dayCls = window.HRMSFeatures?.attendanceDayClass(d, data) || (isWeekend(d) ? "weekend-col" : "");
          const holidayName = window.HRMSFeatures?.attendanceDayHolidayName(d, data) || "";
          const dayTitle = holidayName ? (window.HRMSFeatures?.attendanceDayTitle(d, data) || holidayName) : (window.HRMSFeatures?.attendanceDayTitle(d, data) || "");
          const holidayLine = holidayName
            ? `<div class="att-holiday-head-name">${escapeHtml(holidayName)}</div>`
            : "";
          return `<th class="text-center att-day-head ${dayCls}"${dayTitle ? ` title="${escapeHtml(dayTitle)}"` : ""}>
            <div class="att-day-head-label">${label}</div>${holidayLine}</th>`;
        }).join("")}
      </tr></thead>
      <tbody id="att-tbody">${employees.map((emp) => attendanceEmployeeRowHtml(emp, ctx)).join("")}</tbody>
    </table></div>`;

  bindMonthNav(root);
  if (attEditable) bindHideOut(root);
  bindTabSearch(root, "attendance", () => updateAttendanceTable(root));
  if (attEditable) {
  root.querySelector("#unit-filter").onchange = (e) => {
    state.unit = e.target.value;
    state.team = "";
    render();
  };
  root.querySelector("#team-filter").onchange = (e) => {
    state.team = e.target.value;
    render();
  };
  root.querySelector("#save-wd").onclick = async () => {
    await api("/attendance/working-days", {
      method: "PUT",
      body: JSON.stringify({ month: state.month, workingDays: root.querySelector("#wd-input").value }),
    });
  };
  root.querySelector("#init-month").onclick = async () => {
    await api("/attendance/init-month", { method: "PATCH", body: JSON.stringify({ month: state.month }) });
    render();
  };
  root.querySelector("#bulk-attended").onclick = async () => {
    if (!confirm("Mark all visible weekday cells as Attended?")) return;
    await api("/attendance/bulk-weekdays", {
      method: "PATCH",
      body: JSON.stringify({ month: state.month, status: "Attended", unit: state.unit, team: state.team }),
    });
    render();
  };
  root.querySelector("#bulk-agent-month")?.addEventListener("click", async () => {
    const employeeId = root.querySelector("#bulk-agent-select")?.value;
    if (!employeeId) {
      alert("Select an agent first.");
      return;
    }
    if (!confirm(`Mark all weekdays in ${monthLabel(state.month)} as Attended for ${employeeId}?`)) return;
    try {
      await api("/attendance/bulk-agent-month", {
        method: "PATCH",
        body: JSON.stringify({ month: state.month, employeeId, status: "Attended" }),
      });
      render();
    } catch (e) {
      alert(e.message);
    }
  });
  root.querySelectorAll("[data-federal-off]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const date = btn.dataset.federalOff;
      openConfirmModal({
        title: "Federal day off",
        message: `Mark ${date} as Day-OFF for all active agents?`,
        confirmLabel: "Apply",
        onConfirm: async () => {
          const res = await api("/hrms/attendance/bulk-dayoff", {
            method: "POST",
            body: JSON.stringify({ date, scope: "federal_active" }),
          });
          showSaveIndicator(`Day-OFF set for ${res.count} agents`, "saved");
          render();
        },
      });
    });
  });
  root.querySelector("#import-fp-btn")?.addEventListener("click", () => openFpImportModal());
  root.querySelector("#fp-rules-btn")?.addEventListener("click", () => openFpRulesModal());
  bindAttendanceGridEvents(root, ctx);
  }
}

async function fileToBase64Att(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openFpImportModal() {
  openModal(`
    <div class="modal-header"><h2>Import fingerprint attendance — ${monthLabel(state.month)}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <form id="fp-import-form" class="modal-body field-grid">
      <label class="field" style="grid-column:1/-1"><span>CSV or XLS export from device</span>
        <input type="file" name="file" accept=".csv,.xls,.xlsx" required /></label>
      <label class="field"><span>On conflict</span>
        <select name="overwritePolicy">
          <option value="skip_manual">Skip days with manual edits</option>
          <option value="overwrite">Overwrite all</option>
        </select></label>
      <div class="form-actions" style="grid-column:1/-1">
        <button type="button" class="btn" id="fp-preview-btn">Preview</button>
        <button type="submit" class="btn btn-primary">Apply import</button>
      </div>
      <div id="fp-preview-area" class="table-wrap" style="grid-column:1/-1;max-height:16rem;overflow:auto"></div>
    </form>`, true);
  let lastPreview = null;
  document.getElementById("fp-preview-btn").onclick = async (e) => {
    e.preventDefault();
    const fd = new FormData(document.getElementById("fp-import-form"));
    const file = fd.get("file");
    if (!file?.size) return alert("Choose a file first");
    try {
      const base64 = await fileToBase64Att(file);
      lastPreview = await api("/attendance/import", {
        method: "POST",
        body: JSON.stringify({
          month: state.month,
          base64,
          fileName: file.name,
          dryRun: true,
          overwritePolicy: fd.get("overwritePolicy"),
        }),
      });
      const area = document.getElementById("fp-preview-area");
      const rows = lastPreview.preview || [];
      area.innerHTML = rows.length
        ? `<table><thead><tr><th>FP</th><th>Date</th><th>In</th><th>Out</th><th>Status</th></tr></thead>
        <tbody>${rows.slice(0, 100).map((r) => `<tr><td>${escapeHtml(r.fpNumber || "")}</td><td>${r.date}</td><td>${r.checkIn || "—"}</td><td>${r.checkOut || "—"}</td><td>${escapeHtml(r.status)}</td></tr>`).join("")}</tbody></table>
        ${lastPreview.unmatchedFp?.length ? `<p class="muted">Unmatched FP IDs: ${lastPreview.unmatchedFp.join(", ")}</p>` : ""}`
        : "<p class='muted'>No rows matched this month.</p>";
    } catch (err) {
      alert(err.message);
    }
  };
  document.getElementById("fp-import-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get("file");
    if (!file?.size) return alert("Choose a file");
    if (!confirm(`Apply FP import for ${monthLabel(state.month)}?`)) return;
    try {
      const base64 = await fileToBase64Att(file);
      const res = await api("/attendance/import", {
        method: "POST",
        body: JSON.stringify({
          month: state.month,
          base64,
          fileName: file.name,
          dryRun: false,
          overwritePolicy: fd.get("overwritePolicy"),
        }),
      });
      closeModal();
      alert(`Imported ${res.rowsApplied || res.records?.length || 0} day(s). Skipped ${res.rowsSkipped || 0}.`);
      render();
    } catch (err) {
      alert(err.message);
    }
  };
}

async function openFpRulesModal() {
  const data = await api(`/attendance/fp-rules/${state.month}`);
  const r = data.rules?.checkIn || {};
  const o = data.rules?.checkOut || {};
  openModal(`
    <div class="modal-header"><h2>FP rules — ${monthLabel(state.month)}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <form id="fp-rules-form" class="modal-body field-grid">
      <h4 style="grid-column:1/-1">Check-in</h4>
      <label class="field"><span>On time before</span><input name="onTimeBefore" value="${r.onTimeBefore || "14:50"}" /></label>
      <label class="field"><span>Lateness A until</span><input name="latenessAUntil" value="${r.latenessAUntil || "15:00"}" /></label>
      <label class="field"><span>Lateness B until</span><input name="latenessBUntil" value="${r.latenessBUntil || "15:30"}" /></label>
      <label class="field"><span>Quarter day until</span><input name="quarterDayUntil" value="${r.quarterDayUntil || "17:00"}" /></label>
      <label class="field"><span>Half day after</span><input name="halfDayAfter" value="${r.halfDayAfter || "17:00"}" /></label>
      <h4 style="grid-column:1/-1">Check-out</h4>
      <label class="field"><span>Expected</span><input name="expected" value="${o.expected || "12:00"}" /></label>
      <label class="field"><span>Grace until</span><input name="graceUntil" value="${o.graceUntil || "13:00"}" /></label>
      <label class="field"><span>Half day from</span><input name="halfDayFrom" value="${o.halfDayFrom || "19:00"}" /></label>
      <label class="field"><span>Half day until</span><input name="halfDayUntil" value="${o.halfDayUntil || "22:00"}" /></label>
      <label class="field"><span>Quarter day from</span><input name="quarterDayFrom" value="${o.quarterDayFrom || "22:00"}" /></label>
      <label class="field"><span>Quarter day until</span><input name="quarterDayUntil" value="${o.quarterDayUntil || "23:55"}" /></label>
      <label class="field" style="grid-column:1/-1"><span>Note</span><textarea name="note" rows="2">${escapeHtml(o.note || "")}</textarea></label>
      <div class="form-actions" style="grid-column:1/-1"><button type="submit" class="btn btn-primary">Save rules</button></div>
    </form>`, true);
  document.getElementById("fp-rules-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const rules = {
      checkIn: {
        onTimeBefore: fd.get("onTimeBefore"),
        latenessAUntil: fd.get("latenessAUntil"),
        latenessBUntil: fd.get("latenessBUntil"),
        quarterDayUntil: fd.get("quarterDayUntil"),
        halfDayAfter: fd.get("halfDayAfter"),
      },
      checkOut: {
        expected: fd.get("expected"),
        graceUntil: fd.get("graceUntil"),
        halfDayFrom: fd.get("halfDayFrom"),
        halfDayUntil: fd.get("halfDayUntil"),
        quarterDayFrom: fd.get("quarterDayFrom"),
        quarterDayUntil: fd.get("quarterDayUntil"),
        note: fd.get("note"),
      },
    };
    try {
      await api(`/attendance/fp-rules/${state.month}`, { method: "PUT", body: JSON.stringify({ rules }) });
      closeModal();
      showSaveIndicator("FP rules saved", "saved");
    } catch (err) {
      alert(err.message);
    }
  };
}

async function renderPayroll(root) {
  const q = buildApiQuery({ month: state.month });
  const [data, tiersData] = await Promise.all([
    api(`/payroll?${q}`),
    api(`/commission-tiers?month=${state.month}`).catch(() => ({ tiers: [] })),
  ]);
  const tiers = tiersData.tiers || [];
  root.__payrollData = data;

  let payrollRows = filterPayrollByZeroNet(data.payroll);
  if (getTabSearch("payroll")) {
    payrollRows = payrollRows.filter((r) => matchesEmployeeSearch(r, getTabSearch("payroll")));
  }

  root.innerHTML = `
    <div class="page-header"><div><h1>Payroll</h1><p class="muted" id="payroll-emp-count">${payrollRows.length} employees · ${monthLabel(state.month)} · ${data.workingDays} working days · Transport 3,000 EGP/mo</p></div>
      <div class="btn-row">
        <button class="btn btn-sm btn-primary" id="init-month-profiles">Init month profiles</button>
        <button class="btn btn-sm" id="export-payroll-pdf">Export PDF</button>
        <button class="btn btn-sm" id="export-all-payslips" title="Save every payslip PDF into a folder">Export all payslips</button>
        <button class="btn btn-sm" id="record-loan-payments">Record loan payments</button>
        <button class="btn btn-sm" id="manage-loans-btn">Loans</button>
        ${isChangesViewer() ? `
        <button class="btn btn-sm" id="export-cash-csv" title="Cash payroll sheet (CSV)">Cash CSV</button>
        <button class="btn btn-sm" id="export-cash-pdf" title="Cash payroll sheet (PDF)">Cash PDF</button>
        <button class="btn btn-sm" id="export-insta-csv" title="Instapay / wallet sheet (CSV)">Instapay CSV</button>
        <button class="btn btn-sm" id="export-insta-pdf" title="Instapay / wallet sheet (PDF)">Instapay PDF</button>
        <button class="btn btn-sm" id="export-bank-csv" title="Bank payroll sheet (CSV)">Bank CSV</button>
        <button class="btn btn-sm" id="export-bank-pdf" title="Bank payroll sheet (PDF)">Bank PDF</button>` : ""}
      </div>
    </div>
    ${monthToolbar(`${pageSearchInputHtml("payroll", "Search name, Arabic name, or ID…")}${hideOutToggle()}
    <label class="toggle-label"><input type="checkbox" id="hide-zero-net" ${state.hideZeroNet ? "checked" : ""} /> Hide zero net pay</label>`)}
    <div class="card" style="margin-bottom:1rem">
      <div class="flex-between" style="margin-bottom:.75rem">
        <div><h3 style="margin:0">Sales commission targets</h3>
          <p class="muted" style="margin:.25rem 0 0">Stackable tiers — e.g. 16+ → 5,000 EGP and 20+ → +2,000 EGP (21 sales = 7,000 EGP)</p></div>
        <button class="btn btn-sm btn-primary" id="save-tiers-btn">Save targets</button>
      </div>
      <div id="tiers-editor" class="stack">${tiers.length ? tiers.map((t, i) => tierRowHtml(t, i)).join("") : tierRowHtml({}, 0)}</div>
      <button class="btn btn-sm" id="add-tier-btn" style="margin-top:.5rem">+ Add tier</button>
    </div>
    <div class="grid-4">
      <div class="card card-stat"><strong>${fmt(data.totals.totalBasic)}</strong><span class="muted">Basic (EGP)</span></div>
      <div class="card card-stat"><strong>${fmt(data.totals.totalBonuses)}</strong><span class="muted">Bonuses</span></div>
      <div class="card card-stat"><strong>${fmt(data.totals.totalDeductions)}</strong><span class="muted">Deductions</span>${data.totals.totalBonusTransfers ? `<span class="muted" style="display:block;font-size:.75rem;margin-top:.2rem">Agent bonuses from payroll: ${fmt(data.totals.totalBonusTransfers)} (not in deductions)</span>` : ""}</div>
      <div class="card card-stat"><strong>${fmt(data.totals.totalNet)}</strong><span class="muted">Net payroll</span></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Employee</th><th>Status</th><th>Sales</th><th>Commission</th><th>Payment</th><th>Days</th><th class="text-right">Basic</th>
        <th class="text-right">Transport</th><th class="text-right">Loan</th><th class="text-right">Net</th><th></th></tr></thead>
      <tbody id="payroll-tbody">${payrollRows.map(payrollRowHtml).join("")}</tbody>
      <tfoot>
      <tr class="totals-row"><td colspan="6"><strong>Totals</strong></td>
        <td class="text-right"><strong>${fmt(data.totals.totalBasic)}</strong></td>
        <td class="text-right"><strong>${fmt(data.payroll.reduce((s, r) => s + (r.transportAllowance || 0), 0))}</strong></td>
        <td class="text-right"><strong>-${fmt(data.payroll.reduce((s, r) => s + (r.loanDeductionTotal || 0), 0))}</strong></td>
        <td class="text-right"><strong>${fmt(data.totals.totalNet)}</strong></td><td></td></tr>
      </tfoot>
    </table></div>`;

  bindMonthNav(root);
  bindHideOut(root);
  root.querySelector("#hide-zero-net")?.addEventListener("change", (e) => {
    state.hideZeroNet = e.target.checked;
    updatePayrollTable(root);
  });
  bindTabSearch(root, "payroll", () => updatePayrollTable(root), 180);

  let tierIndex = tiers.length || 1;
  root.querySelector("#add-tier-btn").onclick = () => {
    const editor = root.querySelector("#tiers-editor");
    editor.insertAdjacentHTML("beforeend", tierRowHtml({}, tierIndex++));
  };
  root.querySelector("#save-tiers-btn").onclick = async () => {
    const rows = [...root.querySelectorAll(".tier-row")];
    const payload = rows
      .map((row) => ({
        minSales: Number(row.querySelector("[name=minSales]").value) || 0,
        bonusAmount: Number(row.querySelector("[name=bonusAmount]").value) || 0,
        label: row.querySelector("[name=label]").value || "",
      }))
      .filter((t) => t.minSales > 0 && t.bonusAmount > 0);
    try {
      await api("/commission-tiers", {
        method: "PUT",
        body: JSON.stringify({ month: state.month, tiers: payload }),
      });
      alert("Commission targets saved");
      renderPayroll(root);
    } catch (e) {
      alert(e.message);
    }
  };

  root.querySelector("#export-payroll-pdf").onclick = async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    try {
      await downloadFile(`/payroll/pdf?${buildApiQuery({ month: state.month })}`, `payroll-${state.month}.pdf`);
    } catch (err) {
      alert(err.message);
    } finally {
      setButtonLoading(btn, false);
    }
  };
  root.querySelector("#export-all-payslips")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    try {
      await bulkExportAllPayslips(payrollRows);
    } catch (err) {
      alert(err.message);
    } finally {
      setButtonLoading(btn, false);
    }
  });
  root.querySelector("#record-loan-payments").onclick = async () => {
    if (!confirm(`Record loan installment payments for ${monthLabel(state.month)}?`)) return;
    try {
      const res = await api("/payroll/record-loan-payments", {
        method: "POST",
        body: JSON.stringify({ month: state.month }),
      });
      alert(`Recorded ${res.count} loan payment(s)`);
      render();
    } catch (e) {
      alert(e.message);
    }
  };
  root.querySelector("#manage-loans-btn").onclick = () => openLoansManagerModal();

  root.querySelector("#init-month-profiles").onclick = async () => {
    if (!confirm(`Create month profiles for ${monthLabel(state.month)} from employee master / previous month?`)) return;
    const res = await api("/payroll-adjustments/init-month", {
      method: "POST",
      body: JSON.stringify({ month: state.month }),
    });
    alert(`Created ${res.count} month profiles`);
    render();
  };
  const bindPaymentExport = (id, method, format) => {
    root.querySelector(id)?.addEventListener("click", () => {
      const ext = format === "pdf" ? "pdf" : "csv";
      const name = method === "insta" ? "instapay" : method;
      downloadFile(
        `/exports/payments?${buildApiQuery({ month: state.month, method, format })}`,
        `${name}-${state.month}.${ext}`
      ).catch((e) => alert(e.message));
    });
  };
  bindPaymentExport("#export-cash-csv", "cash", "csv");
  bindPaymentExport("#export-cash-pdf", "cash", "pdf");
  bindPaymentExport("#export-insta-csv", "insta", "csv");
  bindPaymentExport("#export-insta-pdf", "insta", "pdf");
  bindPaymentExport("#export-bank-csv", "bank", "csv");
  bindPaymentExport("#export-bank-pdf", "bank", "pdf");
  bindPayrollRowClicks(root);
  window.HRMSFeatures?.enhancePayroll(root, api, state, {
    downloadFile,
    monthLabel,
    fmt,
    isChangesViewer,
    render,
  }).catch(() => {});
}

function tierRowHtml(tier = {}, index = 0) {
  return `<div class="tier-row field-grid" style="align-items:end;margin-bottom:.5rem" data-idx="${index}">
    <label class="field"><span>Min sales</span><input name="minSales" type="number" min="1" value="${tier.minSales ?? ""}" placeholder="16" /></label>
    <label class="field"><span>Bonus (EGP)</span><input name="bonusAmount" type="number" min="0" value="${tier.bonusAmount ?? ""}" placeholder="5000" /></label>
    <label class="field" style="grid-column:span 2"><span>Label</span><input name="label" value="${tier.label || ""}" placeholder="16+ sales secure 5000 EGP" /></label>
  </div>`;
}

async function openEmployeeLoansModal(employeeId) {
  const data = await api(`/loans?employeeId=${employeeId}`);
  const loanList = data.loans || [];
  const loans = loanList
    .map(
      (l) => `<div class="card card-flat">
      <div class="flex-between"><strong>${fmt(l.totalAmount)} EGP</strong><span class="badge">${l.status}</span></div>
      <div class="muted">${l.installmentAmount} EGP × ${l.installmentsCount} · paid ${l.installmentsPaid || 0}</div>
      <div class="muted">Starts ${l.startYearMonth}${l.skipCurrentMonth ? " (skipped creation month)" : ""}</div>
      ${l.notes ? `<p style="margin:.35rem 0 0">${l.notes}</p>` : ""}
      <div class="btn-row" style="margin-top:.5rem">
        ${l.status === "active" ? `<button class="btn btn-sm" data-loan-edit="${l.id}">Edit</button>` : ""}
        ${l.status === "active" ? `<button class="btn btn-sm" data-loan-cancel="${l.id}">Cancel</button>` : ""}
        ${!(l.installmentsPaid > 0) && l.status !== "completed" ? `<button class="btn btn-sm btn-danger" data-loan-delete="${l.id}">Delete</button>` : ""}
      </div>
    </div>`
    )
    .join("");

  openModal(
    `<div class="modal-header"><h2>Loans — ${employeeId}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      <div class="stack">${loans || '<p class="muted">No loans for this employee.</p>'}</div>
      <div class="card" style="margin-top:1rem">
        <h4>Request loan</h4>
        <p class="muted" style="margin:.25rem 0 .5rem">Submitted to Mark / Phoebe / Raymond for approval before payroll deductions start.</p>
        <form id="loan-form" class="field-grid">
          <label class="field"><span>Total amount (EGP)</span><input name="totalAmount" type="number" min="1" required /></label>
          <label class="field"><span>Per salary (EGP)</span><input name="installmentAmount" type="number" min="1" placeholder="500" /></label>
          <label class="field"><span>Number of salaries</span><input name="installmentsCount" type="number" min="1" placeholder="2" /></label>
          <label class="field"><span>Skip current payroll</span><input name="skipCurrentMonth" type="checkbox" title="Start deductions from next month" /></label>
          <label class="field" style="grid-column:1/-1"><span>Notes</span><input name="notes" /></label>
        </form>
        <p class="muted" style="margin:.5rem 0 0">Enter either per-salary amount or number of salaries (e.g. 1,000 loan → 500 × 2 salaries).</p>
        <button class="btn btn-primary btn-sm" id="save-loan-btn" style="margin-top:.5rem">Submit loan request</button>
      </div>
    </div>`,
    true
  );

  document.getElementById("save-loan-btn").onclick = async () => {
    const fd = new FormData(document.getElementById("loan-form"));
    try {
      await api("/loan-requests", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          totalAmount: Number(fd.get("totalAmount")),
          installmentAmount: fd.get("installmentAmount") ? Number(fd.get("installmentAmount")) : null,
          installmentsCount: fd.get("installmentsCount") ? Number(fd.get("installmentsCount")) : null,
          skipCurrentMonth: fd.get("skipCurrentMonth") === "on",
          notes: fd.get("notes") || "",
          createdYearMonth: state.month,
        }),
      });
      closeModal();
      alert("Loan request submitted for executive approval.");
      openEmployeeLoansModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  };

  document.querySelectorAll("[data-loan-edit]").forEach((btn) => {
    btn.onclick = () => {
      const loan = loanList.find((l) => l.id === btn.dataset.loanEdit);
      if (loan) openLoanEditModal(employeeId, loan);
    };
  });
  document.querySelectorAll("[data-loan-cancel]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Cancel this loan? No further deductions will be scheduled.")) return;
      try {
        await api(`/loans/${btn.dataset.loanCancel}/cancel`, { method: "POST" });
        closeModal();
        openEmployeeLoansModal(employeeId);
      } catch (e) {
        alert(e.message);
      }
    };
  });
  document.querySelectorAll("[data-loan-delete]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this loan permanently?")) return;
      try {
        await api(`/loans/${btn.dataset.loanDelete}`, { method: "DELETE" });
        closeModal();
        openEmployeeLoansModal(employeeId);
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

function openLoanEditModal(employeeId, loan) {
  const locked = (loan.installmentsPaid || 0) > 0;
  openModal(
    `<div class="modal-header"><h2>Edit loan</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      ${locked ? '<p class="alert alert-warn">Payments already recorded — only notes can be changed.</p>' : ""}
      <form id="loan-edit-form" class="field-grid">
        <label class="field"><span>Total amount (EGP)</span><input name="totalAmount" type="number" min="1" value="${loan.totalAmount}" ${locked ? "readonly" : ""} required /></label>
        <label class="field"><span>Per salary (EGP)</span><input name="installmentAmount" type="number" min="1" value="${loan.installmentAmount}" ${locked ? "readonly" : ""} /></label>
        <label class="field"><span>Number of salaries</span><input name="installmentsCount" type="number" min="1" value="${loan.installmentsCount}" ${locked ? "readonly" : ""} /></label>
        <label class="field"><span>Skip creation month</span><input name="skipCurrentMonth" type="checkbox" ${loan.skipCurrentMonth ? "checked" : ""} ${locked ? "disabled" : ""} /></label>
        <label class="field" style="grid-column:1/-1"><span>Notes</span><input name="notes" value="${escapeHtml(loan.notes || "")}" /></label>
      </form>
      <div class="btn-row" style="margin-top:1rem">
        <button class="btn" data-close>Back</button>
        <button class="btn btn-primary" id="save-loan-edit-btn">Save changes</button>
      </div>
    </div>`,
    true
  );

  document.getElementById("save-loan-edit-btn").onclick = async () => {
    const fd = new FormData(document.getElementById("loan-edit-form"));
    const body = locked
      ? { notes: fd.get("notes") || "" }
      : {
          totalAmount: Number(fd.get("totalAmount")),
          installmentAmount: fd.get("installmentAmount") ? Number(fd.get("installmentAmount")) : null,
          installmentsCount: fd.get("installmentsCount") ? Number(fd.get("installmentsCount")) : null,
          skipCurrentMonth: fd.get("skipCurrentMonth") === "on",
          notes: fd.get("notes") || "",
        };
    try {
      await api(`/loans/${loan.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      closeModal();
      if (state.page === "loans") render();
      else openEmployeeLoansModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  };
  document.querySelectorAll("[data-close]").forEach((b) => {
    b.onclick = () => {
      closeModal();
      if (state.page === "loans") render();
      else openEmployeeLoansModal(employeeId);
    };
  });
}

async function openLoansManagerModal() {
  const data = await api("/loans");
  const loanList = data.loans || [];
  const active = loanList.filter((l) => l.status === "active");
  const list = active
    .map(
      (l) => `<tr>
        <td>${l.employeeId}</td>
        <td class="text-right">${fmt(l.totalAmount)}</td>
        <td class="text-right">${fmt(l.installmentAmount)}</td>
        <td>${l.installmentsPaid || 0} / ${l.installmentsCount}</td>
        <td>${l.startYearMonth}</td>
        <td>${l.notes || "—"}</td>
        <td><button class="btn btn-sm" data-loan-mgr-edit="${l.id}">Edit</button></td>
      </tr>`
    )
    .join("");

  openModal(
    `<div class="modal-header"><h2>Active loans (${active.length})</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th class="text-right">Total</th><th class="text-right">Installment</th><th>Paid</th><th>Starts</th><th>Notes</th><th></th></tr></thead>
        <tbody>${list || '<tr><td colspan="7" class="muted">No active loans</td></tr>'}</tbody>
      </table></div>
      <p class="muted" style="margin-top:1rem">Create loans from an employee payslip → Loans. Use "Record loan payments" on payroll when salaries are paid.</p>
    </div>`,
    true
  );

  document.querySelectorAll("[data-loan-mgr-edit]").forEach((btn) => {
    btn.onclick = () => {
      const loan = loanList.find((l) => l.id === btn.dataset.loanMgrEdit);
      if (loan) openLoanEditModal(loan.employeeId, loan);
    };
  });
}

async function bulkExportAllPayslips(payrollRows) {
  if (!window.hrDesktop?.pickFolder) {
    alert("Bulk payslip export requires the Hangup Portal desktop app.");
    return;
  }
  if (!payrollRows.length) {
    alert("No payroll rows to export.");
    return;
  }
  const folder = await window.hrDesktop.pickFolder();
  if (!folder) return;
  const subfolder = `${folder}\\${monthPayrollFolderName(state.month)}`;
  const sessionId = getSessionId();
  let ok = 0;
  for (const row of payrollRows) {
    const res = await fetch(`/api/payslip/${row.employeeId}/pdf?month=${state.month}`, {
      headers: sessionId ? { "x-session-id": sessionId } : {},
    });
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok) continue;
    const buf = await res.arrayBuffer();
    const safeName = String(row.name || row.employeeId)
      .replace(/[^\w\s-]+/g, "")
      .trim()
      .replace(/\s+/g, "-");
    await window.hrDesktop.writeFileBuffer(`${subfolder}\\payslip-${row.employeeId}-${safeName}.pdf`, buf);
    ok++;
  }
  alert(`Exported ${ok} payslip PDF(s) to:\n${subfolder}`);
}

async function openBonusEditModal(bonus, employees, bonusTypes) {
  const deductFrom = parseTlSourceFromReason(bonus.reason);
  const cleanReason = String(bonus.reason || "")
    .replace(/\s*\(deducted from[^)]+\)\s*/i, "")
    .trim();
  openModal(
    `<div class="modal-header"><h2>Edit bonus</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      <form id="bonus-edit-form" class="field-grid">
        <label class="field"><span>Employee</span><select name="employeeId" required>${employeeSelectOptions(employees, bonus.employeeId)}</select></label>
        <label class="field"><span>Date</span><input name="date" type="date" value="${bonus.date}" required /></label>
        <label class="field"><span>Type</span><select name="type" id="bonus-edit-type">${bonusTypes.map((t) => `<option value="${t}" ${bonus.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="field"><span>Amount (EGP)</span><input name="amount" type="number" min="0" step="0.01" value="${bonus.amount}" required /></label>
        <label class="field hidden" id="bonus-edit-deduct-wrap" style="grid-column:1/-1"><span>Deduct from agent (TL pays)</span>
          <select name="deductFromEmployeeId">${employeeSelectOptionsForTlDeduct(employees, deductFrom)}</select></label>
        <label class="field" style="grid-column:1/-1"><span>Reason</span><input name="reason" value="${escapeHtml(cleanReason)}" /></label>
      </form>
      <div class="btn-row" style="margin-top:1rem">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="save-bonus-edit-btn">Save</button>
      </div>
    </div>`,
    true
  );
  const typeSel = document.getElementById("bonus-edit-type");
  const deductWrap = document.getElementById("bonus-edit-deduct-wrap");
  const toggleDeduct = () => deductWrap?.classList.toggle("hidden", typeSel.value !== TL_BONUS_TYPE);
  typeSel.onchange = toggleDeduct;
  toggleDeduct();
  document.getElementById("save-bonus-edit-btn").onclick = async () => {
    const fd = new FormData(document.getElementById("bonus-edit-form"));
    const body = Object.fromEntries(fd);
    if (body.type === TL_BONUS_TYPE && !body.deductFromEmployeeId) {
      alert("Select which agent this TL bonus is deducted from.");
      return;
    }
    try {
      await api("/bonuses", {
        method: "PATCH",
        body: JSON.stringify({
          originalEmployeeId: bonus.employeeId,
          originalDate: bonus.date,
          originalType: bonus.type,
          employeeId: body.employeeId,
          date: body.date,
          amount: Number(body.amount),
          reason: body.reason,
          type: body.type,
          deductFromEmployeeId: body.deductFromEmployeeId || undefined,
        }),
      });
      closeModal();
      render();
    } catch (e) {
      alert(e.message);
    }
  };
}

async function openDeductionEditModal(deduction, employees, deductionTypes) {
  openModal(
    `<div class="modal-header"><h2>Edit deduction</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      <form id="deduction-edit-form" class="field-grid">
        <label class="field"><span>Employee</span><select name="employeeId" required>${employeeSelectOptions(employees, deduction.employeeId)}</select></label>
        <label class="field"><span>Date</span><input name="date" type="date" value="${deduction.date}" required /></label>
        <label class="field"><span>Type</span><select name="type">${deductionTypes.map((t) => `<option value="${t}" ${deduction.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="field"><span>Amount (EGP)</span><input name="amount" type="number" min="0" step="0.01" value="${deduction.amount}" required /></label>
        <label class="field" style="grid-column:1/-1"><span>Reason</span><input name="reason" value="${escapeHtml(deduction.reason || "")}" /></label>
      </form>
      <div class="btn-row" style="margin-top:1rem">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="save-ded-edit-btn">Save</button>
      </div>
    </div>`,
    true
  );
  document.getElementById("save-ded-edit-btn").onclick = async () => {
    const fd = new FormData(document.getElementById("deduction-edit-form"));
    const body = Object.fromEntries(fd);
    try {
      await api("/deductions", {
        method: "PATCH",
        body: JSON.stringify({
          originalEmployeeId: deduction.employeeId,
          originalDate: deduction.date,
          originalType: deduction.type,
          employeeId: body.employeeId,
          date: body.date,
          amount: Number(body.amount),
          reason: body.reason,
          type: body.type,
        }),
      });
      closeModal();
      render();
    } catch (e) {
      alert(e.message);
    }
  };
}

async function renderBonuses(root) {
  const reqs = [
    api(`/bonuses?${buildApiQuery({ month: state.month })}`),
    api(`/employees${employeesQuery()}`),
  ];
  if (canSubmitBonusRequest() || canApproveBonusRequest()) {
    reqs.push(api(`/bonus-requests?month=${state.month}&status=pending`).catch(() => ({ requests: [] })));
  }
  const [bonusData, empData, reqData] = await Promise.all(reqs);
  const employees = empData.employees || [];
  const empById = new Map(employees.map((e) => [e.id, e]));
  const bonuses = (bonusData.bonuses || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const requests = reqData?.requests || [];
  const canEdit = canManagePayrollEvents();

  const requestSection =
    requests.length || canSubmitBonusRequest()
      ? `<div class="card" style="margin-bottom:1rem">
      <h3>Bonus requests ${canApproveBonusRequest() ? "(pending approval)" : ""}</h3>
      ${canSubmitBonusRequest() ? '<button class="btn btn-sm" id="submit-bonus-req">+ Request bonus for agent</button>' : ""}
      <table style="margin-top:.5rem"><thead><tr><th>Date</th><th>Agent</th><th>Amount</th><th>Type</th><th>By</th>${canApproveBonusRequest() ? "<th></th>" : ""}</tr></thead>
      <tbody>${requests.length ? requests.map((r) => `<tr>
        <td>${r.date}</td><td>${r.employeeId}</td><td>${fmt(r.amount)}</td><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.submittedBy)}</td>
        ${canApproveBonusRequest() ? `<td class="btn-row">
          <button class="btn btn-sm" data-approve-req="${r.id}">Approve</button>
          <button class="btn btn-sm btn-danger" data-deny-req="${r.id}">Deny</button>
        </td>` : ""}
      </tr>`).join("") : '<tr><td colspan="6" class="muted">No pending requests</td></tr>'}
      </tbody></table></div>`
      : "";

  root.innerHTML = `
    <div class="page-header"><div><h1>Bonuses</h1><p class="muted">${monthLabel(state.month)} · ${bonuses.length} entries</p></div>
      ${canEdit ? '<button class="btn btn-primary" id="add-bonus-page-btn">+ Add bonus (HR)</button>' : ""}
    </div>
    ${requestSection}
    ${monthToolbar("")}
    <div class="table-wrap card"><table>
      <thead><tr><th>Date</th><th>Employee</th><th>Type</th><th class="text-right">Amount</th><th>Reason / TL source</th>${canEdit ? "<th></th>" : ""}</tr></thead>
      <tbody>${bonuses.length ? bonuses.map((b) => {
        const emp = empById.get(b.employeeId);
        const name = emp ? (emp.american_name || emp.arabic_name || b.employeeId) : b.employeeId;
        const tlFrom = parseTlSourceFromReason(b.reason);
        const tlFromName = tlFrom ? (empById.get(tlFrom)?.american_name || empById.get(tlFrom)?.arabic_name || tlFrom) : "";
        const reason = String(b.reason || "").replace(/\s*\(deducted from[^)]+\)\s*/i, "").trim();
        const tlSourceLine =
          canViewBonusTransferSource() && tlFromName
            ? `<br><span class="muted">Deducted from ${escapeHtml(tlFromName)}</span>`
            : "";
        return `<tr>
          <td>${b.date}</td><td>${b.employeeId}<br><span class="muted">${escapeHtml(name)}</span></td>
          <td>${escapeHtml(b.type)}</td><td class="text-right">${fmt(b.amount)}</td>
          <td>${escapeHtml(reason || "—")}${tlSourceLine}</td>
          ${canEdit ? `<td class="btn-row"><button class="btn btn-sm" data-edit-bonus='${JSON.stringify({ employeeId: b.employeeId, date: b.date, type: b.type })}'>Edit</button>
            <button class="btn btn-sm btn-danger" data-del-bonus='${JSON.stringify({ employeeId: b.employeeId, date: b.date, type: b.type })}'>Delete</button></td>` : ""}
        </tr>`;
      }).join("") : `<tr><td colspan="${canEdit ? 6 : 5}" class="muted">No bonuses this month</td></tr>`}
      </tbody>
    </table></div>`;

  root.querySelectorAll("[data-edit-bonus]").forEach((btn) => {
    btn.onclick = () => {
      const key = JSON.parse(btn.dataset.editBonus);
      const b = bonuses.find((x) => x.employeeId === key.employeeId && x.date === key.date && x.type === key.type);
      if (b) openBonusEditModal(b, employees, bonusData.types || []);
    };
  });
  root.querySelectorAll("[data-del-bonus]").forEach((btn) => {
    btn.onclick = () => {
      const payload = JSON.parse(btn.dataset.delBonus);
      openConfirmDeleteModal({
        title: "Delete bonus",
        message: `Delete ${payload.type} on ${payload.date}?`,
        onConfirm: async () => {
          await api("/bonuses", { method: "DELETE", body: JSON.stringify(payload) });
          render();
        },
      });
    };
  });

  root.querySelector("#submit-bonus-req")?.addEventListener("click", () => {
    const agents = employees.filter((e) => !/^(TL|CL|OP|HR)/i.test(e.id));
    openModal(`
      <div class="modal-header"><h2>Request bonus for agent</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="bonus-req-form" class="form-grid">
        <label class="field"><span>Agent</span><select name="employeeId" required>${employeeSelectOptions(agents)}</select></label>
        <label class="field"><span>Date</span><input name="date" type="date" value="${state.month}-15" required /></label>
        <label class="field"><span>Amount</span><input name="amount" type="number" step="0.01" required /></label>
        <label class="field"><span>Type</span><input name="type" value="${escapeHtml(TL_BONUS_TYPE)}" readonly /></label>
        <label class="field"><span>Reason</span><input name="reason" /></label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Submit for approval</button></div>
      </form>
    `);
    document.getElementById("bonus-req-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.amount = Number(body.amount);
      try {
        await api("/bonus-requests", { method: "POST", body: JSON.stringify(body) });
        closeModal();
        render();
      } catch (err) {
        alert(err.message);
      }
    };
  });
  root.querySelectorAll("[data-approve-req]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/bonus-requests/${btn.dataset.approveReq}`, { method: "PATCH", body: JSON.stringify({ action: "approve" }) });
      render();
    };
  });
  root.querySelectorAll("[data-deny-req]").forEach((btn) => {
    btn.onclick = () => {
      openPromptModal({
        title: "Deny bonus request",
        message: "Optional reason for denial:",
        placeholder: "Reason",
        confirmLabel: "Deny",
        onSubmit: async (denyReason) => {
          await api(`/bonus-requests/${btn.dataset.denyReq}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "deny", denyReason }),
          });
          render();
        },
      });
    };
  });
  root.querySelector("#add-bonus-page-btn")?.addEventListener("click", () => {
    openBonusEditModal(null, employees, bonusData.types || []);
  });

  bindMonthNav(root);
}

async function renderDeductions(root) {
  const [dedData, empData] = await Promise.all([
    api(`/deductions?${buildApiQuery({ month: state.month })}`),
    api(`/employees${employeesQuery()}`),
  ]);
  const employees = empData.employees || [];
  const empById = new Map(employees.map((e) => [e.id, e]));
  const deductions = (dedData.deductions || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const regularDeductions = deductions.filter((d) => d.type !== TL_BONUS_TYPE);
  const bonusTransferDeductions = deductions.filter((d) => d.type === TL_BONUS_TYPE);
  const canEdit = canManagePayrollEvents();
  const colSpan = canEdit ? 6 : 5;
  const transferColSpan = canEdit ? 6 : 5;

  const regularRows = regularDeductions.length
    ? regularDeductions.map((d) => {
        const emp = empById.get(d.employeeId);
        const name = emp ? (emp.american_name || emp.arabic_name || d.employeeId) : d.employeeId;
        return `<tr>
          <td>${d.date}</td>
          <td>${d.employeeId}<br><span class="muted">${escapeHtml(name)}</span></td>
          <td>${escapeHtml(d.type)}</td>
          <td class="text-right amount-neg">${fmt(d.amount)}</td>
          <td>${escapeHtml(d.reason || "—")}</td>
          ${deductionActionCells(d, canEdit)}
        </tr>`;
      }).join("")
    : `<tr><td colspan="${colSpan}" class="muted">No regular deductions this month</td></tr>`;

  const transferRows = bonusTransferDeductions.length
    ? bonusTransferDeductions.map((d) => {
        const emp = empById.get(d.employeeId);
        const name = emp ? (emp.american_name || emp.arabic_name || d.employeeId) : d.employeeId;
        return `<tr>
          <td>${d.date}</td>
          <td>${d.employeeId}<br><span class="muted">${escapeHtml(name)}</span></td>
          <td>${bonusRecipientCell(d, empById)}</td>
          <td class="text-right amount-neg">${fmt(d.amount)}</td>
          <td>${escapeHtml((d.reason || "").replace(/TL bonus paid to\s+\S+/i, "").trim() || "—")}</td>
          ${deductionActionCells(d, canEdit)}
        </tr>`;
      }).join("")
    : `<tr><td colspan="${transferColSpan}" class="muted">No TL / OP bonus transfer deductions this month</td></tr>`;

  const transferSection = canViewTlOpBonusTransfers()
    ? `<section class="deductions-section">
      <h2 class="deductions-section-title">TL / OP bonus transfers</h2>
      <p class="deductions-section-desc muted">Deductions applied when a team lead or OP gave a bonus to another employee — the recipient is shown below.</p>
      <div class="table-wrap card"><table>
        <thead><tr><th>Date</th><th>Deducted from</th><th>Bonus given to</th><th class="text-right">Amount</th><th>Notes</th>${canEdit ? "<th></th>" : ""}</tr></thead>
        <tbody>${transferRows}</tbody>
      </table></div>
    </section>`
    : "";

  root.innerHTML = `
    <div class="page-header"><div><h1>Deductions</h1><p class="muted">${monthLabel(state.month)} · ${deductions.length} entries (${regularDeductions.length} regular${canViewTlOpBonusTransfers() ? ` · ${bonusTransferDeductions.length} bonus transfers` : ""})</p></div></div>
    ${monthToolbar("")}
    <section class="deductions-section">
      <h2 class="deductions-section-title">Regular deductions</h2>
      <p class="deductions-section-desc muted">Lateness, loans, hardware, and other payroll deductions.</p>
      <div class="table-wrap card"><table>
        <thead><tr><th>Date</th><th>Employee</th><th>Type</th><th class="text-right">Amount</th><th>Reason</th>${canEdit ? "<th></th>" : ""}</tr></thead>
        <tbody>${regularRows}</tbody>
      </table></div>
    </section>
    ${transferSection}`;

  bindDeductionTableActions(root, deductions, employees, dedData.types || []);
  bindMonthNav(root);
}

async function renderLoanApprovalsPage(root) {
  if (!state.user?.canApproveLoan) {
    root.innerHTML = '<p class="muted">Executive approval access only (Mark, Phoebe, Raymond).</p>';
    return;
  }
  const data = await api("/loan-requests?status=pending");
  const requests = data.requests || [];
  root.innerHTML = `
    <div class="page-header"><div><h1>Loan approvals</h1><p class="muted">${requests.length} pending · visible to executives only</p></div></div>
    <div class="table-wrap card"><table>
      <thead><tr><th>Employee</th><th class="text-right">Total</th><th>Installment</th><th>Submitted by</th><th>Notes</th><th></th></tr></thead>
      <tbody>${requests.length ? requests.map((r) => `<tr>
        <td>${escapeHtml(r.employeeId)}</td>
        <td class="text-right">${fmt(r.totalAmount)}</td>
        <td>${fmt(r.installmentAmount)} × ${r.installmentsCount || "—"}</td>
        <td>${escapeHtml(r.submittedBy)}</td>
        <td>${escapeHtml(r.notes || "—")}</td>
        <td class="btn-row">
          <button class="btn btn-sm btn-primary" data-loan-approve="${r.id}">Approve</button>
          <button class="btn btn-sm" data-loan-deny="${r.id}">Deny</button>
        </td>
      </tr>`).join("") : '<tr><td colspan="6" class="muted">No pending loan requests</td></tr>'}
      </tbody></table></div>`;
  root.querySelectorAll("[data-loan-approve]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/loan-requests/${btn.dataset.loanApprove}/approve`, { method: "POST" });
      render();
    };
  });
  root.querySelectorAll("[data-loan-deny]").forEach((btn) => {
    btn.onclick = () => {
      openPromptModal({
        title: "Deny loan request",
        message: "Optional denial reason:",
        placeholder: "Reason",
        confirmLabel: "Deny",
        onSubmit: async (reason) => {
          await api(`/loan-requests/${btn.dataset.loanDeny}/deny`, {
            method: "POST",
            body: JSON.stringify({ denyReason: reason }),
          });
          render();
        },
      });
    };
  });
}

async function renderLoansPage(root) {
  const [loanData, empData] = await Promise.all([
    api(`/loans?${buildApiQuery({})}`),
    api(`/employees${employeesQuery()}`),
  ]);
  const employees = empData.employees || [];
  const empById = new Map(employees.map((e) => [e.id, e]));
  const loans = (loanData.loans || []).slice().sort((a, b) => String(b.startYearMonth).localeCompare(String(a.startYearMonth)));
  const canEdit = canManagePayrollEvents();

  root.innerHTML = `
    <div class="page-header"><div><h1>Loans</h1><p class="muted">${monthLabel(state.month)} · ${loans.length} loan(s) · manage installments and agents</p></div>
      ${canEdit ? `<div class="btn-row"><button class="btn btn-sm btn-primary" id="loans-record-payments">Record loan payments (${monthLabel(state.month)})</button></div>` : ""}
    </div>
    ${monthToolbar("")}
    <div class="table-wrap card"><table>
      <thead><tr><th>Employee</th><th>Status</th><th class="text-right">Total</th><th class="text-right">Installment</th><th>Paid</th><th>Starts</th><th>Notes</th>${canEdit ? "<th></th>" : ""}</tr></thead>
      <tbody>${loans.length ? loans.map((l) => {
        const emp = empById.get(l.employeeId);
        const name = emp ? (emp.american_name || emp.arabic_name || l.employeeId) : l.employeeId;
        return `<tr>
          <td>${l.employeeId}<br><span class="muted">${escapeHtml(name)}</span></td>
          <td><span class="badge">${l.status}</span></td>
          <td class="text-right">${fmt(l.totalAmount)}</td>
          <td class="text-right">${fmt(l.installmentAmount)}</td>
          <td>${l.installmentsPaid || 0} / ${l.installmentsCount}</td>
          <td>${l.startYearMonth}</td>
          <td>${escapeHtml(l.notes || "—")}</td>
          ${canEdit ? `<td class="btn-row">
            ${l.status === "active" ? `<button class="btn btn-sm" data-loan-page-edit="${l.id}">Edit</button>` : ""}
            ${l.status === "active" ? `<button class="btn btn-sm" data-loan-page-cancel="${l.id}">Cancel</button>` : ""}
            ${!(l.installmentsPaid > 0) && l.status !== "completed" ? `<button class="btn btn-sm btn-danger" data-loan-page-delete="${l.id}">Delete</button>` : ""}
          </td>` : ""}
        </tr>`;
      }).join("") : `<tr><td colspan="${canEdit ? 8 : 7}" class="muted">No loans</td></tr>`}
      </tbody>
    </table></div>
    <p class="muted" style="margin-top:1rem">Create new loans from an employee payslip → Loans.</p>`;

  root.querySelector("#loans-record-payments")?.addEventListener("click", async () => {
    if (!confirm(`Record loan installment payments for ${monthLabel(state.month)}?`)) return;
    const res = await api("/payroll/record-loan-payments", { method: "POST", body: JSON.stringify({ month: state.month }) });
    alert(`Recorded ${res.count} loan payment(s)`);
    render();
  });
  root.querySelectorAll("[data-loan-page-edit]").forEach((btn) => {
    btn.onclick = () => {
      const loan = loans.find((l) => l.id === btn.dataset.loanPageEdit);
      if (loan) openLoanEditModal(loan.employeeId, loan);
    };
  });
  root.querySelectorAll("[data-loan-page-cancel]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Cancel this loan?")) return;
      await api(`/loans/${btn.dataset.loanPageCancel}/cancel`, { method: "POST" });
      render();
    };
  });
  root.querySelectorAll("[data-loan-page-delete]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this loan permanently?")) return;
      await api(`/loans/${btn.dataset.loanPageDelete}`, { method: "DELETE" });
      render();
    };
  });
  bindMonthNav(root);
}

async function openEmployeeWarningsModal(employeeId) {
  if (!canViewEmployeeNotes() && !canWriteEmployeeNotes()) {
    return alert("No permission to view HR notes.");
  }
  const data = await api(`/warnings/${employeeId}`);
  const canRead = canViewEmployeeNotes();
  const canManage = canManagePayrollEvents();
  const list = canRead
    ? (data.warnings || [])
        .map(
          (w) =>
            `<div class="card card-flat" data-warn-id="${escapeHtml(w.id)}"><div class="flex-between"><strong>${escapeHtml(w.type)}: ${escapeHtml(w.title || "—")}</strong><span class="muted">${escapeHtml(w.date)}</span></div>
          <p style="margin:.5rem 0 0">${escapeHtml(w.content)}</p>
          <div class="muted" style="font-size:.75rem">${escapeHtml(w.createdBy || "")} · ${escapeHtml(w.severity || "normal")}${w.warningLevel ? ` · Level: ${escapeHtml(w.warningLevel)}` : ""}</div>
          ${
            canManage
              ? `<div class="btn-row" style="margin-top:.5rem">
                  <button type="button" class="btn btn-sm" data-edit-warn="${escapeHtml(w.id)}">Edit</button>
                  <button type="button" class="btn btn-sm btn-danger" data-del-warn="${escapeHtml(w.id)}">Delete</button>
                </div>`
              : ""
          }</div>`
        )
        .join("")
    : "";

  const addForm = canWriteEmployeeNotes()
    ? `<div class="card" style="margin-top:1rem">
        <h4>Add HR note / warning</h4>
        <form id="warn-form" class="field-grid">
          <label class="field"><span>Type</span><select name="type"><option>Warning</option><option>Note</option><option>Verbal warning</option><option>Written warning</option></select></label>
          <label class="field"><span>Date</span><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label class="field" style="grid-column:1/-1"><span>Title</span><input name="title" required /></label>
          <label class="field" style="grid-column:1/-1"><span>Content</span><textarea name="content" required></textarea></label>
          <label class="field"><span>Severity</span><select name="severity"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
          <label class="field"><span>Warning level</span><select name="warningLevel"><option value="">—</option><option value="1st">1st</option><option value="2nd">2nd</option><option value="final">Final</option></select></label>
        </form>
        <button class="btn btn-primary btn-sm" id="add-warn-btn">Save</button>
      </div>`
    : "";

  openModal(
    `<div class="modal-header"><h2>HR notes — ${escapeHtml(employeeId)}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body modal-body-scroll">
      <div class="stack">${list || (canRead ? '<p class="muted">No HR notes yet.</p>' : '<p class="muted">HR notes are restricted to HR/Admin.</p>')}</div>
      ${addForm}
    </div>`,
    true
  );

  document.getElementById("add-warn-btn")?.addEventListener("click", async () => {
    const fd = new FormData(document.getElementById("warn-form"));
    try {
      await api("/warnings", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          type: fd.get("type"),
          date: fd.get("date"),
          title: fd.get("title"),
          content: fd.get("content"),
          severity: fd.get("severity"),
          warningLevel: fd.get("warningLevel") || "",
        }),
      });
      closeModal();
      openEmployeeWarningsModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  });

  document.querySelectorAll("[data-del-warn]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this note?")) return;
      await api(`/warnings/${encodeURIComponent(btn.dataset.delWarn)}`, { method: "DELETE" });
      closeModal();
      openEmployeeWarningsModal(employeeId);
    });
  });

  document.querySelectorAll("[data-edit-warn]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const w = (data.warnings || []).find((x) => x.id === btn.dataset.editWarn);
      if (!w) return;
      openModal(
        `<div class="modal-header"><h2>Edit note</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="edit-warn-form" class="modal-body field-grid">
          <label class="field"><span>Type</span><input name="type" value="${escapeHtml(w.type)}" /></label>
          <label class="field"><span>Date</span><input name="date" type="date" value="${escapeHtml(w.date)}" /></label>
          <label class="field" style="grid-column:1/-1"><span>Title</span><input name="title" value="${escapeHtml(w.title || "")}" /></label>
          <label class="field" style="grid-column:1/-1"><span>Content</span><textarea name="content">${escapeHtml(w.content)}</textarea></label>
        </form>
        <div class="modal-footer"><button class="btn btn-primary" id="save-edit-warn">Save</button></div>`
      );
      document.getElementById("save-edit-warn")?.addEventListener("click", async () => {
        const fd = new FormData(document.getElementById("edit-warn-form"));
        await api(`/warnings/${encodeURIComponent(w.id)}`, {
          method: "PUT",
          body: JSON.stringify({
            type: fd.get("type"),
            date: fd.get("date"),
            title: fd.get("title"),
            content: fd.get("content"),
          }),
        });
        closeModal();
        openEmployeeWarningsModal(employeeId);
      });
    });
  });
}

async function openEmployeeQualityNotesModal(employeeId) {
  if (!canViewQualityNotes() && !canWriteQualityNotes()) {
    return alert("No permission for quality notes.");
  }
  const data = await api(`/quality-notes/${encodeURIComponent(employeeId)}`).catch(() => ({ notes: [] }));
  const notes = data.notes || [];
  const canWrite = canWriteQualityNotes();
  const isHrAdmin = canManagePayrollEvents();
  const list = notes
    .map((n) => {
      const canEdit =
        isHrAdmin ||
        (state.user?.role === "quality" &&
          String(n.authorUsername || "").toLowerCase() === String(state.user?.username || "").toLowerCase());
      return `<div class="card card-flat"><div class="flex-between"><strong>${escapeHtml(n.noteDate || "")}</strong><span class="muted">${escapeHtml(n.authorUsername || "")}</span></div>
        <p style="margin:.5rem 0 0">${escapeHtml(n.body)}</p>
        ${
          canEdit
            ? `<div class="btn-row" style="margin-top:.5rem">
                <button type="button" class="btn btn-sm" data-edit-qnote="${escapeHtml(n.id)}">Edit</button>
                <button type="button" class="btn btn-sm btn-danger" data-del-qnote="${escapeHtml(n.id)}">Delete</button>
              </div>`
            : ""
        }</div>`;
    })
    .join("");

  const addForm = canWrite
    ? `<div class="card" style="margin-top:1rem"><h4>Add quality note</h4>
        <form id="qnote-form" class="field-grid">
          <label class="field"><span>Date</span><input name="noteDate" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label class="field" style="grid-column:1/-1"><span>Note</span><textarea name="body" required></textarea></label>
        </form>
        <button class="btn btn-primary btn-sm" id="add-qnote-btn">Save</button></div>`
    : "";

  openModal(
    `<div class="modal-header"><h2>Quality notes — ${escapeHtml(employeeId)}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body modal-body-scroll">
      <div class="stack">${list || '<p class="muted">No quality notes yet.</p>'}${addForm}</div>
    </div>`,
    true
  );

  document.getElementById("add-qnote-btn")?.addEventListener("click", async () => {
    const fd = new FormData(document.getElementById("qnote-form"));
    await api("/quality-notes", {
      method: "POST",
      body: JSON.stringify({ employeeId, body: fd.get("body"), noteDate: fd.get("noteDate") }),
    });
    closeModal();
    openEmployeeQualityNotesModal(employeeId);
  });

  document.querySelectorAll("[data-del-qnote]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this quality note?")) return;
      await api(`/quality-notes/${encodeURIComponent(btn.dataset.delQnote)}`, { method: "DELETE" });
      closeModal();
      openEmployeeQualityNotesModal(employeeId);
    });
  });

  document.querySelectorAll("[data-edit-qnote]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const n = notes.find((x) => x.id === btn.dataset.editQnote);
      if (!n) return;
      openModal(
        `<div class="modal-header"><h2>Edit quality note</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="edit-qnote-form" class="modal-body field-grid">
          <label class="field"><span>Date</span><input name="noteDate" type="date" value="${escapeHtml(n.noteDate || "")}" /></label>
          <label class="field" style="grid-column:1/-1"><span>Note</span><textarea name="body">${escapeHtml(n.body)}</textarea></label>
        </form>
        <div class="modal-footer"><button class="btn btn-primary" id="save-edit-qnote">Save</button></div>`
      );
      document.getElementById("save-edit-qnote")?.addEventListener("click", async () => {
        const fd = new FormData(document.getElementById("edit-qnote-form"));
        await api(`/quality-notes/${encodeURIComponent(n.id)}`, {
          method: "PUT",
          body: JSON.stringify({ body: fd.get("body"), noteDate: fd.get("noteDate") }),
        });
        closeModal();
        openEmployeeQualityNotesModal(employeeId);
      });
    });
  });
}

async function renderMyPayslip(root) {
  const empId = state.user?.employeeId;
  if (!empId) {
    root.innerHTML = `<div class="page-header"><h1>My payslip</h1><p class="muted">No employee record linked to your account.</p></div>`;
    return;
  }
  const month = state.month;
  let data;
  try {
    data = await api(`/payroll/${encodeURIComponent(empId)}?month=${encodeURIComponent(month)}`);
  } catch (e) {
    root.innerHTML = `<div class="page-header"><h1>My payslip</h1><p class="muted">${escapeHtml(e.message || "Payslip not available for this month.")}</p>
      <p class="muted">HR must release your payslip for ${monthLabel(month)} before you can view it here.</p></div>`;
    return;
  }
  const p = data.payslip;
  root.innerHTML = `
    <div class="page-header"><div><h1>My payslip</h1><p class="muted">${monthLabel(month)} · ${escapeHtml(p.name || empId)}</p></div></div>
    <div class="card payslip-card">
      <div class="grid-2">
        <div class="payslip-section">
          <h4>Attendance</h4>
          <div class="payslip-row"><span>Working days</span><span>${p.totalWorkingDays}</span></div>
          <div class="payslip-row"><span>Basic salary</span><strong>${fmt(p.basicSalary)} EGP</strong></div>
          ${p.transportAllowance ? `<div class="payslip-row"><span>Transport</span><span class="amount-pos">+${fmt(p.transportAllowance)}</span></div>` : ""}
        </div>
        <div class="payslip-section">
          <h4>Net pay</h4>
          <div class="payslip-row payslip-total"><span>Balance due</span><span>${fmt(p.remainingBalance ?? p.netSalary)} EGP</span></div>
        </div>
      </div>
      <p class="muted" style="margin-top:1rem">View only — contact HR if you have questions. Export is not available from this screen.</p>
    </div>`;
  bindMonthNav(root, () => renderMyPayslip(root));
}

async function renderSalaries(root) {
  const [ratesData, adjData, empData] = await Promise.all([
    api(`/position-rates?month=${state.month}`),
    api(`/payroll-adjustments?month=${state.month}`),
    api(`/employees${employeesQuery()}`),
  ]);
  const raises = adjData.adjustments.filter((a) => a.salaryRaise > 0);
  const usedPositions = new Set((empData.employees || []).map((e) => e.position).filter(Boolean));
  const canDeleteRates = canManagePayrollEvents();

  root.innerHTML = `
    <div class="page-header"><div><h1>Salaries</h1><p class="muted">Position rates for ${monthLabel(state.month)} — other months unchanged</p></div></div>
    ${monthToolbar("")}
    <div class="grid-2">
      <div class="card">
        <div class="flex-between" style="margin-bottom:1rem"><h3 style="margin:0">Position rates</h3>
          <button class="btn btn-sm btn-primary" id="add-rate-btn">+ Add position</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Position</th><th class="text-right">Monthly (EGP)</th><th></th></tr></thead>
          <tbody id="rates-body">${ratesData.rates.map((r) => `<tr>
            <td>${r.position}</td>
            <td class="text-right"><input class="inline-input" data-pos="${escapeHtml(r.position)}" type="number" value="${r.monthlySalary}" /></td>
            <td class="btn-row">
              <button class="btn btn-sm" data-save-rate="${escapeHtml(r.position)}">Save</button>
              ${canDeleteRates && !usedPositions.has(r.position) ? `<button class="btn btn-sm btn-danger" data-del-rate="${escapeHtml(r.position)}">Delete</button>` : ""}
            </td>
          </tr>`).join("")}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>Monthly raises (${raises.length})</h3>
        <p class="muted">Raises are stored per employee per month — they do not affect past payroll.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Employee</th><th class="text-right">Raise</th><th>Position</th></tr></thead>
          <tbody>${raises.length ? raises.map((a) => `<tr>
            <td>${a.employeeId}</td><td class="text-right amount-pos">+${fmt(a.salaryRaise)}</td><td>${a.position || "—"}</td>
          </tr>`).join("") : '<tr><td colspan="3" class="muted">No raises this month — set in payslip month profile</td></tr>'}
          </tbody>
        </table></div>
      </div>
    </div>`;

  bindMonthNav(root);
  root.querySelectorAll("[data-save-rate]").forEach((btn) => {
    btn.onclick = async () => {
      const pos = btn.dataset.saveRate;
      const input = root.querySelector(`input[data-pos="${CSS.escape(pos)}"]`);
      if (!input) return alert("Could not find salary field for this position.");
      try {
        await api("/position-rates", {
          method: "PUT",
          body: JSON.stringify({ position: pos, monthlySalary: Number(input.value), yearMonth: state.month }),
        });
        btn.textContent = "Saved";
        setTimeout(() => { btn.textContent = "Save"; }, 1500);
      } catch (e) {
        alert(e.message || "Save failed");
      }
    };
  });
  root.querySelectorAll("[data-del-rate]").forEach((btn) => {
    btn.onclick = () => {
      const position = btn.dataset.delRate;
      openConfirmDeleteModal({
        title: "Delete position rate",
        message: `Remove position "${position}"?`,
        onConfirm: async () => {
          await api(`/position-rates/${encodeURIComponent(position)}?month=${state.month}`, { method: "DELETE" });
          renderSalaries(root);
        },
      });
    };
  });
  root.querySelector("#add-rate-btn").onclick = () => {
    openModal(`
      <div class="modal-header"><h2>Add position</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="add-position-form" class="modal-body field-grid">
        <label class="field"><span>Position name</span><input name="position" required /></label>
        <label class="field"><span>Monthly salary (EGP)</span><input name="monthlySalary" type="number" min="1" required /></label>
      </form>
      <div class="modal-footer"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-primary" id="save-new-position" type="submit">Save</button></div>`);
    const addForm = document.getElementById("add-position-form");
    addForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(addForm);
      const position = String(fd.get("position") || "").trim();
      const salary = Number(fd.get("monthlySalary"));
      if (!position || !salary) return alert("Enter position name and salary");
      try {
        await api("/position-rates", { method: "PUT", body: JSON.stringify({ position, monthlySalary: salary, yearMonth: state.month }) });
        closeModal();
        renderSalaries(root);
      } catch (e) {
        alert(e.message);
      }
    };
    document.getElementById("save-new-position").onclick = (e) => {
      e.preventDefault();
      addForm.requestSubmit();
    };
  };
}

async function openEmployeeDocsModal(employeeId) {
  const data = await api(`/documents/${employeeId}`);
  const isSelf = state.user?.employeeId === employeeId;
  const canUpload = canManagePayrollEvents() || isSelf;
  const docList = (data.documents || [])
    .map((d) => {
      const fileUrl = d.driveLink || `/api/documents/${encodeURIComponent(employeeId)}/${encodeURIComponent(d.id || d.driveFileId)}/file`;
      return `<div class="adj-row"><span><strong>${d.docType}</strong> — ${d.fileName}
          ${d.expiry ? `<span class="muted"> (exp: ${d.expiry})</span>` : ""}</span>
          <a href="${fileUrl}" target="_blank" class="btn btn-sm" rel="noopener">Open</a></div>`;
    })
    .join("");

  openModal(
    `<div class="modal-header"><h2>Documents — ${employeeId}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      ${docList || '<p class="muted">No documents uploaded yet.</p>'}
      ${canManagePayrollEvents() ? `<div class="btn-row" style="margin-bottom:.75rem">
        <button type="button" class="btn btn-sm" id="export-docs-zip-btn">Download all (ZIP)</button>
      </div>` : ""}
      ${canUpload ? `<div class="card" style="margin-top:1rem">
        <h4>Upload document</h4>
        <form id="doc-form" class="field-grid">
          <label class="field"><span>Type</span><select name="docType">${data.docTypes.map((t) => `<option value="${t}">${t}</option>`).join("")}</select></label>
          <label class="field"><span>Expiry (optional)</span><input name="expiry" type="date" /></label>
          <label class="toggle-label" style="grid-column:1/-1"><input name="noExpiry" type="checkbox" /> No expiry date</label>
          <label class="field" style="grid-column:1/-1"><span>Notes</span><input name="notes" /></label>
          <label class="field" style="grid-column:1/-1"><span>File</span><input name="file" type="file" required /></label>
        </form>
        <button class="btn btn-primary btn-sm" id="upload-doc-btn">Upload</button>
      </div>` : ""}
    </div>`,
    true
  );

  document.getElementById("export-docs-zip-btn")?.addEventListener("click", () =>
    downloadFile(`/exports/documents-zip?employeeId=${encodeURIComponent(employeeId)}`, `documents-${employeeId}.zip`).catch(
      (e) => alert(e.message)
    )
  );

  document.getElementById("upload-doc-btn")?.addEventListener("click", async () => {
    const form = document.getElementById("doc-form");
    const fd = new FormData(form);
    const file = fd.get("file");
    if (!file?.size) return alert("Choose a file");
    const contentBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
      await api("/documents", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          docType: fd.get("docType"),
          fileName: file.name,
          contentBase64,
          notes: fd.get("notes") || "",
          expiry: fd.get("expiry") || "",
          noExpiry: fd.get("noExpiry") === "on",
        }),
      });
      closeModal();
      openEmployeeDocsModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  });
}

async function renderReports(root) {
  if (!canViewReports()) {
    root.innerHTML = '<p class="muted">You do not have permission to view reports.</p>';
    return;
  }
  const q = new URLSearchParams({ month: state.month });
  if (!state.hideOut) q.set("showOut", "true");
  const data = await api(`/reports/monthly?${q}`);
  const r = data.report;

  root.innerHTML = `
    <div class="page-header"><div><h1>HR Reports</h1><p class="muted">${monthLabel(state.month)}</p></div>
      <div class="btn-row">
        <button class="btn btn-sm" id="dl-report-md">Download Markdown</button>
        <button class="btn btn-sm btn-primary" id="dl-report-pdf">Export PDF</button>
      </div>
    </div>
    ${monthToolbar(hideOutToggle())}
    <div class="grid-4">
      <div class="card card-stat"><strong>${r.headcount.total}</strong><span class="muted">Total employees</span></div>
      <div class="card card-stat"><strong>${r.headcount.active}</strong><span class="muted">Active</span></div>
      <div class="card card-stat"><strong>${r.attendance.totalNsnc}</strong><span class="muted">NSNC (full)</span></div>
      <div class="card card-stat"><strong>${r.attendance.totalNsncHalf}</strong><span class="muted">NSNC Half Day</span></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h3>Payroll summary</h3>
        <div class="payslip-row"><span>Employees on payroll</span><span>${r.payroll.employees}</span></div>
        <div class="payslip-row"><span>Total basic</span><span>${fmt(r.payroll.totalBasic)} EGP</span></div>
        <div class="payslip-row"><span>Total bonuses</span><span>${fmt(r.payroll.totalBonuses)} EGP</span></div>
        <div class="payslip-row"><span>Total deductions</span><span>${fmt(r.payroll.totalDeductions)} EGP</span></div>
        <div class="payslip-row payslip-total"><span>Net payroll</span><strong>${fmt(r.payroll.totalNet)} EGP</strong></div>
        <div class="payslip-row"><span>2-week holds</span><span>${r.payroll.twoWeekHolds}</span></div>
      </div>
      <div class="card">
        <h3>Net pay by unit</h3>
        ${Object.entries(r.payroll.byUnit).map(([u, n]) => `<div class="payslip-row"><span>${u}</span><span>${fmt(n)} EGP</span></div>`).join("")}
      </div>
    </div>
    <div class="card">
      <h3>Headcount by unit</h3>
      ${Object.entries(r.headcount.byUnit).map(([u, d]) => `<div class="payslip-row"><span>${u}</span><span>${d.employees} (${d.payrollEligible} payroll)</span></div>`).join("")}
    </div>`;

  bindMonthNav(root);
  bindHideOut(root);
  root.querySelector("#dl-report-md").onclick = () => {
    const blob = new Blob([data.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hr-report-${state.month}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  root.querySelector("#dl-report-pdf").onclick = async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    try {
      const q = new URLSearchParams({ month: state.month });
      if (!state.hideOut) q.set("showOut", "true");
      await downloadFile(`/reports/monthly/pdf?${q}`, `hr-report-${state.month}.pdf`);
    } catch (err) {
      alert(err.message);
    } finally {
      setButtonLoading(btn, false);
    }
  };
  window.HRMSFeatures?.enhanceReports(root, api, state, { downloadFile, fmt, openModal, closeModal }).catch(() => {});
}

async function renderSettings(root) {
  const showLogs = isChangesViewer();
  const themes = window.HRTheme?.THEMES || [];
  const currentTheme = window.HRTheme?.get?.() || "light";
  const [status, changelog, profileEmp] = await Promise.all([
    api("/status"),
    showLogs ? api("/changelog?limit=50").catch(() => ({ entries: [] })) : Promise.resolve({ entries: [] }),
    state.user?.employeeId
      ? api(`/employees/${state.user.employeeId}${apiContextQuery()}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const emp = profileEmp?.employee || null;
  const canPhoto = Boolean(emp) && status.user?.canViewSettingsProfilePhoto !== false;
  const canTheme = status.user?.canViewSettingsTheme !== false;
  const canSync = status.user?.canViewSettingsSync !== false;
  const canHideOut = status.user?.canViewSettingsHideOut === true;
  const canSession = status.user?.canViewSettingsSession === true;

  const changeLogCard = showLogs
    ? `
    <div class="card">
      <h3>Change log</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>User</th><th>Entity</th><th>Summary</th></tr></thead>
        <tbody>${(changelog.entries || []).map((e) => `<tr>
          <td>${e.timestamp ? new Date(e.timestamp).toLocaleString() : "—"}</td>
          <td>${e.username || "—"}</td>
          <td>${e.entity || "—"}</td>
          <td>${e.summary || `${e.field}: ${e.old_value} → ${e.new_value}`}</td>
        </tr>`).join("") || '<tr><td colspan="4" class="muted">No changes logged yet</td></tr>'}
        </tbody>
      </table></div>
    </div>`
    : "";

  const themeOptions = themes
    .map(
      (t) => `<label class="theme-option">
        <input type="radio" name="ui-theme" value="${escapeHtml(t.id)}" ${currentTheme === t.id ? "checked" : ""} />
        <span class="theme-swatch theme-swatch-${escapeHtml(t.id)}" aria-hidden="true"></span>
        <span class="theme-label"><strong>${escapeHtml(t.label)}</strong><small>${escapeHtml(t.desc)}</small></span>
      </label>`
    )
    .join("");

  const profilePhotoCard = canPhoto
    ? `<div class="card">
        <h3>Profile picture</h3>
        <p class="muted">Your photo appears in the sidebar and employee lists.</p>
        <div class="profile-photo-block">
          ${avatarHtml(emp, "profile-photo-lg")}
          <div class="profile-photo-actions">
            <label class="btn btn-sm btn-primary">
              Upload photo
              <input type="file" id="settings-profile-photo-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
            </label>
            ${emp.profile_photo_file_id ? '<button type="button" class="btn btn-sm btn-danger" id="settings-remove-photo-btn">Remove</button>' : ""}
          </div>
        </div>
      </div>`
    : "";

  let impersonateCard = "";
  if (status.user?.canImpersonate && !status.impersonation?.active) {
    let userOptions = "";
    try {
      const impUsers = await api("/impersonate/users");
      userOptions = (impUsers.users || [])
        .map(
          (u) =>
            `<option value="${escapeHtml(u.username)}">${escapeHtml(u.employeeName || u.username)} — ${escapeHtml(u.username)} (${escapeHtml(u.role || "")}${u.status === "inactive" ? ", inactive" : ""})</option>`
        )
        .join("");
    } catch {
      userOptions = "";
    }
    impersonateCard = `<div class="card">
      <h3>View as user (testing)</h3>
      <p class="muted">Raymond only — see the app exactly as another user, including inactive accounts. Actions are recorded under their username.</p>
      <label class="field"><span>User</span>
        <select id="impersonate-user-select"><option value="">— Choose user —</option>${userOptions}</select>
      </label>
      <button type="button" class="btn btn-primary btn-sm" id="impersonate-start-btn">Start viewing</button>
    </div>`;
  }

  const displayCard = canHideOut
    ? `<div class="card">
        <h3>Display</h3>
        <label class="toggle-label"><input type="checkbox" id="set-hide-out" ${status.hideOutEmployees ? "checked" : ""} /> Hide out / inactive employees</label>
        <p class="muted">When enabled, employees with status "Out" or blank inactive rows are hidden from lists.</p>
      </div>`
    : "";
  const adminMetaCards = canSession
    ? `<div class="card">
        <h3>App version</h3>
        <p><strong>${escapeHtml(status.appVersion || "unknown")}</strong></p>
        <p class="muted">Version policy is managed in Supabase (<code>app_versions</code> table).</p>
      </div>
      <div class="card">
        <h3>Session</h3>
        <p class="muted">Session ID (for support):</p>
        <p><code id="settings-session-id">${escapeHtml(typeof getSessionId === "function" ? getSessionId() || "—" : "—")}</code></p>
        <p class="muted">One active session per user. Signing in elsewhere revokes this device after ~10 hours idle.</p>
      </div>`
    : "";

  root.innerHTML = `
    <div class="page-header"><h1>Settings</h1></div>
    <div class="grid-2">
      ${profilePhotoCard}
      ${
        canTheme
          ? `<div class="card">
        <h3>Appearance</h3>
        <p class="muted">Color theme for this device. Layout and sidebar structure stay the same.</p>
        <div class="theme-picker" id="theme-picker">${themeOptions}</div>
      </div>`
          : ""
      }
      ${displayCard}
      ${adminMetaCards}
      ${
        canSync
          ? `<div class="card">
        <h3>Data sync</h3>
        <p class="muted">Last sync: ${status.lastSync ? timeAgo(status.lastSync) : "Never"}</p>
        <button class="btn btn-primary" id="settings-refresh">Refresh from server</button>
      </div>`
          : ""
      }
    </div>
    ${impersonateCard ? `<div class="grid-2">${impersonateCard}</div>` : ""}
    ${changeLogCard}`;

  root.querySelectorAll('input[name="ui-theme"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked && window.HRTheme) {
        window.HRTheme.set(input.value);
        showSaveIndicator("Theme updated", "saved");
      }
    });
  });
  root.querySelector("#set-hide-out")?.addEventListener("change", async (e) => {
    state.hideOut = e.target.checked;
    await api("/settings/hide-out", {
      method: "PUT",
      body: JSON.stringify({ hide: state.hideOut }),
    });
  });
  root.querySelector("#settings-refresh").onclick = () => refreshData();
  if (canPhoto && emp) {
    bindProfilePhotoUpload(emp.id, async () => {
      await renderSettings(root);
      await updateSidebarBrand();
    });
    const settingsInput = root.querySelector("#settings-profile-photo-input");
    const settingsRemove = root.querySelector("#settings-remove-photo-btn");
    if (settingsInput) settingsInput.id = "profile-photo-input";
    if (settingsRemove) settingsRemove.id = "remove-photo-btn";
  }
  root.querySelector("#impersonate-start-btn")?.addEventListener("click", async () => {
    const username = root.querySelector("#impersonate-user-select")?.value;
    if (!username) return alert("Choose a user");
    if (!confirm(`View the app as ${username}?`)) return;
    try {
      await api("/impersonate/start", { method: "POST", body: JSON.stringify({ username }) });
      await refreshStatus();
      await render();
    } catch (e) {
      alert(e.message);
    }
  });
  window.HRMSFeatures?.enhanceSettings(root, api, state, {
    isChangesViewer,
    escapeHtml,
    openModal,
    closeModal,
    render,
  }).catch(() => {});
  window.HRSalesConfigBreaks?.enhanceSettings(root, api, state, {
    escapeHtml,
    openModal,
    closeModal,
  }).catch(() => {});
}

function usersStatusBadge(status) {
  const s = (status || "active").toLowerCase();
  const cls = s === "active" ? "badge-ok" : s === "terminated" ? "badge-out" : "badge-warn";
  return `<span class="badge ${cls}">${status}</span>`;
}

function usersTableRowHtml(u) {
  return `<tr>
    <td><strong>${escapeHtml(u.username)}</strong>
      ${u.hasExceptionAccess ? '<br><span class="badge badge-warn" style="font-size:.65rem">Exception access</span>' : ""}
      ${u.status === "inactive" && u.employeeId ? '<br><span class="badge badge-warn" style="font-size:.65rem">Employee login</span>' : ""}</td>
    <td>${u.employeeId ? escapeHtml(u.employeeId) : '<span class="muted">—</span>'}</td>
    <td class="muted">${u.employeeName ? escapeHtml(u.employeeName) : "—"}</td>
    <td class="muted">${u.employeeUnit ? escapeHtml(u.employeeUnit) : "—"}</td>
    <td class="muted">${u.employeeTeam ? escapeHtml(u.employeeTeam) : "—"}</td>
    <td class="muted">${u.email ? escapeHtml(u.email) : "—"}</td>
    <td><span class="badge badge-status">${escapeHtml(u.role || "—")}</span></td>
    <td>${usersStatusBadge(u.status)}</td>
    <td class="muted">${u.lastLoginAt ? timeAgo(u.lastLoginAt) : "—"}</td>
    <td class="muted">${u.updatedAt ? timeAgo(u.updatedAt) : "—"}</td>
    <td class="flex-between" style="gap:.35rem;justify-content:flex-end">
      ${u.status === "inactive" ? `<button class="btn btn-sm btn-primary" data-activate-user="${escapeHtml(u.username)}">Activate</button>` : ""}
      <button class="btn btn-sm" data-edit-user="${escapeHtml(u.username)}">Edit</button>
      <button class="btn btn-sm btn-danger" data-delete-user="${escapeHtml(u.username)}" ${
        u.username.toLowerCase() === (state.user?.username || "").toLowerCase()
          ? "disabled title=\"Cannot delete your own account\""
          : ""
      }>Remove</button>
      ${
        u.employeeId && u.status !== "terminated"
          ? `<button class="btn btn-sm btn-danger" data-purge-user="${escapeHtml(u.username)}" ${
              u.username.toLowerCase() === (state.user?.username || "").toLowerCase()
                ? "disabled"
                : ""
            } title="Remove login and release employee ID">Remove &amp; release ID</button>`
          : ""
      }
    </td>
  </tr>`;
}

function buildUsersTableBody(allUsers, filter) {
  let users = [...(allUsers || [])];
  if (filter.status === "inactive") {
    users = users.filter((u) => (u.status || "").toLowerCase() === "inactive");
  } else if (filter.status === "active") {
    users = users.filter((u) => (u.status || "active").toLowerCase() === "active");
  } else if (filter.status === "no-login") {
    users = users.filter((u) => !u.employeeId);
  }
  if (filter.unit) users = users.filter((u) => String(u.employeeUnit || "") === filter.unit);
  if (filter.team) users = users.filter((u) => String(u.employeeTeam || "") === filter.team);
  if (filter.role) users = users.filter((u) => String(u.role || "").toLowerCase() === filter.role);

  const searchQ = String(filter.q || "").trim().toLowerCase();
  if (searchQ) {
    users = users.filter((u) => {
      const hay = [u.username, u.employeeId, u.employeeName, u.email, u.employeeTeam, u.employeeUnit, u.role]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return hay.includes(searchQ);
    });
  }

  const sortKey = filter.sort || "name";
  users.sort((a, b) => {
    if (sortKey === "lastLogin") return String(b.lastLoginAt || "").localeCompare(String(a.lastLoginAt || ""));
    if (sortKey === "lastEdit") return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    const an = (a.employeeName || a.username || "").toLowerCase();
    const bn = (b.employeeName || b.username || "").toLowerCase();
    return an.localeCompare(bn);
  });

  let tableBody;
  if (filter.groupTeam) {
    const groups = new Map();
    for (const u of users) {
      const team = u.employeeTeam || "(No team)";
      if (!groups.has(team)) groups.set(team, []);
      groups.get(team).push(u);
    }
    tableBody = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([team, list]) =>
          `<tr class="users-group-row"><td colspan="11"><strong>${escapeHtml(team)}</strong> <span class="muted">(${list.length})</span></td></tr>${list.map(usersTableRowHtml).join("")}`
      )
      .join("");
  } else {
    tableBody = users.map(usersTableRowHtml).join("");
  }
  return { tableBody, searchQ, sortKey };
}

function bindUsersTableActions(root) {
  const data = root.__usersData;
  if (!data) return;
  const roles = data.roles || ["ceo", "admin", "hr", "finance", "it", "op", "tl", "quality", "rtm", "public_relations", "office_assistant", "agent"];
  const statuses = data.statuses || ["active", "inactive", "terminated"];
  const users = data.users || [];
  root.querySelectorAll("[data-activate-user]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const user = users.find((u) => u.username === btn.dataset.activateUser);
      openActivateUserModal({ roles, user });
    });
  });
  root.querySelectorAll("[data-edit-user]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const user = users.find((u) => u.username === btn.dataset.editUser);
      openUserFormModal({ roles, statuses, user });
    });
  });
  root.querySelectorAll("[data-delete-user]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const username = btn.dataset.deleteUser;
      openConfirmModal({
        title: "Remove user",
        message: `Remove user "${username}"? They will no longer be able to sign in.`,
        confirmLabel: "Remove",
        danger: true,
        onConfirm: async () => {
          await api(`/admin/users/${encodeURIComponent(username)}`, { method: "DELETE" });
          showSaveIndicator("User removed", "saved");
          render();
        },
      });
    });
  });
  root.querySelectorAll("[data-purge-user]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const username = btn.dataset.purgeUser;
      openConfirmModal({
        title: "Remove user and release ID",
        message: `Permanently remove login for "${username}" and release their employee ID for reuse? Payroll and sales history will be kept under a DEL-… placeholder record.`,
        confirmLabel: "Remove & release ID",
        danger: true,
        onConfirm: () => {
          openConfirmModal({
            title: "Confirm purge",
            message: "This cannot be undone. The app ID will be freed immediately.",
            confirmLabel: "Yes, purge",
            danger: true,
            onConfirm: async () => {
              const res = await api(`/admin/users/${encodeURIComponent(username)}/purge`, { method: "POST", body: "{}" });
              showSaveIndicator(
                res.releasedAppId ? `Purged — ID ${res.releasedAppId} released` : "User purged",
                "saved"
              );
              render();
            },
          });
        },
      });
    });
  });
}

function updateUsersTable(root) {
  const data = root.__usersData;
  if (!data) return;
  const { tableBody, searchQ } = buildUsersTableBody(data.users || [], state.usersFilter);
  const tbody = root.querySelector("#users-tbody");
  if (tbody) {
    tbody.innerHTML =
      tableBody ||
      `<tr><td colspan="11" class="muted">${searchQ ? "No users match your search" : "No users match this filter"}</td></tr>`;
  }
  bindUsersTableActions(root);
}

async function renderUsers(root) {
  if (!isUserManager()) {
    root.innerHTML = `<div class="alert alert-warn">This view is restricted to the system administrator.</div>`;
    return;
  }

  state.usersFilter = state.usersFilter || { status: "", sort: "name", groupTeam: false, q: "", unit: "", team: "", role: "" };
  const data = await api("/admin/users");
  root.__usersData = data;
  let users = data.users || [];
  const roles = data.roles || ["ceo", "admin", "hr", "finance", "it", "op", "tl", "quality", "rtm", "public_relations", "office_assistant", "agent"];
  const statuses = data.statuses || ["active", "inactive", "terminated"];
  const unitOptions = data.units || [];
  const teamOptions = data.teams || [];

  const { tableBody, searchQ, sortKey } = buildUsersTableBody(users, state.usersFilter);

  let pendingRegHtml = "";
  if (state.user?.canApproveRegistration) {
    try {
      const pendRes = await api("/registration/pending");
      const pending = pendRes.pending || [];
      if (pending.length) {
        pendingRegHtml = `<section class="card" style="margin-bottom:1rem">
          <h3>Pending agent registrations (${pending.length})</h3>
          <p class="muted">Approve on Organization page or here. Creates inactive employee + login; team assigned later.</p>
          <div class="table-wrap"><table><thead><tr>
            <th>American name</th><th>Full name</th><th>Unit</th><th>Phone</th><th></th>
          </tr></thead><tbody>
            ${pending.map((p) => `<tr>
              <td>${escapeHtml(p.americanName || "—")}</td>
              <td>${escapeHtml(p.fullName || p.arabicName || "—")}</td>
              <td>${escapeHtml(p.unit || "—")}</td>
              <td>${escapeHtml(p.phone || "—")}</td>
              <td class="btn-row">
                <button type="button" class="btn btn-sm btn-primary" data-approve-reg="${escapeHtml(p.id)}">Approve</button>
                <button type="button" class="btn btn-sm btn-danger" data-reject-reg="${escapeHtml(p.id)}">Reject</button>
              </td>
            </tr>`).join("")}
          </tbody></table></div>
        </section>`;
      }
    } catch {
      /* optional */
    }
  }

  root.innerHTML = `
    <div class="page-header flex-between">
      <div>
        <h1>App users</h1>
        <p class="muted">Manage sign-ins, roles, and per-user exception access.</p>
      </div>
      <div class="btn-row">
        <button class="btn btn-sm" id="sync-emp-logins-btn">Sync employee logins</button>
        <button class="btn btn-primary" id="add-user-btn">+ Add user</button>
      </div>
    </div>
    ${pendingRegHtml}
    <div class="toolbar users-toolbar">
      <label class="field field-inline field-search"><span>Search</span>
        <input type="search" id="users-search" class="search-input" placeholder="Username, name, ID, email, team…" value="${escapeHtml(state.usersFilter.q || "")}" />
      </label>
      <label class="field field-inline"><span>Status</span>
        <select id="users-filter-status">
          <option value="">All</option>
          <option value="active" ${state.usersFilter.status === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${state.usersFilter.status === "inactive" ? "selected" : ""}>Inactive</option>
          <option value="no-login" ${state.usersFilter.status === "no-login" ? "selected" : ""}>No employee link</option>
        </select>
      </label>
      <label class="field field-inline"><span>Unit</span>
        <select id="users-filter-unit">
          <option value="">All</option>
          ${unitOptions.map((u) => `<option value="${escapeHtml(u)}" ${state.usersFilter.unit === u ? "selected" : ""}>${escapeHtml(u)}</option>`).join("")}
        </select>
      </label>
      <label class="field field-inline"><span>Team</span>
        <select id="users-filter-team">
          <option value="">All</option>
          ${teamOptions.map((t) => `<option value="${escapeHtml(t)}" ${state.usersFilter.team === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
        </select>
      </label>
      <label class="field field-inline"><span>Role</span>
        <select id="users-filter-role">
          <option value="">All</option>
          ${roles.map((r) => `<option value="${r}" ${state.usersFilter.role === r ? "selected" : ""}>${r}</option>`).join("")}
        </select>
      </label>
      <label class="field field-inline"><span>Sort by</span>
        <select id="users-sort">
          <option value="name" ${sortKey === "name" ? "selected" : ""}>Name</option>
          <option value="lastLogin" ${sortKey === "lastLogin" ? "selected" : ""}>Last login</option>
          <option value="lastEdit" ${sortKey === "lastEdit" ? "selected" : ""}>Last edit</option>
        </select>
      </label>
      <label class="toggle-label"><input type="checkbox" id="users-group-team" ${state.usersFilter.groupTeam ? "checked" : ""} /> Group by team</label>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Username</th><th>Employee ID</th><th>Name</th><th>Unit</th><th>Team</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th>Last edit</th><th></th>
      </tr></thead>
      <tbody id="users-tbody">${tableBody || `<tr><td colspan="11" class="muted">${searchQ ? "No users match your search" : "No users match this filter"}</td></tr>`}
      </tbody>
    </table></div>`;

  root.querySelector("#sync-emp-logins-btn").onclick = async () => {
    try {
      const res = await api("/admin/users/sync-employees", { method: "POST", body: "{}" });
      showSaveIndicator(`Synced ${res.created} new logins`, "saved");
      render();
    } catch (e) {
      alert(e.message);
    }
  };
  root.querySelector("#users-filter-status").onchange = (e) => {
    state.usersFilter.status = e.target.value;
    updateUsersTable(root);
  };
  root.querySelector("#users-search")?.addEventListener("input", (e) => {
    state.usersFilter.q = e.target.value;
    updateUsersTable(root);
  });
  root.querySelector("#users-search")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.target.value = "";
      state.usersFilter.q = "";
      updateUsersTable(root);
    }
  });
  root.querySelector("#users-sort").onchange = (e) => {
    state.usersFilter.sort = e.target.value;
    updateUsersTable(root);
  };
  root.querySelector("#users-group-team").onchange = (e) => {
    state.usersFilter.groupTeam = e.target.checked;
    updateUsersTable(root);
  };
  root.querySelector("#users-filter-unit")?.addEventListener("change", (e) => {
    state.usersFilter.unit = e.target.value;
    updateUsersTable(root);
  });
  root.querySelector("#users-filter-team")?.addEventListener("change", (e) => {
    state.usersFilter.team = e.target.value;
    updateUsersTable(root);
  });
  root.querySelector("#users-filter-role")?.addEventListener("change", (e) => {
    state.usersFilter.role = e.target.value;
    updateUsersTable(root);
  });
  root.querySelectorAll("[data-approve-reg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openConfirmModal({
        title: "Approve registration",
        message: "Approve this registration? Creates employee + inactive login (no team yet).",
        confirmLabel: "Approve",
        onConfirm: async () => {
          const res = await api(`/registration/${btn.dataset.approveReg}/approve`, { method: "POST", body: "{}" });
          render();
          showRegistrationCredentialsModal(res, "Assign the agent's team on the Organization page.");
        },
      });
    });
  });
  root.querySelectorAll("[data-reject-reg]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Reject this registration?")) return;
      try {
        await api(`/registration/${btn.dataset.rejectReg}/reject`, { method: "POST", body: "{}" });
        render();
      } catch (e) {
        alert(e.message);
      }
    });
  });
  root.querySelector("#add-user-btn").onclick = () => openUserFormModal({ roles, statuses });
  bindUsersTableActions(root);
}

function openActivateUserModal({ roles, user }) {
  if (!user) return;
  const roleOpts = roles
    .map((r) => `<option value="${r}" ${user.role === r ? "selected" : ""}>${r}</option>`)
    .join("");
  openModal(`
    <div class="modal-header">
      <h2>Activate ${escapeHtml(user.username)}</h2>
      <button type="button" class="btn btn-ghost btn-sm" data-close aria-label="Close">×</button>
    </div>
    <form id="activate-user-form" class="modal-body">
      <p class="muted">Set a password and role so this employee can sign in.</p>
      <label class="field">
        <span>Password</span>
        <input type="password" name="password" required minlength="4" autocomplete="new-password" />
      </label>
      <label class="field">
        <span>Role / access level</span>
        <select name="role" required>${roleOpts}</select>
      </label>
    </form>
    <div class="modal-footer">
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" form="activate-user-form" class="btn btn-primary">Activate</button>
    </div>`);
  document.getElementById("activate-user-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/admin/users/${encodeURIComponent(user.username)}`, {
        method: "PUT",
        body: JSON.stringify({
          status: "active",
          role: fd.get("role"),
          password: String(fd.get("password") || ""),
        }),
      });
      closeModal();
      showSaveIndicator(`${user.username} activated`, "saved");
      render();
    } catch (err) {
      showSaveIndicator(err.message, "error");
    }
  };
}

function openUserFormModal({ roles, statuses, user = null }) {
  const isEdit = Boolean(user);
  const roleOpts = roles
    .map(
      (r) =>
        `<option value="${r}" ${user?.role === r ? "selected" : ""}>${r}</option>`
    )
    .join("");
  const statusOpts = statuses
    .map(
      (s) =>
        `<option value="${s}" ${(user?.status || "active") === s ? "selected" : ""}>${s}</option>`
    )
    .join("");

  openModal(`
    <div class="modal-header">
      <h2>${isEdit ? "Edit user" : "Add user"}</h2>
      <button type="button" class="btn btn-ghost btn-sm" data-close aria-label="Close">×</button>
    </div>
    <form id="user-form" class="modal-body modal-body-scroll">
      <label class="field">
        <span>Username</span>
        <input name="username" required ${isEdit ? "readonly" : ""} value="${escapeHtml(user?.username || "")}" autocomplete="off" />
      </label>
      <label class="field">
        <span>Email <span class="muted">(optional)</span></span>
        <input type="email" name="email" value="${escapeHtml(user?.email || "")}" autocomplete="email" placeholder="name@company.com" />
      </label>
      <label class="field">
        <span>Password ${isEdit ? "(leave blank to keep)" : ""}</span>
        <input type="password" name="password" ${isEdit ? "" : "required minlength=\"4\""} autocomplete="new-password" />
      </label>
      <label class="field">
        <span>1. Role</span>
        <select name="role" id="user-form-role" required>${roleOpts}</select>
        <p class="muted small">Base access comes from this role (Access Control page).</p>
      </label>
      <label class="field">
        <span>Status</span>
        <select name="status" required>${statusOpts}</select>
      </label>
      ${isEdit ? `<div id="user-exception-access" class="card card-flat" style="margin-top:1rem;padding:.75rem">
        <h4 style="margin:0 0 .5rem">2. Exception access <span class="muted">(optional)</span></h4>
        <p class="muted small">Override role defaults for this user only. Unlisted permissions use the role default.</p>
        <div id="user-perm-overrides" class="muted">Loading…</div>
        <button type="button" class="btn btn-sm" id="user-clear-exceptions" style="margin-top:.5rem">Clear all exceptions</button>
      </div>` : `<p class="muted small">New users get role access only. Assign team on Organization after linking an employee.</p>`}
    </form>
    <div class="modal-footer">
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" form="user-form" class="btn btn-primary">${isEdit ? "Save changes" : "Create user"}</button>
    </div>`);

  const exceptionState = new Map();
  let roleDefaults = {};

  async function loadExceptionAccess() {
    if (!isEdit || !user?.username) return;
    const wrap = document.getElementById("user-perm-overrides");
    if (!wrap) return;
    try {
      const [cat, permData] = await Promise.all([
        api("/rbac/catalog"),
        api(`/admin/users/${encodeURIComponent(user.username)}/permissions`),
      ]);
      const defaults = permData.defaults || {};
      roleDefaults = defaults;
      const overrides = Object.fromEntries((permData.overrides || []).map((o) => [o.permissionKey, o.allowed]));
      const perms = cat.permissions || [];
      let html = "";
      for (const p of perms) {
        const roleDefault = defaults[p.key];
        const hasOverride = overrides[p.key] !== undefined;
        const effective = hasOverride ? overrides[p.key] : roleDefault;
        if (hasOverride) exceptionState.set(p.key, overrides[p.key]);
        html += `<label class="toggle-label user-perm-row" style="display:flex;gap:.5rem;align-items:flex-start;margin:.35rem 0">
          <input type="checkbox" data-user-perm="${p.key}" ${effective ? "checked" : ""} ${hasOverride ? "" : ""} />
          <span><strong>${escapeHtml(p.label)}</strong>
            <span class="muted small"> — role default: ${roleDefault ? "Allow" : "Deny"}${hasOverride ? " · <em>exception</em>" : ""}</span></span>
        </label>`;
      }
      wrap.innerHTML = html || "<span class='muted'>No permissions</span>";
      wrap.querySelectorAll("[data-user-perm]").forEach((input) => {
        input.addEventListener("change", () => {
          const key = input.dataset.userPerm;
          const roleDef = defaults[key];
          if (input.checked === roleDef) exceptionState.delete(key);
          else exceptionState.set(key, input.checked);
        });
      });
    } catch (e) {
      wrap.innerHTML = `<span class="muted">${escapeHtml(e.message || "Could not load permissions")}</span>`;
    }
  }

  loadExceptionAccess();
  document.getElementById("user-clear-exceptions")?.addEventListener("click", () => {
    exceptionState.clear();
    document.querySelectorAll("[data-user-perm]").forEach((input) => {
      const key = input.dataset.userPerm;
      input.checked = Boolean(roleDefaults[key]);
    });
    const btn = document.getElementById("user-clear-exceptions");
    if (btn) btn.dataset.cleared = "1";
  });

  document.getElementById("user-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      username: String(fd.get("username") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      role: fd.get("role"),
      status: fd.get("status"),
    };
    const password = String(fd.get("password") || "");
    if (password) payload.password = password;

    try {
      if (isEdit) {
        await api(`/admin/users/${encodeURIComponent(user.username)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        if (exceptionState.size) {
          await api(`/admin/users/${encodeURIComponent(user.username)}/permissions`, {
            method: "PUT",
            body: JSON.stringify({
              entries: [...exceptionState.entries()].map(([permissionKey, allowed]) => ({ permissionKey, allowed })),
            }),
          });
        } else if (user.hasExceptionAccess && document.getElementById("user-clear-exceptions")?.dataset?.cleared) {
          await api(`/admin/users/${encodeURIComponent(user.username)}/permissions`, { method: "DELETE" });
        }
      } else {
        if (!payload.password) throw new Error("Password is required for new users");
        await api("/admin/users", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      closeModal();
      showSaveIndicator(isEdit ? "User updated" : "User created", "saved");
      render();
    } catch (err) {
      showSaveIndicator(err.message, "error");
    }
  };
}

async function renderChanges(root) {
  if (!isChangesViewer()) {
    root.innerHTML = `<div class="alert alert-warn">This view is restricted.</div>`;
    return;
  }

  const q = new URLSearchParams({ limit: "200" });
  if (state.changesFilter?.user) q.set("user", state.changesFilter.user);
  if (state.changesFilter?.entity) q.set("entity", state.changesFilter.entity);
  const data = await api(`/changelog?${q.toString()}`).catch(() => ({ entries: [] }));
  const entries = data.entries || [];

  root.innerHTML = `
    <div class="page-header">
      <div><h1>Changes</h1><p class="muted">Audit trail of edits made by all users, live from the log sheet.</p></div>
      <button class="btn btn-primary" id="changes-refresh">↻ Refresh</button>
    </div>
    <div class="card toolbar-card">
    <div class="toolbar">
      <input class="search-input" id="changes-user" placeholder="Filter by user" value="${state.changesFilter?.user || ""}" />
      <select id="changes-entity">
        ${["", "employee", "attendance", "bonus", "deduction", "config", "warning", "month_profile", "document", "app_user"]
          .map((e) => `<option value="${e}" ${state.changesFilter?.entity === e ? "selected" : ""}>${e || "All types"}</option>`)
          .join("")}
      </select>
    </div>
    </div>
    <div class="table-wrap card"><table>
      <thead><tr><th>When</th><th>User</th><th>Type</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>${entries
        .map(
          (e) => `<tr>
          <td>${e.timestamp ? new Date(e.timestamp).toLocaleString() : "—"}</td>
          <td>${e.username || "—"}</td>
          <td>${e.entity || "—"}</td>
          <td>${e.action || "—"}</td>
          <td>${e.summary || `${e.field || ""}: ${e.old_value ?? ""} → ${e.new_value ?? ""}`}</td>
        </tr>`
        )
        .join("") || '<tr><td colspan="5" class="muted">No changes logged yet</td></tr>'}
      </tbody>
    </table></div>`;

  state.changesFilter = state.changesFilter || { user: "", entity: "" };
  root.querySelector("#changes-refresh").onclick = () => render();
  root.querySelector("#changes-user").onchange = (e) => {
    state.changesFilter.user = e.target.value.trim();
    render();
  };
  root.querySelector("#changes-entity").onchange = (e) => {
    state.changesFilter.entity = e.target.value;
    render();
  };
  window.HRMSFeatures?.enhanceChanges(root, api);
}

function navigate(page) {
  const next = ensureNavPageAllowed(navPageAlias(page));
  state.page = next;
  syncNavActiveState(next);
  closeSidebarNav();
  render();
}

async function render() {
  const root = document.getElementById("app");
  if (!root) return;
  const gen = ++renderGeneration;
  const page = state.page;
  const labels = {
    dashboard: "Loading dashboard…",
    employees: "Loading employees…",
    attendance: "Loading attendance…",
    payroll: "Loading payroll…",
    bonuses: "Loading bonuses…",
    deductions: "Loading deductions…",
    loans: "Loading loans…",
    salaries: "Loading salaries…",
    reports: "Loading reports…",
    settings: "Loading settings…",
    changes: "Loading changes…",
    users: "Loading users…",
    leave: "Loading requests…",
    requests: "Loading requests…",
    equipment: "Loading equipment…",
    org: "Loading organization…",
    sales: "Loading sales…",
    breaks: "Loading breaks…",
    costs: "Loading costs…",
    "team-dashboard": "Loading team dashboards…",
    "loan-approvals": "Loading loan approvals…",
    "sales-permissions": "Loading sales permissions…",
    "sales-log-columns": "Loading log columns…",
  };
  if (!appReady) {
    root.innerHTML = pageSkeleton(labels[page] || "Loading…");
  } else {
    root.classList.add("page-loading");
  }
  const stale = () => gen !== renderGeneration || state.page !== page;
  try {
    if (page === "dashboard") await renderDashboard(root);
    else if (page === "attendance") await renderAttendance(root);
    else if (page === "employees") await renderEmployees(root);
    else if (page === "payroll") await renderPayroll(root);
    else if (page === "bonuses") await renderBonuses(root);
    else if (page === "deductions") await renderDeductions(root);
    else if (page === "loans") await renderLoansPage(root);
    else if (page === "loan-approvals") await renderLoanApprovalsPage(root);
    else if (page === "salaries") await renderSalaries(root);
    else if (page === "reports") await renderReports(root);
    else if (page === "leave" || page === "requests") {
      if (state.page === "leave") state.page = "requests";
      if (window.RequestsModule) {
        await window.RequestsModule.renderRequestsPage(root, api, state, {
          monthToolbar, escapeHtml, openModal, closeModal, employeeSelectOptions,
        });
      } else {
        await window.HRMSFeatures.renderLeavePage(root, api, state, {
          monthToolbar, escapeHtml, openModal, closeModal, employeeSelectOptions, api,
        });
      }
    }
    else if (page === "equipment") {
      parseEquipmentEmployeeFromUrl();
      await window.HRMSFeatures.renderEquipmentPage(root, api, { escapeHtml, openModal, closeModal, employeeSelectOptions });
    }
    else if (page === "org") await window.HRMSFeatures.renderOrgPage(root, api, {
      openEmployeeModal, escapeHtml, openModal, closeModal, canManagePayrollEvents, canManageOrgStructure,
    });
    else if (page === "settings") await renderSettings(root);
    else if (page === "payslip") await renderMyPayslip(root);
    else if (page === "changes") await renderChanges(root);
    else if (page === "users") await renderUsers(root);
    else if (page === "access-control" && window.AccessControlModule) {
      await window.AccessControlModule.renderAccessControlPage(root, api, {
        escapeHtml, openModal, closeModal, refreshStatus, showSaveIndicator,
      });
    }
    else if (page === "sales-permissions" && window.SalesPermissionsPages) {
      await window.SalesPermissionsPages.renderSalesFieldPermissionsPage(root, api, {
        escapeHtml, openModal, closeModal, showSaveIndicator,
      });
    }
    else if (page === "sales-log-columns" && window.SalesPermissionsPages) {
      await window.SalesPermissionsPages.renderSalesLogColumnsPage(root, api, {
        escapeHtml, showSaveIndicator,
      });
    }
    else if (page === "sales" && window.SalesModule) {
      await window.SalesModule.renderSalesPage(root, api, state, {
        monthLabel, escapeHtml, fmt, bindMonthNav, monthToolbar, openModal, closeModal, downloadFile,
      });
    } else if (page === "breaks" && window.HRSalesConfigBreaks) {
      await window.HRSalesConfigBreaks.renderBreaksPage(root, api, state, { escapeHtml });
    } else if (page === "team-dashboard" && window.TeamDashboardModule) {
      await window.TeamDashboardModule.renderTeamDashboardPage(root, api, state, { escapeHtml });
    }     else if (page === "costs" && window.ExpensesModule) {
      await window.ExpensesModule.renderCostsPage(root, api, state, {
        escapeHtml, fmt, openModal, closeModal,
      });
    } else {
      renderErrorCard(
        root,
        `This section is not available for your account or failed to load.`,
        () => navigate("dashboard")
      );
      return;
    }
    if (stale()) return;
    appReady = true;
    root.classList.add("page-ready");
  } catch (e) {
    if (stale()) return;
    root.classList.remove("page-ready");
    renderErrorCard(root, e?.message || "Something went wrong loading this page.", () => render());
  } finally {
    if (gen === renderGeneration && state.page === page) {
      root.classList.remove("page-loading");
    }
  }
}

function renderErrorCard(root, message, onRetry) {
  if (!root) return;
  root.innerHTML = `
    <div class="card" style="max-width:520px;margin:3rem auto;text-align:center">
      <h3>Couldn't load</h3>
      <p class="muted">${message}</p>
      <button class="btn btn-primary" id="retry-btn">Retry</button>
    </div>`;
  const btn = root.querySelector("#retry-btn");
  if (btn && onRetry) btn.addEventListener("click", () => onRetry());
}

document.querySelectorAll(".nav-btn").forEach((b) =>
  b.addEventListener("click", () => navigate(b.dataset.page))
);
initSidebarNav();
document.getElementById("logout-btn").addEventListener("click", () => performLogout());
document.getElementById("refresh-btn").addEventListener("click", () => refreshData());

let sessionCheckTimer = null;
let appUpdateCheckTimer = null;

// Auto sign-out after 10 minutes with no activity in the app window.
const IDLE_LOGOUT_MS = 10 * 60 * 1000;
let idleTimer = null;
let lastActivityAt = Date.now();
let loggingOut = false;

async function performLogout() {
  if (loggingOut) return;
  loggingOut = true;
  clearTimeout(idleTimer);
  if (sessionCheckTimer) {
    clearInterval(sessionCheckTimer);
    sessionCheckTimer = null;
  }
  clearSessionId();
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    /* navigating away regardless */
  }
  try {
    if (window.hrDesktop) await window.hrDesktop.clearSession();
  } catch {
    /* ignore */
  }
  window.location.href = "/login";
}

function resetIdleTimer() {
  if (loggingOut) return;
  lastActivityAt = Date.now();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(performLogout, IDLE_LOGOUT_MS);
}

function checkIdleOnResume() {
  if (loggingOut) return;
  if (Date.now() - lastActivityAt >= IDLE_LOGOUT_MS) {
    performLogout();
    return;
  }
  resetIdleTimer();
}

["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart", "click"].forEach(
  (ev) => window.addEventListener(ev, resetIdleTimer, { passive: true })
);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    checkIdleOnResume();
    if (typeof checkForAppUpdate === "function") checkForAppUpdate();
  }
});
window.addEventListener("focus", checkIdleOnResume);

async function boot() {
  const root = document.getElementById("app");
  root.innerHTML = pageSkeleton("Loading…");
  setUserInfo(state.user?.username || getSavedUsername());
  let syncOk = false;
  let cacheWarm = false;
  try {
    const warm = await api("/sync/status", {}, 8000);
    cacheWarm = !!warm.warm;
  } catch {
    /* proceed to sync */
  }
  try {
    if (cacheWarm) {
      syncOk = true;
      await refreshStatus().catch(() => {});
      await render();
      initialSync().then(() => refreshStatus()).catch(() => {});
    } else {
      await initialSync();
      syncOk = true;
      await render();
    }
  } catch (e) {
    try {
      const warm = await api("/sync/status");
      if (warm.warm) {
        syncOk = true;
        await refreshStatus().catch(() => {});
        await render();
      } else throw e;
    } catch {
      showSyncOverlay(false);
      renderErrorCard(
        root,
        e?.message || "The app could not start. Check your internet connection and try again.",
        boot
      );
      return;
    }
  }
  try {
    if (!syncOk) showSaveIndicator("Showing cached data — sync when online", "info");
    consumePendingVersionNotice();
    if (!sessionCheckTimer) {
      sessionCheckTimer = setInterval(checkSession, SESSION_CHECK_MS);
    }
    if (!appUpdateCheckTimer) {
      appUpdateCheckTimer = setInterval(() => checkForAppUpdate(), APP_UPDATE_CHECK_MS);
    }
    resetIdleTimer();
    window.HRMSFeatures?.initNotificationsBell(api, state).catch(() => {});
  } catch (e) {
    renderErrorCard(
      root,
      e?.message || "Could not load the page. Try again.",
      () => render()
    );
  }
}

boot();
