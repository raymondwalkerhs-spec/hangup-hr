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

const state = {
  user: null,
  page: "dashboard",
  month: new Date().toISOString().slice(0, 7),
  unit: "",
  team: "",
  hideOut: true,
  empFilter: { q: "", status: "", unit: "" },
  meta: { statuses: [], units: [], positions: [], backendPools: [] },
  pendingAttendance: new Map(),
  saveTimer: null,
};

const HALF_DAY_STATUSES = new Set(["Half Day", "NSNC Half Day"]);

function isHalfDayStatus(status) {
  return HALF_DAY_STATUSES.has(status);
}

function pageSkeleton() {
  return `<div class="page-skeleton">
    <div class="skeleton-bar wide"></div>
    <div class="skeleton-bar mid"></div>
    <div class="skeleton-grid">${Array(4).fill('<div class="skeleton-card"></div>').join("")}</div>
    <div class="skeleton-bar"></div><div class="skeleton-bar"></div><div class="skeleton-bar"></div>
  </div>`;
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.classList.toggle("is-loading", loading);
  btn.disabled = loading;
}

async function downloadFile(path, filename) {
  const res = await fetch(`/api${path}`);
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

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (res.status === 401) {
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
  return data;
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
  showSyncOverlay(true);
  try {
    await api("/sync/refresh", { method: "POST" });
  } catch (e) {
    console.warn("Sync:", e.message);
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
    if (data.action === "uninstall" && window.hrDesktop) {
      await window.hrDesktop.triggerUninstall();
      return false;
    }
    if (data.action === "admin") {
      alert(data.message || "Contact Admin.");
      window.location.href = "/login";
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
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
  document.getElementById("modal-root").innerHTML = "";
}

function openModal(html, wide = false) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop">
    <div class="modal ${wide ? "modal-wide" : ""}" role="dialog">${html}</div>
  </div>`;
  root.querySelector("#modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
  root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
}

async function refreshStatus() {
  try {
    const s = await api("/status");
    state.user = s.user;
    state.hideOut = s.hideOutEmployees !== false;
    document.getElementById("user-info").textContent = `${s.user.username} · ${s.user.role}`;
    document.getElementById("sync-badge").textContent = "Synced";
    document.getElementById("sync-badge").className = "badge badge-online";
    document.getElementById("last-sync").textContent = s.lastSync
      ? `Last sync: ${timeAgo(s.lastSync)}`
      : "";
  } catch {
    document.getElementById("sync-badge").textContent = "Offline";
    document.getElementById("sync-badge").className = "badge badge-offline";
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
    const q = state.hideOut ? "" : "?showOut=true";
    api(`/settings/hide-out`, {
      method: "PUT",
      body: JSON.stringify({ hide: state.hideOut }),
    }).catch(() => {});
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

function matchesEmployeeSearch(emp, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    emp.id,
    emp.employeeId,
    emp.american_name,
    emp.arabic_name,
    emp.name,
    emp.team,
    emp.unit,
    emp.position,
  ]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return hay.includes(needle);
}

function employeeSearchInputHtml() {
  return `<input class="search-input" id="employee-search" type="search" placeholder="Search name or ID…" value="${escapeHtml(state.empFilter.q)}" autocomplete="off" spellcheck="false" />`;
}

function bindEmployeeSearch(root, onFilter) {
  const input = root.querySelector("#employee-search");
  if (!input) return;
  input.addEventListener("input", () => {
    state.empFilter.q = input.value;
    onFilter();
  });
}

function filterEmployeesList(employees) {
  let list = employees;
  if (state.empFilter.q) list = list.filter((e) => matchesEmployeeSearch(e, state.empFilter.q));
  if (state.empFilter.status) list = list.filter((e) => e.status === state.empFilter.status);
  if (state.empFilter.unit) list = list.filter((e) => e.unit === state.empFilter.unit);
  return list;
}

function employeeListRowHtml(e) {
  const name = e.american_name || e.arabic_name || e.id;
  return `<tr class="clickable" data-emp="${e.id}">
    <td><div class="emp-cell">${avatarHtml(e)}<strong>${name}</strong></div></td>
    <td>${e.id}</td><td>${e.unit || "—"}</td><td>${e.team || "—"}</td>
    <td>${e.position || "—"}</td><td>${statusBadge(e.status)}</td>
    <td><button class="btn btn-sm" data-docs="${e.id}">Docs</button>
      <button class="btn btn-sm" data-warn="${e.id}">Notes</button>
      <button class="btn btn-sm" data-edit="${e.id}">Edit</button></td>
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
  root.querySelectorAll("[data-docs]").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      openEmployeeDocsModal(b.dataset.docs);
    };
  });
  root.querySelectorAll("tr[data-emp]").forEach((tr) => {
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
      : `<tr><td colspan="7" class="muted">No employees match your search</td></tr>`;
  }
  if (countEl) countEl.textContent = `${list.length} shown`;
  bindEmployeesTableActions(root, data.employees);
}

function attendanceEmployeeRowHtml(emp, ctx) {
  const { days, statuses, canEdit, recordMap, summaryMap } = ctx;
  const s = summaryMap.get(emp.id) || {};
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
      const dis = canEdit ? "" : "disabled";
      return `<td class="att-cell ${isWeekend(d) ? "weekend-col" : ""}">
        <select class="status-select ${statusClass(st)}" data-emp="${emp.id}" data-date="${d}" ${dis}>
        <option value="">—</option>
        ${statuses.map((x) => `<option value="${x}" ${st === x ? "selected" : ""}>${x === "Day-OFF" && isWeekend(d) ? "OFF★" : x}</option>`).join("")}
      </select>
      ${transportOverrideHtml(emp.id, d, st, rec?.transportOverride, canEdit)}
      </td>`;
    }).join("")}
  </tr>`;
}

function bindAttendanceGridEvents(root, ctx) {
  const { canEdit } = ctx;

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
        if (isHalfDayStatus(el.value)) {
          ovSel.classList.remove("hidden");
        } else {
          ovSel.classList.add("hidden");
          ovSel.value = "";
        }
      } else if (isHalfDayStatus(el.value) && cell && canEdit) {
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
  if (state.empFilter.q) {
    employees = employees.filter((e) => matchesEmployeeSearch(e, state.empFilter.q));
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
  return `<tr class="clickable" data-pay="${r.employeeId}">
    <td><div class="emp-cell">${avatarHtml({ id: r.employeeId, american_name: r.name, profile_photo_file_id: r.profile_photo_file_id, profile_photo_updated: r.profile_photo_updated })}<div><strong>${r.name}</strong><div class="muted">${r.employeeId} · ${r.unit || "—"}</div></div></div></td>
    <td>${payrollStatusBadge(r.payrollStatus)}</td>
    <td class="text-center">${r.salesCount || "—"}</td>
    <td class="text-right">${r.commissionAmount ? fmt(r.commissionAmount) : "—"}</td>
    <td><span class="badge badge-status">${r.paymentMethod || "—"}</span></td>
    <td class="text-center">${r.totalWorkingDays}</td>
    <td class="text-right">${fmt(r.basicSalary)}</td>
    <td class="text-right amount-pos">${fmt(r.transportAllowance)}</td>
    <td class="text-right amount-neg">${r.loanDeductionTotal ? `-${fmt(r.loanDeductionTotal)}` : "—"}</td>
    <td class="text-right"><strong>${fmt(r.netSalary)}</strong>${r.hasSplits ? `<div class="muted" style="font-size:.7rem">calc ${fmt(r.calculatedNet)}</div>` : ""}${r.receivedTotal ? `<div class="muted" style="font-size:.7rem">paid ${fmt(r.receivedTotal)}</div>` : ""}</td>
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
  if (state.empFilter.q) {
    rows = rows.filter((r) => matchesEmployeeSearch(r, state.empFilter.q));
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
  if (!isHalfDayStatus(status)) return "";
  const dis = canEdit ? "" : "disabled";
  const ov = currentOverride || "";
  return `<select class="transport-ov-select" data-emp="${empId}" data-date="${date}" ${dis} title="Half-day transport override">
    <option value="" ${!ov ? "selected" : ""}>No transport</option>
    <option value="full" ${ov === "full" ? "selected" : ""}>Full transport</option>
    <option value="half" ${ov === "half" ? "selected" : ""}>Half transport</option>
  </select>`;
}

function queueAttendanceSave(employeeId, date, status, transportOverride) {
  const key = `${employeeId}|${date}`;
  const prev = state.pendingAttendance.get(key);
  let to = transportOverride;
  if (to === undefined) to = prev?.transportOverride;
  if (!isHalfDayStatus(status)) to = "";
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
  const showQ = state.hideOut ? "" : "?showOut=true";
  const [empData, payData] = await Promise.all([
    api(`/employees${showQ}`),
    api(`/payroll?month=${state.month}${state.hideOut ? "" : "&showOut=true"}`).catch(() => null),
  ]);
  state.meta = empData;

  root.innerHTML = `
    <div class="page-header"><div><h1>Dashboard</h1><p class="muted">${monthLabel(state.month)}</p></div></div>
    <div class="grid-4">
      <div class="card card-stat"><strong>${empData.employees.length}</strong><span class="muted">Employees</span></div>
      <div class="card card-stat"><strong>${empData.employees.filter((e) => e.status === "Active").length}</strong><span class="muted">Active</span></div>
      <div class="card card-stat"><strong>${empData.units.length}</strong><span class="muted">Units</span></div>
      <div class="card card-stat"><strong>${payData ? fmt(payData.totals.totalNet) : "—"}</strong><span class="muted">Net payroll (EGP)</span></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h3>Quick actions</h3>
        <div class="quick-actions">
          <button class="btn btn-primary" data-go="employees">Manage employees</button>
          <button class="btn" data-go="attendance">Edit attendance</button>
          <button class="btn" data-go="payroll">View payroll</button>
        </div>
      </div>
      <div class="card"><h3>Units</h3><p class="muted">${empData.units.join(" · ") || "—"}</p></div>
    </div>`;
  root.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => navigate(b.dataset.go))
  );
}

function openAddAgentWizard() {
  let step = 1;
  let wizard = { unit: "", team: "", backendPool: "NW", suggestedId: "" };

  function renderWizard() {
    if (step === 1) {
      openModal(`
        <div class="modal-header"><h2>Add agent — Step 1</h2><button class="btn btn-sm" data-close>✕</button></div>
        <div class="modal-body">
          <label class="field"><span>Unit *</span>
            <select id="wiz-unit"><option value="">Select unit…</option>
              ${state.meta.units.map((u) => `<option value="${u}">${u}</option>`).join("")}
            </select>
          </label>
          <label class="field"><span>Team *</span>
            <select id="wiz-team" disabled><option value="">Select unit first…</option></select>
            <input id="wiz-team-new" class="hidden" placeholder="New team name" />
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
      unitSel.onchange = async () => {
        wizard.unit = unitSel.value;
        document.getElementById("wiz-pool-wrap")?.classList.toggle("hidden", wizard.unit !== "HS-Back-End");
        const teamSel = document.getElementById("wiz-team");
        if (!wizard.unit) {
          teamSel.innerHTML = '<option value="">Select unit first…</option>';
          teamSel.disabled = true;
          return;
        }
        const { teams } = await api(`/meta/teams?unit=${encodeURIComponent(wizard.unit)}`);
        teamSel.disabled = false;
        teamSel.innerHTML =
          '<option value="">Select team…</option>' +
          teams.map((t) => `<option value="${t}">${t}</option>`).join("") +
          '<option value="__new__">+ New team…</option>';
      };

      document.getElementById("wiz-team").onchange = (e) => {
        const v = e.target.value;
        document.getElementById("wiz-team-new").classList.toggle("hidden", v !== "__new__");
      };

      document.getElementById("wiz-next").onclick = async () => {
        const teamSel = document.getElementById("wiz-team");
        wizard.team =
          teamSel.value === "__new__"
            ? document.getElementById("wiz-team-new").value.trim()
            : teamSel.value;
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
              ${state.meta.positions.map((p) => `<option value="${p}">${p}</option>`).join("")}
            </select></label>
            <label class="field"><span>Payment Method</span><select name="payment_method">
              <option value="Cash">Cash</option><option value="Bank">Bank</option><option value="Insta">Insta</option>
            </select></label>
            <label class="field"><span>Phone</span><input name="phone" /></label>
            <label class="field"><span>Email</span><input name="email" type="email" /></label>
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
      document.getElementById("wiz-create").onclick = async () => {
        const body = Object.fromEntries(new FormData(document.getElementById("wiz-form")));
        try {
          await api("/employees", { method: "POST", body: JSON.stringify(body) });
          closeModal();
          render();
        } catch (e) {
          alert(e.message);
        }
      };
    }
  }
  renderWizard();
}

function employeeFormFields(emp = {}) {
  return `<form id="emp-form" class="field-grid">
    <label class="field"><span>Employee ID</span><input name="id" value="${emp.id || ""}" readonly /></label>
    <label class="field"><span>American Name</span><input name="american_name" value="${emp.american_name || ""}" /></label>
    <label class="field"><span>Arabic Name</span><input name="arabic_name" value="${emp.arabic_name || ""}" /></label>
    <label class="field"><span>Status</span><select name="status">${state.meta.statuses.map((s) =>
      `<option value="${s}" ${emp.status === s ? "selected" : ""}>${s || "(blank)"}</option>`
    ).join("")}</select></label>
    <label class="field"><span>Unit</span><select name="unit">${state.meta.units.map((u) =>
      `<option value="${u}" ${emp.unit === u ? "selected" : ""}>${u}</option>`
    ).join("")}</select></label>
    <label class="field"><span>Team</span><input name="team" value="${emp.team || ""}" /></label>
    <label class="field"><span>Position</span><input name="position" value="${emp.position || ""}" /></label>
    <label class="field"><span>Payment Method</span><input name="payment_method" value="${emp.payment_method || ""}" /></label>
    <label class="field"><span>Phone</span><input name="phone" value="${emp.phone || ""}" /></label>
    <label class="field"><span>Email</span><input name="email" value="${emp.email || ""}" /></label>
  </form>`;
}

function openEmployeeModal(emp) {
  const canPhoto = true;
  openModal(`
    <div class="modal-header"><h2>Edit employee</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      ${canPhoto ? `<div class="profile-photo-block">
        ${avatarHtml(emp, "profile-photo-lg")}
        <div class="profile-photo-actions">
          <label class="btn btn-sm btn-primary" id="upload-photo-btn">Upload photo
            <input type="file" id="profile-photo-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
          </label>
          ${emp.profile_photo_file_id ? '<button type="button" class="btn btn-sm btn-danger" id="remove-photo-btn">Remove</button>' : ""}
          <p class="muted" style="margin:.35rem 0 0;font-size:.75rem">JPG, PNG, WebP or GIF · stored in Google Drive</p>
        </div>
      </div>` : ""}
      ${employeeFormFields(emp)}
    </div>
    <div class="modal-footer">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="save-emp">Save</button>
    </div>`);
  bindProfilePhotoUpload(emp.id, () => {
    closeModal();
    api(`/employees/${emp.id}`)
      .then((d) => openEmployeeModal(d.employee))
      .catch(() => render());
  });
  document.getElementById("save-emp").onclick = async () => {
    const body = Object.fromEntries(new FormData(document.getElementById("emp-form")));
    delete body.id;
    try {
      await api(`/employees/${emp.id}`, { method: "PUT", body: JSON.stringify(body) });
      closeModal();
      render();
    } catch (e) {
      alert(e.message);
    }
  };
}

async function openPayslipModal(employeeId) {
  const data = await api(`/payroll/${employeeId}?month=${state.month}`);
  const p = data.payslip;
  const emp = data.employee || { id: employeeId, american_name: p.name, profile_photo_file_id: p.profile_photo_file_id };
  const bonusRows = Object.entries(p.bonuses || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<div class="payslip-row"><span>${k}</span><span class="amount-pos">+${fmt(v)}</span></div>`)
    .join("");
  const dedRows = Object.entries(p.deductions || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<div class="payslip-row"><span>${k}</span><span class="amount-neg">-${fmt(v)}</span></div>`)
    .join("");

  const bonusList = (data.bonuses || [])
    .map(
      (b) =>
        `<div class="adj-row"><span>${b.type}: ${fmt(b.amount)} EGP (${b.date})</span>
          <button class="btn btn-sm btn-danger" data-del-bonus='${JSON.stringify({ employeeId: b.employeeId, date: b.date, type: b.type })}'>Delete</button></div>`
    )
    .join("");
  const dedList = (data.deductions || [])
    .map(
      (d) =>
        `<div class="adj-row"><span>${d.type}: ${fmt(d.amount)} EGP (${d.date})</span>
          <button class="btn btn-sm btn-danger" data-del-ded='${JSON.stringify({ employeeId: d.employeeId, date: d.date, type: d.type })}'>Delete</button></div>`
    )
    .join("");

  const adj = data.adjustment || {};
  const commissionOpts = (data.commissionTypes || [])
    .map((t) => `<option value="${t.name}" ${adj.commissionType === t.name ? "selected" : ""}>${t.name} (${t.rateEgp} EGP)</option>`)
    .join("");

  const statuses = data.payrollStatuses || ["pending", "pending papers", "pending hardware", "received", "closed"];
  const statusOpts = statuses
    .map((s) => `<option value="${s}" ${(adj.payrollStatus || p.payrollStatus) === s ? "selected" : ""}>${s}</option>`)
    .join("");

  openModal(
    `<div class="modal-header"><h2>Payslip — ${p.name}</h2>
      <div class="btn-row">
        <button class="btn btn-sm" id="hist-slip-btn">History</button>
        <button class="btn btn-sm" id="pdf-slip-btn">PDF</button>
        <button class="btn btn-sm" onclick="window.print()">Print</button>
        <button class="btn btn-sm" data-close>✕</button>
      </div></div>
    <div class="modal-body payslip">
      <div class="payslip-header">
        <div class="payslip-identity">
          ${avatarHtml(emp, "profile-photo-lg")}
          <div>
          <strong style="font-size:1.2rem">${p.name}</strong>
          <div class="muted">${p.employeeId} · ${p.unit || "—"} · ${p.position || "—"}</div>
          <div class="muted">${monthLabel(state.month)} · ${p.paymentMethod || "—"}</div>
          <div style="margin-top:.35rem">${payrollStatusBadge(p.payrollStatus)}</div>
          <label class="btn btn-sm" style="margin-top:.5rem" id="payslip-photo-btn">Change photo
            <input type="file" id="profile-photo-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
          </label>
          </div>
        </div>
        <div class="text-right"><div class="muted">Monthly salary</div><strong>${fmt(p.monthlySalary)} EGP</strong>
          ${p.salaryRaise ? `<div class="muted">incl. raise +${fmt(p.salaryRaise)}</div>` : ""}</div>
      </div>
      <div class="grid-2">
        <div class="payslip-section">
          <h4>Attendance</h4>
          <div class="payslip-row"><span>Working days</span><span>${p.totalWorkingDays}</span></div>
          ${p.extraDays ? `<div class="payslip-row"><span>Extra days</span><span>${p.extraDays}</span></div>` : ""}
          ${p.nsnc ? `<div class="payslip-row"><span>NSNC</span><span>${p.nsnc}</span></div>` : ""}
          ${p.nsncHalf ? `<div class="payslip-row"><span>NSNC Half Day</span><span>${p.nsncHalf}</span></div>` : ""}
          <div class="payslip-row"><span>Daily rate (${p.workingDaysInMonth}d)</span><span>${p.dailyRate} EGP</span></div>
          <div class="payslip-row"><span>Basic salary</span><strong>${fmt(p.basicSalary)} EGP</strong></div>
          ${p.transportAllowance ? `<div class="payslip-row"><span>Transport (${p.transportDays % 1 === 0 ? p.transportDays : p.transportDays} day-units)</span><span class="amount-pos">+${fmt(p.transportAllowance)}</span></div>` : ""}
          ${p.salesCount ? `<div class="payslip-row"><span>Sales this month</span><span>${p.salesCount}</span></div>` : ""}
          ${(p.commissionBreakdown || []).length ? `<div class="payslip-row"><span>Commission tiers</span><span class="amount-pos">${p.commissionBreakdown.map((b) => `${b.label}: ${fmt(b.amount)}`).join(" + ")}</span></div>` : ""}
          ${p.twoWeekHold ? `<div class="payslip-row"><span>2-week hold</span><span class="amount-neg">-${fmt(p.holdAmount)}</span></div>` : ""}
        </div>
        <div class="payslip-section">
          <h4>Net pay</h4>
          ${bonusRows || '<div class="muted">No bonuses</div>'}
          <div class="payslip-row"><span>Lateness</span><span class="amount-neg">-${fmt(p.latenessDeduction)}</span></div>
          ${dedRows}
          ${p.deferredIn ? `<div class="payslip-row"><span>Carried from prior month</span><span class="amount-pos">+${fmt(p.deferredIn)}</span></div>` : ""}
          <div class="payslip-row"><span>Calculated net</span><span>${fmt(p.calculatedNet ?? p.netSalary)} EGP</span></div>
          ${p.receivedTotal ? `<div class="payslip-row"><span>Paid (splits)</span><span class="amount-neg">-${fmt(p.receivedTotal)}</span></div>` : ""}
          ${p.deferredOut ? `<div class="payslip-row"><span>Deferred to later month</span><span class="amount-neg">-${fmt(p.deferredOut)}</span></div>` : ""}
          <div class="payslip-row payslip-total"><span>Balance due</span><span>${fmt(p.remainingBalance ?? p.netSalary)} EGP</span></div>
        </div>
      </div>
      <div class="grid-2" style="margin-top:1rem">
        <div class="card">
          <h4>Bonuses</h4>${bonusList || '<p class="muted">None</p>'}
          <form id="bonus-form" class="field-grid" style="margin-top:.75rem">
            <label class="field"><span>Type</span><select name="type">${data.bonusTypes.map((t) => `<option value="${t}">${t}</option>`).join("")}</select></label>
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
          <label class="field"><span>Sales count (month)</span><input name="salesCount" type="number" min="0" step="1" value="${adj.salesCount ?? p.salesCount ?? 0}" /></label>
          <label class="field"><span>Commission type</span><select name="commissionType"><option value="">—</option>${commissionOpts}</select></label>
          <label class="field"><span>Manual commission</span><input name="commissionAmount" type="number" min="0" value="${adj.commissionAmount ?? p.commissionAmount ?? 0}" title="Used only when sales count is 0" /></label>
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
        </div>
        <div id="splits-list" class="stack">${(data.splits || []).length ? (data.splits || []).map((s) => `
          <div class="adj-row" data-split-id="${s.id}">
            <span>${splitStatusBadge(s.status)} <strong>${fmt(s.amount)}</strong> EGP
              ${s.splitKind === "correction" ? " (correction)" : ""}
              ${s.status === "deferred" && s.deferToMonth ? ` → ${monthLabel(s.deferToMonth)}` : ""}
              ${s.notes ? ` · ${s.notes}` : ""}</span>
            <span class="btn-row">
              ${s.status === "pending" ? `<button class="btn btn-sm btn-primary" data-split-received="${s.id}">Mark received</button>` : ""}
              ${s.status === "pending" ? `<button class="btn btn-sm" data-split-defer="${s.id}">Defer</button>` : ""}
              <button class="btn btn-sm btn-danger" data-split-del="${s.id}">Delete</button>
            </span>
          </div>`).join("") : '<p class="muted">No payment splits yet.</p>'}</div>
        <form id="split-form" class="field-grid" style="margin-top:.75rem">
          <label class="field"><span>Amount (EGP)</span><input name="amount" type="number" step="0.01" required /></label>
          <label class="field"><span>Type</span><select name="splitKind">
            <option value="payment">Payment</option>
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

  document.getElementById("pdf-slip-btn").onclick = async () => {
    try {
      await downloadFile(`/payslip/${employeeId}/pdf?month=${state.month}`, `payslip-${employeeId}-${state.month}.pdf`);
    } catch (e) {
      alert(e.message);
    }
  };

  bindProfilePhotoUpload(employeeId, () => {
    closeModal();
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

  document.getElementById("save-adj-btn").onclick = async () => {
    const fd = new FormData(document.getElementById("adj-form"));
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
          commissionType: fd.get("commissionType") || "",
          commissionAmount: Number(fd.get("commissionAmount")) || 0,
          bankReference: fd.get("bankReference") || "",
          monthNotes: fd.get("monthNotes") || "",
        }),
      });
      closeModal();
      openPayslipModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  };

  document.getElementById("emp-loans-btn").onclick = () => openEmployeeLoansModal(employeeId);

  const splitForm = document.getElementById("split-form");
  const splitStatusSel = splitForm?.querySelector("[name=status]");
  const deferField = splitForm?.querySelector(".split-defer-field");
  splitStatusSel?.addEventListener("change", () => {
    deferField?.classList.toggle("hidden", splitStatusSel.value !== "deferred");
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
      closeModal();
      openPayslipModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("defer-remainder-btn")?.addEventListener("click", async () => {
    const balance = p.remainingBalance ?? p.netSalary;
    if (!(balance > 0)) return alert("No balance left to defer");
    const deferToMonth = prompt(`Defer ${fmt(balance)} EGP to which month? (YYYY-MM)`, shiftMonth(state.month, 1));
    if (!deferToMonth || !/^\d{4}-\d{2}$/.test(deferToMonth)) return;
    try {
      await api("/payroll-splits", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          yearMonth: state.month,
          amount: balance,
          status: "deferred",
          deferToMonth,
          notes: "Deferred remainder",
        }),
      });
      closeModal();
      openPayslipModal(employeeId);
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
    btn.onclick = async () => {
      const split = (data.splits || []).find((s) => s.id === btn.dataset.splitDefer);
      if (!split) return;
      const deferToMonth = prompt("Defer to month (YYYY-MM)", shiftMonth(state.month, 1));
      if (!deferToMonth) return;
      try {
        await api(`/payroll-splits/${split.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...split, status: "deferred", deferToMonth }),
        });
        closeModal();
        openPayslipModal(employeeId);
      } catch (e) {
        alert(e.message);
      }
    };
  });

  document.querySelectorAll("[data-split-del]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this payment split?")) return;
      try {
        await api(`/payroll-splits/${btn.dataset.splitDel}`, { method: "DELETE" });
        closeModal();
        openPayslipModal(employeeId);
      } catch (e) {
        alert(e.message);
      }
    };
  });

  document.getElementById("add-bonus-btn").onclick = async () => {
    const body = Object.fromEntries(new FormData(document.getElementById("bonus-form")));
    try {
      await api("/bonuses", {
        method: "POST",
        body: JSON.stringify({ ...body, employeeId, amount: Number(body.amount) }),
      });
      closeModal();
      openPayslipModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  };
  document.getElementById("add-ded-btn").onclick = async () => {
    const body = Object.fromEntries(new FormData(document.getElementById("deduction-form")));
    try {
      await api("/deductions", {
        method: "POST",
        body: JSON.stringify({ ...body, employeeId, amount: Number(body.amount) }),
      });
      closeModal();
      openPayslipModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  };

  document.querySelectorAll("[data-del-bonus]").forEach((btn) => {
    btn.onclick = async () => {
      const payload = JSON.parse(btn.dataset.delBonus);
      await api("/bonuses", { method: "DELETE", body: JSON.stringify(payload) });
      closeModal();
      openPayslipModal(employeeId);
    };
  });
  document.querySelectorAll("[data-del-ded]").forEach((btn) => {
    btn.onclick = async () => {
      const payload = JSON.parse(btn.dataset.delDed);
      await api("/deductions", { method: "DELETE", body: JSON.stringify(payload) });
      closeModal();
      openPayslipModal(employeeId);
    };
  });
}

async function renderEmployees(root) {
  const showQ = state.hideOut ? "" : "?showOut=true";
  const data = await api(`/employees${showQ}`);
  state.meta = data;
  root.__employeesData = data;

  const list = filterEmployeesList(data.employees);

  root.innerHTML = `
    <div class="page-header">
      <div><h1>Employees</h1><p class="muted" id="emp-count">${list.length} shown</p></div>
      <button class="btn btn-primary" id="add-emp">+ Add agent</button>
    </div>
    <div class="toolbar">
      ${employeeSearchInputHtml()}
      <select id="filter-status"><option value="">All statuses</option>${data.statuses.map((s) =>
        `<option value="${s}" ${state.empFilter.status === s ? "selected" : ""}>${s || "(blank)"}</option>`
      ).join("")}</select>
      <select id="filter-unit"><option value="">All units</option>${data.units.map((u) =>
        `<option value="${u}" ${state.empFilter.unit === u ? "selected" : ""}>${u}</option>`
      ).join("")}</select>
      ${hideOutToggle()}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Employee</th><th>ID</th><th>Unit</th><th>Team</th><th>Position</th><th>Status</th><th></th></tr></thead>
      <tbody id="emp-tbody">${list.map(employeeListRowHtml).join("")}</tbody>
    </table></div>`;

  root.querySelector("#add-emp").onclick = () => openAddAgentWizard();
  bindHideOut(root);
  bindEmployeeSearch(root, () => updateEmployeesTable(root));
  root.querySelector("#filter-status").onchange = (e) => {
    state.empFilter.status = e.target.value;
    updateEmployeesTable(root);
  };
  root.querySelector("#filter-unit").onchange = (e) => {
    state.empFilter.unit = e.target.value;
    updateEmployeesTable(root);
  };
  bindEmployeesTableActions(root, data.employees);
}

async function renderAttendance(root) {
  const q = new URLSearchParams({ month: state.month });
  if (state.unit) q.set("unit", state.unit);
  if (state.team) q.set("team", state.team);
  if (!state.hideOut) q.set("showOut", "true");
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
  if (state.empFilter.q) {
    employees = employees.filter((e) => matchesEmployeeSearch(e, state.empFilter.q));
  }

  root.innerHTML = `
    <div class="page-header"><div><h1>Attendance</h1><p class="muted" id="att-emp-count">${employees.length} employees · ${monthLabel(state.month)}</p></div></div>
    ${monthToolbar(`${employeeSearchInputHtml()}
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
    ${hideOutToggle()}
    <p class="muted" style="grid-column:1/-1;margin:0">Half days: use the transport dropdown to grant full or half transport allowance for that day only.</p>`)}
    <div class="table-wrap attendance-grid"><table>
      <thead><tr>
        <th class="att-sticky att-sticky-id">ID</th><th class="att-sticky att-sticky-name">Name</th><th class="att-sticky att-sticky-team">Team</th>
        <th class="text-center">Work</th><th class="text-center">Late</th><th class="text-center">Ded.</th>
        ${data.days.map((d) => {
          const cal = calMap.get(d);
          const label = cal ? dayHeader(cal) : d.slice(8);
          return `<th class="text-center ${isWeekend(d) ? "weekend-col" : ""}">${label}</th>`;
        }).join("")}
      </tr></thead>
      <tbody id="att-tbody">${employees.map((emp) => attendanceEmployeeRowHtml(emp, ctx)).join("")}</tbody>
    </table></div>`;

  bindMonthNav(root);
  bindHideOut(root);
  bindEmployeeSearch(root, () => updateAttendanceTable(root));
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
  bindAttendanceGridEvents(root, ctx);
}

async function renderPayroll(root) {
  const q = new URLSearchParams({ month: state.month });
  if (!state.hideOut) q.set("showOut", "true");
  const [data, tiersData] = await Promise.all([
    api(`/payroll?${q}`),
    api(`/commission-tiers?month=${state.month}`).catch(() => ({ tiers: [] })),
  ]);
  const tiers = tiersData.tiers || [];
  root.__payrollData = data;

  let payrollRows = data.payroll;
  if (state.empFilter.q) {
    payrollRows = payrollRows.filter((r) => matchesEmployeeSearch(r, state.empFilter.q));
  }

  root.innerHTML = `
    <div class="page-header"><div><h1>Payroll</h1><p class="muted" id="payroll-emp-count">${payrollRows.length} employees · ${monthLabel(state.month)} · ${data.workingDays} working days · Transport 3,000 EGP/mo</p></div>
      <div class="btn-row">
        <button class="btn btn-sm btn-primary" id="init-month-profiles">Init month profiles</button>
        <button class="btn btn-sm" id="export-payroll-pdf">Export PDF</button>
        <button class="btn btn-sm" id="record-loan-payments">Record loan payments</button>
        <button class="btn btn-sm" id="manage-loans-btn">Loans</button>
        <button class="btn btn-sm" id="export-cash">Cash CSV</button>
        <button class="btn btn-sm" id="export-bank">Bank CSV</button>
        <button class="btn btn-sm" id="export-insta">Insta CSV</button>
      </div>
    </div>
    ${monthToolbar(`${employeeSearchInputHtml()}${hideOutToggle()}`)}
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
      <div class="card card-stat"><strong>${fmt(data.totals.totalDeductions)}</strong><span class="muted">Deductions</span></div>
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
  bindEmployeeSearch(root, () => updatePayrollTable(root));

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
      await downloadFile(`/payroll/pdf?month=${state.month}${state.hideOut ? "" : "&showOut=true"}`, `payroll-${state.month}.pdf`);
    } catch (err) {
      alert(err.message);
    } finally {
      setButtonLoading(btn, false);
    }
  };
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
  root.querySelector("#export-cash").onclick = () =>
    downloadFile(`/exports/payments?month=${state.month}&method=cash&format=csv`, `cash-${state.month}.csv`).catch((e) => alert(e.message));
  root.querySelector("#export-bank").onclick = () =>
    downloadFile(`/exports/payments?month=${state.month}&method=bank&format=csv`, `bank-${state.month}.csv`).catch((e) => alert(e.message));
  root.querySelector("#export-insta").onclick = () =>
    downloadFile(`/exports/payments?month=${state.month}&method=insta&format=csv`, `insta-${state.month}.csv`).catch((e) => alert(e.message));
  bindPayrollRowClicks(root);
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
        <h4>New loan</h4>
        <form id="loan-form" class="field-grid">
          <label class="field"><span>Total amount (EGP)</span><input name="totalAmount" type="number" min="1" required /></label>
          <label class="field"><span>Per salary (EGP)</span><input name="installmentAmount" type="number" min="1" placeholder="500" /></label>
          <label class="field"><span>Number of salaries</span><input name="installmentsCount" type="number" min="1" placeholder="2" /></label>
          <label class="field"><span>Skip current payroll</span><input name="skipCurrentMonth" type="checkbox" title="Start deductions from next month" /></label>
          <label class="field" style="grid-column:1/-1"><span>Notes</span><input name="notes" /></label>
        </form>
        <p class="muted" style="margin:.5rem 0 0">Enter either per-salary amount or number of salaries (e.g. 1,000 loan → 500 × 2 salaries).</p>
        <button class="btn btn-primary btn-sm" id="save-loan-btn" style="margin-top:.5rem">Create loan</button>
      </div>
    </div>`,
    true
  );

  document.getElementById("save-loan-btn").onclick = async () => {
    const fd = new FormData(document.getElementById("loan-form"));
    try {
      await api("/loans", {
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
      openEmployeeLoansModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  };
  document.querySelectorAll("[data-close]").forEach((b) => {
    b.onclick = () => {
      closeModal();
      openEmployeeLoansModal(employeeId);
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

async function openEmployeeWarningsModal(employeeId) {
  const data = await api(`/warnings/${employeeId}`);
  const list = (data.warnings || [])
    .map(
      (w) =>
        `<div class="card card-flat"><div class="flex-between"><strong>${w.type}: ${w.title || "—"}</strong><span class="muted">${w.date}</span></div>
          <p style="margin:.5rem 0 0">${w.content}</p>
          <div class="muted" style="font-size:.75rem">${w.createdBy || ""} · ${w.severity || "normal"}</div></div>`
    )
    .join("");

  openModal(
    `<div class="modal-header"><h2>Warnings & notes — ${employeeId}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      <div class="stack">${list || '<p class="muted">No warnings or notes yet.</p>'}</div>
      <div class="card" style="margin-top:1rem">
        <h4>Add warning / note</h4>
        <form id="warn-form" class="field-grid">
          <label class="field"><span>Type</span><select name="type"><option>Warning</option><option>Note</option><option>Verbal warning</option><option>Written warning</option></select></label>
          <label class="field"><span>Date</span><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label class="field" style="grid-column:1/-1"><span>Title</span><input name="title" required /></label>
          <label class="field" style="grid-column:1/-1"><span>Content</span><textarea name="content" required></textarea></label>
          <label class="field"><span>Severity</span><select name="severity"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        </form>
        <button class="btn btn-primary btn-sm" id="add-warn-btn">Save</button>
      </div>
    </div>`,
    true
  );

  document.getElementById("add-warn-btn").onclick = async () => {
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
        }),
      });
      closeModal();
      openEmployeeWarningsModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  };
}

async function renderSalaries(root) {
  const [ratesData, adjData] = await Promise.all([
    api("/position-rates"),
    api(`/payroll-adjustments?month=${state.month}`),
  ]);
  const raises = adjData.adjustments.filter((a) => a.salaryRaise > 0);

  root.innerHTML = `
    <div class="page-header"><div><h1>Salaries</h1><p class="muted">Position rates & monthly raises for ${monthLabel(state.month)}</p></div></div>
    ${monthToolbar("")}
    <div class="grid-2">
      <div class="card">
        <div class="flex-between" style="margin-bottom:1rem"><h3 style="margin:0">Position rates</h3>
          <button class="btn btn-sm btn-primary" id="add-rate-btn">+ Add position</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Position</th><th class="text-right">Monthly (EGP)</th><th></th></tr></thead>
          <tbody id="rates-body">${ratesData.rates.map((r) => `<tr>
            <td>${r.position}</td>
            <td class="text-right"><input class="inline-input" data-pos="${r.position}" type="number" value="${r.monthlySalary}" /></td>
            <td><button class="btn btn-sm" data-save-rate="${r.position}">Save</button></td>
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
      const input = root.querySelector(`input[data-pos="${pos}"]`);
      await api("/position-rates", {
        method: "PUT",
        body: JSON.stringify({ position: pos, monthlySalary: Number(input.value) }),
      });
      btn.textContent = "Saved";
      setTimeout(() => { btn.textContent = "Save"; }, 1500);
    };
  });
  root.querySelector("#add-rate-btn").onclick = async () => {
    const position = prompt("Position name:");
    if (!position) return;
    const salary = Number(prompt("Monthly salary (EGP):"));
    if (!salary) return;
    await api("/position-rates", { method: "PUT", body: JSON.stringify({ position, monthlySalary: salary }) });
    renderSalaries(root);
  };
}

async function openEmployeeDocsModal(employeeId) {
  const data = await api(`/documents/${employeeId}`);
  const docList = (data.documents || [])
    .map(
      (d) =>
        `<div class="adj-row"><span><strong>${d.docType}</strong> — ${d.fileName}
          ${d.expiry ? `<span class="muted"> (exp: ${d.expiry})</span>` : ""}</span>
          ${d.driveLink ? `<a href="${d.driveLink}" target="_blank" class="btn btn-sm">Open</a>` : ""}</div>`
    )
    .join("");

  openModal(
    `<div class="modal-header"><h2>Documents — ${employeeId}</h2><button class="btn btn-sm" data-close>✕</button></div>
    <div class="modal-body">
      ${docList || '<p class="muted">No documents uploaded yet.</p>'}
      <div class="card" style="margin-top:1rem">
        <h4>Upload document</h4>
        <form id="doc-form" class="field-grid">
          <label class="field"><span>Type</span><select name="docType">${data.docTypes.map((t) => `<option value="${t}">${t}</option>`).join("")}</select></label>
          <label class="field"><span>Expiry (optional)</span><input name="expiry" type="date" /></label>
          <label class="field" style="grid-column:1/-1"><span>Notes</span><input name="notes" /></label>
          <label class="field" style="grid-column:1/-1"><span>File</span><input name="file" type="file" required /></label>
        </form>
        <button class="btn btn-primary btn-sm" id="upload-doc-btn">Upload</button>
      </div>
    </div>`,
    true
  );

  document.getElementById("upload-doc-btn").onclick = async () => {
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
        }),
      });
      closeModal();
      openEmployeeDocsModal(employeeId);
    } catch (e) {
      alert(e.message);
    }
  };
}

async function renderReports(root) {
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
}

async function renderSettings(root) {
  const [status, changelog] = await Promise.all([
    api("/status"),
    api("/changelog?limit=50").catch(() => ({ entries: [] })),
  ]);

  root.innerHTML = `
    <div class="page-header"><h1>Settings</h1></div>
    <div class="grid-2">
      <div class="card">
        <h3>Display</h3>
        <label class="toggle-label"><input type="checkbox" id="set-hide-out" ${status.hideOutEmployees ? "checked" : ""} /> Hide out / inactive employees</label>
        <p class="muted">When enabled, employees with status "Out" or blank inactive rows are hidden from lists.</p>
      </div>
      <div class="card">
        <h3>Data sync</h3>
        <p class="muted">Last sync: ${status.lastSync ? timeAgo(status.lastSync) : "Never"}</p>
        <button class="btn btn-primary" id="settings-refresh">Refresh from Google Sheet</button>
      </div>
    </div>
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
    </div>`;

  root.querySelector("#set-hide-out").onchange = async (e) => {
    state.hideOut = e.target.checked;
    await api("/settings/hide-out", {
      method: "PUT",
      body: JSON.stringify({ hide: state.hideOut }),
    });
  };
  root.querySelector("#settings-refresh").onclick = () => refreshData();
}

function navigate(page) {
  state.page = page;
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.page === page)
  );
  render();
}

async function render() {
  const root = document.getElementById("app");
  root.innerHTML = pageSkeleton();
  try {
    if (state.page === "dashboard") await renderDashboard(root);
    else if (state.page === "attendance") await renderAttendance(root);
    else if (state.page === "employees") await renderEmployees(root);
    else if (state.page === "payroll") await renderPayroll(root);
    else if (state.page === "salaries") await renderSalaries(root);
    else if (state.page === "reports") await renderReports(root);
    else if (state.page === "settings") await renderSettings(root);
  } catch (e) {
    root.innerHTML = `<div class="alert alert-warn">${e.message}</div>`;
  }
}

document.querySelectorAll(".nav-btn").forEach((b) =>
  b.addEventListener("click", () => navigate(b.dataset.page))
);
document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/logout", { method: "POST" });
  if (window.hrDesktop) await window.hrDesktop.clearSession();
  window.location.href = "/login";
});
document.getElementById("refresh-btn").addEventListener("click", () => refreshData());

(async () => {
  await initialSync();
  render();
  setInterval(checkSession, SESSION_CHECK_MS);
})();
