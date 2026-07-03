/**
 * HRMS advanced features UI — loaded before app.js; hooks called from app.js.
 */
window.HRMSFeatures = (function () {
  function holidayCountryLabel(country) {
    const c = String(country || "USA").toUpperCase();
    if (c === "EGY") return "Egyptian holiday";
    return "Federal holiday";
  }

  function holidayForDate(date, holidays) {
    const day = String(date || "").slice(0, 10);
    return (holidays || []).find((h) => {
      const hd = String(h.date || h.holidayDate || "").slice(0, 10);
      return hd === day;
    });
  }

  function attendanceDayClass(date, data) {
    const parts = [];
    if (typeof isWeekend === "function" && isWeekend(date)) parts.push("weekend-col");
    if (holidayForDate(date, data.holidays)) parts.push("holiday-col");
    return parts.join(" ");
  }

  function attendanceDayTitle(date, data) {
    const h = holidayForDate(date, data.holidays);
    return h ? `${holidayCountryLabel(h.country)}: ${h.name}` : "";
  }

  function attendanceDayHolidayName(date, data) {
    const h = holidayForDate(date, data.holidays);
    return h?.name ? String(h.name).trim() : "";
  }

  function attendanceHolidaysBannerHtml(data) {
    const list = (data.holidays || []).filter((h) => h.active !== false);
    if (!list.length) return "";

    const renderSection = (title, rows, tag) => {
      const items = rows
        .map((h) => {
          const d = String(h.date || h.holidayDate || "").slice(0, 10);
          return `<li><strong>${escapeHtml(d)}</strong> — ${escapeHtml(h.name)} <span class="muted">(${escapeHtml(tag)})</span></li>`;
        })
        .join("");
      return `<div class="att-holidays-section"><strong>${escapeHtml(title)}</strong><ul class="att-holidays-list">${items}</ul></div>`;
    };

    const usa = list.filter((h) => String(h.country || "USA").toUpperCase() !== "EGY");
    const egy = list.filter((h) => String(h.country || "").toUpperCase() === "EGY");
    const sections = [];
    if (usa.length) sections.push(renderSection("US federal holidays", usa, "federal"));
    if (egy.length) sections.push(renderSection("Egyptian holidays", egy, "Egypt"));
    return `<div class="alert alert-info att-holidays-banner"><strong>Holidays this month</strong>${sections.join("")}<span class="muted">Pink columns are holidays — Day-OFF is prefilled on init when empty.</span></div>`;
  }

  function attendanceBannersHtml(data) {
    const parts = [];
    parts.push(attendanceHolidaysBannerHtml(data));
    if (data.workingDaysNote) {
      parts.push(`<div class="alert alert-warn">${escapeHtml(data.workingDaysNote)}</div>`);
    }
    if (data.payrollMonthLocked) {
      parts.push(`<div class="alert alert-warn">Payroll month is <strong>locked</strong> — attendance and bonus/deduction edits are blocked.</div>`);
    }
    return parts.join("");
  }

  async function initNotificationsBell(api, state) {
    const mount = document.getElementById("sidebar-notif-wrap");
    if (!mount || document.getElementById("hr-notif-bell")) return;

    let lastCount = 0;
    let lastTopId = "";

    function playNotifSound() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.36);
        osc.onended = () => ctx.close().catch(() => {});
      } catch {
        /* ignore */
      }
    }

    const btn = document.createElement("button");
    btn.id = "hr-notif-bell";
    btn.className = "btn btn-sm btn-ghost notif-bell";
    btn.type = "button";
    btn.title = "Notifications";
    btn.setAttribute("aria-label", "Notifications");
    btn.innerHTML = '🔔 <span id="hr-notif-count" class="notif-count hidden">0</span>';
    mount.appendChild(btn);

    const panel = document.createElement("div");
    panel.id = "hr-notif-panel";
    panel.className = "notif-panel hidden";
    panel.setAttribute("role", "menu");
    document.body.appendChild(panel);

    function positionPanel() {
      const rect = btn.getBoundingClientRect();
      panel.style.top = `${Math.round(rect.bottom + 8)}px`;
      panel.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - 340))}px`;
    }

    async function refresh(playSound = false) {
      try {
        const { notifications } = await api("/hrms/notifications");
        const items = notifications || [];
        const countEl = document.getElementById("hr-notif-count");
        const topId = items[0]?.id || items[0]?.title || "";
        if (playSound && items.length > 0 && (items.length > lastCount || topId !== lastTopId)) {
          playNotifSound();
        }
        lastCount = items.length;
        lastTopId = topId;
        if (countEl) {
          countEl.textContent = String(items.length);
          countEl.classList.toggle("hidden", items.length === 0);
        }
        btn.classList.toggle("notif-bell-has-items", items.length > 0);
        panel.innerHTML =
          items.length === 0
            ? '<p class="muted notif-empty">No notifications</p>'
            : `<div class="notif-panel-header"><strong>Notifications</strong><span class="muted">${items.length}</span></div>` +
              items
                .map(
                  (n) =>
                    `<div class="notif-item" role="menuitem"><strong>${escapeHtml(n.title)}</strong><p class="muted">${escapeHtml(n.body || "")}</p></div>`
                )
                .join("");
      } catch (err) {
        const countEl = document.getElementById("hr-notif-count");
        if (countEl) {
          countEl.textContent = "!";
          countEl.classList.remove("hidden");
          countEl.title = err?.message || "Could not load notifications";
        }
      }
    }

    btn.onclick = (e) => {
      e.stopPropagation();
      const open = !panel.classList.contains("hidden");
      if (open) {
        panel.classList.add("hidden");
      } else {
        positionPanel();
        panel.classList.remove("hidden");
        refresh(false);
      }
    };
    document.addEventListener("click", () => panel.classList.add("hidden"));
    window.addEventListener("resize", () => {
      if (!panel.classList.contains("hidden")) positionPanel();
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
    await refresh(false);
    setInterval(() => refresh(true), 120000);
  }

  async function renderLeavePage(root, api, state, helpers) {
    const { escapeHtml, openModal, closeModal, employeeSelectOptions } = helpers;
    const [data, empData] = await Promise.all([
      api("/hrms/leave"),
      api(`/employees${typeof employeesQuery === "function" ? employeesQuery() : ""}`).catch(() => ({ employees: [] })),
    ]);
    const employees = empData.employees || [];
    const requests = data.requests || [];
    root.innerHTML = `
      <div class="page-header flex-between">
        <div><h1>Leave requests</h1><p class="muted">Approvers: Mark, Raymond, Phoebe</p></div>
        <button class="btn btn-primary" id="new-leave-btn">+ Request leave</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Dates</th><th>Type</th><th>Status</th><th>Notes</th><th></th></tr></thead>
        <tbody>${requests
          .map(
            (r) => `<tr>
            <td>${escapeHtml(r.employeeId)}</td>
            <td>${r.startDate} – ${r.endDate}</td>
            <td>${escapeHtml(r.leaveType || r.type || "")}</td>
            <td><span class="badge">${r.status}</span></td>
            <td>${escapeHtml(r.notes || "")}</td>
            <td>${data.canApprove && r.status === "pending" ? `<button class="btn btn-sm" data-approve="${r.id}">Approve</button> <button class="btn btn-sm" data-reject="${r.id}">Reject</button>` : ""}</td>
          </tr>`
          )
          .join("") || '<tr><td colspan="6" class="muted">No leave requests</td></tr>'}
        </tbody>
      </table></div>`;

    root.querySelector("#new-leave-btn").onclick = () => {
      openModal(`
        <div class="modal-header"><h2>Leave request</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="leave-form" class="modal-body field-grid modal-body-scroll">
          <label class="field"><span>Employee</span><select name="employeeId" required>${employeeSelectOptions(employees)}</select></label>
          <label class="field"><span>Start</span><input name="startDate" type="date" required /></label>
          <label class="field"><span>End</span><input name="endDate" type="date" required /></label>
          <label class="field"><span>Type</span><select name="leaveType"><option value="annual">Annual</option><option value="sick">Sick</option><option value="unpaid">Unpaid</option><option value="other">Other</option></select></label>
          <label class="field" style="grid-column:1/-1"><span>Notes</span><textarea name="notes"></textarea></label>
        </form>
        <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="submit-leave">Submit</button></div>`, true);
      document.getElementById("submit-leave").onclick = async () => {
        const fd = new FormData(document.getElementById("leave-form"));
        await api("/hrms/leave", { method: "POST", body: JSON.stringify(Object.fromEntries(fd)) });
        closeModal();
        renderLeavePage(root, api, state, helpers);
      };
    };

    root.querySelectorAll("[data-approve]").forEach((b) => {
      b.onclick = async () => {
        await api(`/hrms/leave/${b.dataset.approve}`, { method: "PUT", body: JSON.stringify({ status: "approved" }) });
        renderLeavePage(root, api, state, helpers);
      };
    });
    root.querySelectorAll("[data-reject]").forEach((b) => {
      b.onclick = async () => {
        await api(`/hrms/leave/${b.dataset.reject}`, { method: "PUT", body: JSON.stringify({ status: "rejected" }) });
        renderLeavePage(root, api, state, helpers);
      };
    });
  }

  async function renderOrgPage(root, api, helpers = {}) {
    const {
      openEmployeeModal = window.openEmployeeModal,
      escapeHtml: esc = window.escapeHtml,
      openModal,
      closeModal,
      canManagePayrollEvents,
    } = helpers;
    const canManage = typeof canManagePayrollEvents === "function" && canManagePayrollEvents();
    const eq = typeof employeesQuery === "function" ? employeesQuery() : "";
    const [structure, empData, teamsRes] = await Promise.all([
      api(`/hrms/org-structure${eq}`),
      api(`/employees${eq}`).catch(() => ({ employees: [] })),
      api("/hrms/teams").catch(() => ({ teams: [], orgUnits: ["HS-1", "HS-2", "HS-3", "HS-MGMT"] })),
    ]);
    const employees = empData.employees || [];
    const orgUnits = teamsRes.orgUnits || structure.orgUnits || ["HS-1", "HS-2", "HS-3", "HS-MGMT"];
    const allTeams = teamsRes.teams || [];
    if (typeof state !== "undefined") state.orgTeams = allTeams;

    const teamNames = [...new Set(allTeams.map((t) => t.name).concat(employees.map((e) => e.team).filter(Boolean)))].sort();
    const unitSections = (structure.units || []).map((section) => {
      const teams = section.teams || [];
      return `<section class="card org-unit-block" style="margin-bottom:1rem">
        <div class="flex-between" style="margin-bottom:.75rem">
          <h2 style="margin:0">${esc(section.unit)}</h2>
          ${canManage ? `<button class="btn btn-sm" data-add-team-unit="${esc(section.unit)}">+ Add team</button>` : ""}
        </div>
        <div class="stack">${teams.map((t) => {
          const agents = t.agents || [];
          const dialBadge = t.dialsSales === false ? '<span class="badge muted">No dial</span>' : "";
          return `<details class="card card-flat" open>
            <summary class="flex-between">
              <span><strong>${esc(t.name)}</strong> ${dialBadge} <span class="muted">(${agents.length})</span></span>
              ${canManage ? `<button type="button" class="btn btn-sm" data-edit-team="${esc(t.id || "")}" data-team-name="${esc(t.name)}">Edit</button>` : ""}
            </summary>
            <div class="table-wrap" style="margin-top:.5rem"><table>
              <thead><tr><th>ID</th><th>Name</th><th>Position</th>${canManage ? "<th>Team</th>" : ""}</tr></thead>
              <tbody>${agents.map((a) => `<tr class="clickable-row" data-agent-id="${esc(a.id)}">
                <td>${esc(a.id)}</td>
                <td>${esc(a.name)}</td>
                <td>${esc(a.position || "—")}</td>
                ${canManage ? `<td><select class="org-team-select" data-emp-id="${esc(a.id)}">
                  <option value="">—</option>
                  ${teamNames.map((tn) => `<option value="${esc(tn)}" ${tn === t.name ? "selected" : ""}>${esc(tn)}</option>`).join("")}
                </select></td>` : ""}
              </tr>`).join("") || `<tr><td colspan="${canManage ? 4 : 3}" class="muted">No agents</td></tr>`}
              </tbody>
            </table></div>
          </details>`;
        }).join("") || '<p class="muted">No teams in this unit.</p>'}</div>
      </section>`;
    }).join("");

    const unassigned = structure.unassigned || [];
    root.innerHTML = `
      <div class="page-header flex-between">
        <div><h1>Organization</h1><p class="muted">Teams by unit (HS-1, HS-2, HS-3, HS-MGMT) — click an agent to open profile</p></div>
      </div>
      ${unitSections || '<p class="muted">No organization data.</p>'}
      ${unassigned.length ? `<section class="card"><h3>Unassigned (no team)</h3>
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th>${canManage ? "<th>Assign team</th>" : ""}</tr></thead>
        <tbody>${unassigned.map((a) => `<tr class="clickable-row" data-agent-id="${esc(a.id)}">
          <td>${esc(a.id)}</td><td>${esc(a.name)}</td>
          ${canManage ? `<td><select class="org-team-select" data-emp-id="${esc(a.id)}">
            <option value="">—</option>
            ${teamNames.map((tn) => `<option value="${esc(tn)}">${esc(tn)}</option>`).join("")}
          </select></td>` : ""}
        </tr>`).join("")}
        </tbody></table></div></section>` : ""}`;

    root.querySelectorAll("[data-agent-id]").forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest(".org-team-select")) return;
        const emp = employees.find((x) => String(x.id) === String(row.dataset.agentId));
        if (emp && typeof openEmployeeModal === "function") openEmployeeModal(emp);
      };
    });

    root.querySelectorAll(".org-team-select").forEach((sel) => {
      sel.addEventListener("click", (e) => e.stopPropagation());
      sel.addEventListener("change", async () => {
        try {
          const res = await api(`/employees/${sel.dataset.empId}`, {
            method: "PUT",
            body: JSON.stringify({ team: sel.value }),
          });
          if (res.employee && typeof patchEmployeeInCache === "function") patchEmployeeInCache(res.employee);
          await renderOrgPage(root, api, helpers);
        } catch (e) {
          alert(e.message);
        }
      });
    });

    root.querySelectorAll("[data-add-team-unit]").forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        const unit = btn.dataset.addTeamUnit;
        const unassignedTeams = allTeams.filter((t) => !t.unit || t.unit !== unit);
        const teamPickOpts = unassignedTeams.length
          ? unassignedTeams.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} (${esc(t.unit || "unassigned")})</option>`).join("")
          : allTeams.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
        openModal(`
          <div class="modal-header"><h2>Add team — ${esc(unit)}</h2><button class="btn btn-sm" data-close>✕</button></div>
          <div class="modal-body field-grid">
            <label class="field"><span>Assign existing team</span>
              <select id="assign-existing-team"><option value="">— Create new below —</option>${teamPickOpts}</select>
            </label>
            <button type="button" class="btn btn-sm btn-primary" id="assign-team-btn">Assign selected team to ${esc(unit)}</button>
            <hr style="grid-column:1/-1" />
            <p class="muted" style="grid-column:1/-1">Or create a new team:</p>
          </div>
          <form id="new-team-form" class="modal-body field-grid">
            <label class="field"><span>Team name</span><input name="name" placeholder="e.g. Kate" /></label>
            <label class="field"><span>Unit</span>
              <select name="unit">${orgUnits.map((u) => `<option value="${esc(u)}" ${u === unit ? "selected" : ""}>${esc(u)}</option>`).join("")}</select>
            </label>
            <label class="field"><span>Dials sales</span>
              <select name="dialsSales"><option value="true">Yes — dialing team</option><option value="false">No — support / mgmt</option></select>
            </label>
            <label class="field"><span>Display order</span><input name="displayOrder" type="number" value="0" /></label>
          </form>
          <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save-new-team">Create new team</button></div>`);
        document.getElementById("assign-team-btn").onclick = async () => {
          const teamId = document.getElementById("assign-existing-team")?.value;
          if (!teamId) return alert("Select a team to assign, or create a new one below.");
          const team = allTeams.find((t) => t.id === teamId);
          if (!team) return;
          await api(`/hrms/teams/${team.id}`, {
            method: "PATCH",
            body: JSON.stringify({ name: team.name, unit, dialsSales: team.dialsSales !== false, displayOrder: team.displayOrder || 0 }),
          });
          closeModal();
          await renderOrgPage(root, api, helpers);
        };
        document.getElementById("save-new-team").onclick = async () => {
          const fd = new FormData(document.getElementById("new-team-form"));
          const name = String(fd.get("name") || "").trim();
          if (!name) return alert("Enter a team name");
          await api("/hrms/teams", {
            method: "POST",
            body: JSON.stringify({
              name: fd.get("name"),
              unit: fd.get("unit"),
              dialsSales: fd.get("dialsSales") === "true",
              displayOrder: Number(fd.get("displayOrder")) || 0,
            }),
          });
          closeModal();
          await renderOrgPage(root, api, helpers);
        };
      };
    });

    root.querySelectorAll("[data-edit-team]").forEach((btn) => {
      if (!btn.dataset.editTeam) return;
      const team = allTeams.find((t) => t.id === btn.dataset.editTeam);
      if (!team) return;
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal(`
          <div class="modal-header"><h2>Edit team — ${esc(team.name)}</h2><button class="btn btn-sm" data-close>✕</button></div>
          <form id="edit-team-form" class="modal-body field-grid">
            <label class="field"><span>Team name</span><input name="name" value="${esc(team.name)}" required /></label>
            <label class="field"><span>Unit</span>
              <select name="unit">${orgUnits.map((u) => `<option value="${esc(u)}" ${u === team.unit ? "selected" : ""}>${esc(u)}</option>`).join("")}</select>
            </label>
            <label class="field"><span>Dials sales</span>
              <select name="dialsSales">
                <option value="true" ${team.dialsSales !== false ? "selected" : ""}>Yes</option>
                <option value="false" ${team.dialsSales === false ? "selected" : ""}>No</option>
              </select>
            </label>
            <label class="field"><span>Display order</span><input name="displayOrder" type="number" value="${team.displayOrder ?? 0}" /></label>
          </form>
          <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save-edit-team">Save</button></div>`);
        document.getElementById("save-edit-team").onclick = async () => {
          const fd = new FormData(document.getElementById("edit-team-form"));
          await api(`/hrms/teams/${team.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: fd.get("name"),
              unit: fd.get("unit"),
              dialsSales: fd.get("dialsSales") === "true",
              displayOrder: Number(fd.get("displayOrder")) || 0,
            }),
          });
          closeModal();
          await renderOrgPage(root, api, helpers);
        };
      };
    });
  }

  const EQUIPMENT_TYPES = ["Mouse", "Keyboard", "Laptop", "Workstation", "Headset", "Phone", "Mini router"];

  function equipmentTypeOptions(selected) {
    return EQUIPMENT_TYPES.map(
      (t) => `<option value="${escapeHtml(t)}" ${t === selected ? "selected" : ""}>${escapeHtml(t)}</option>`
    ).join("");
  }

  function employeeOptionsHtml(employees, selected = "") {
    return employees
      .map(
        (e) =>
          `<option value="${escapeHtml(e.id)}" ${e.id === selected ? "selected" : ""}>${escapeHtml(e.american_name || e.arabic_name || e.id)} (${escapeHtml(e.id)})</option>`
      )
      .join("");
  }

  async function renderEquipmentPage(root, api, helpers) {
    const { escapeHtml, openModal, closeModal } = helpers;
    const [data, empData] = await Promise.all([
      api("/hrms/equipment"),
      api(`/employees${typeof employeesQuery === "function" ? employeesQuery() : ""}`).catch(() => ({ employees: [] })),
    ]);
    const equipment = data.equipment || [];
    const assignments = data.assignments || [];
    const employees = empData.employees || [];
    const filterEmp = state.hrmsEmployeeFilter || "";
    const equipById = new Map(equipment.map((e) => [e.id, e]));
    let activeRows = assignments
      .filter((a) => !a.returnedAt)
      .map((a) => ({ assignment: a, equipment: equipById.get(a.equipmentId) }))
      .filter((r) => r.equipment);
    if (filterEmp) {
      activeRows = activeRows.filter((r) => r.assignment.employeeId === filterEmp);
    }
    const empById = (id) => employees.find((x) => x.id === id);

    root.innerHTML = `
      <div class="page-header flex-between">
        <div><h1>Equipment</h1><p class="muted">Devices issued to agents — unit comes from the employee record${filterEmp ? ` · filtered: <strong>${escapeHtml(filterEmp)}</strong> <button class="btn btn-sm" id="clear-equip-filter">Show all</button>` : ""}</p></div>
        <button class="btn btn-primary btn-sm" id="add-equipment-btn">+ Issue device</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Agent</th><th>Device</th><th>Unit</th><th>Notes</th><th></th></tr></thead>
        <tbody>${activeRows
          .map(({ assignment: a, equipment: e }) => {
            const emp = empById(a.employeeId);
            return `<tr>
              <td><strong>${escapeHtml(emp?.american_name || emp?.arabic_name || a.employeeId)}</strong><br><span class="muted">${escapeHtml(a.employeeId)}</span></td>
              <td>${escapeHtml(e.itemType || "—")}</td>
              <td>${escapeHtml(emp?.unit || e.unit || "")}</td>
              <td class="muted">${escapeHtml(e.notes || "")}</td>
              <td>
                <button class="btn btn-sm" data-return="${a.id}">Return</button>
                <button class="btn btn-sm" data-edit-equip="${e.id}" data-emp="${escapeHtml(a.employeeId)}">Edit</button>
              </td>
            </tr>`;
          })
          .join("") || '<tr><td colspan="5" class="muted">No equipment currently issued</td></tr>'}</tbody>
      </table></div>`;

    root.querySelector("#clear-equip-filter")?.addEventListener("click", () => {
      state.hrmsEmployeeFilter = "";
      renderEquipmentPage(root, api, helpers);
    });

    root.querySelector("#add-equipment-btn").onclick = () => {
      openModal(`
        <div class="modal-header"><h2>Issue device</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="equip-form" class="modal-body field-grid modal-body-scroll">
          <label class="field"><span>Agent</span><select name="employeeId" required>
            <option value="">— Select agent —</option>
            ${employeeOptionsHtml(employees)}
          </select></label>
          <label class="field"><span>Device</span><select name="itemType" required>${equipmentTypeOptions("")}</select></label>
          <label class="field" style="grid-column:1/-1"><span>Notes (optional)</span><textarea name="notes" rows="2"></textarea></label>
        </form>
        <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save-equip">Issue</button></div>`, true);
      document.getElementById("save-equip").onclick = async () => {
        const body = Object.fromEntries(new FormData(document.getElementById("equip-form")));
        await api("/hrms/equipment", { method: "POST", body: JSON.stringify(body) });
        closeModal();
        renderEquipmentPage(root, api, helpers);
      };
    };

    root.querySelectorAll("[data-edit-equip]").forEach((b) => {
      const item = equipment.find((e) => e.id === b.dataset.editEquip);
      if (!item) return;
      const currentEmp = b.dataset.emp || "";
      b.onclick = () => {
        openModal(`
          <div class="modal-header"><h2>Edit equipment</h2><button class="btn btn-sm" data-close>✕</button></div>
          <form id="edit-equip-form" class="modal-body field-grid modal-body-scroll">
            <label class="field"><span>Agent</span><select name="employeeId">
              ${employeeOptionsHtml(employees, currentEmp)}
            </select></label>
            <label class="field"><span>Device</span><select name="itemType" required>${equipmentTypeOptions(item.itemType || "")}</select></label>
            <label class="field" style="grid-column:1/-1"><span>Notes</span><textarea name="notes" rows="2">${escapeHtml(item.notes || "")}</textarea></label>
          </form>
          <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save-edit-equip">Save</button></div>`, true);
        document.getElementById("save-edit-equip").onclick = async () => {
          const body = Object.fromEntries(new FormData(document.getElementById("edit-equip-form")));
          try {
            const emp = employees.find((e) => e.id === body.employeeId);
            await api(`/hrms/equipment/${item.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                itemType: body.itemType,
                notes: body.notes,
                unit: emp?.unit || item.unit,
              }),
            });
            closeModal();
            renderEquipmentPage(root, api, helpers);
          } catch (e) {
            alert(e.message);
          }
        };
      };
    });

    root.querySelectorAll("[data-return]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("Mark this device as returned?")) return;
        await api(`/hrms/equipment/return/${b.dataset.return}`, { method: "POST" });
        renderEquipmentPage(root, api, helpers);
      };
    });
  }

  async function mountEmployeeLifecyclePanel(emp, api, helpers) {
    const body = document.getElementById("emp-modal-body");
    if (!body || !helpers.canManagePayrollEvents()) return;
    const html = await buildLifecyclePanelHtml(emp, api, helpers);
    if (!html) return;
    body.insertAdjacentHTML("beforeend", html);
    bindLifecyclePanel(emp, api, helpers);
  }

  async function buildLifecyclePanelHtml(emp, api, helpers) {
    const { escapeHtml, openModal, closeModal, canManagePayrollEvents } = helpers;
    if (!canManagePayrollEvents()) return "";
    let html = "";
    try {
      const [periods, plans, onboard, offboard] = await Promise.all([
        api(`/hrms/employment-periods/${emp.id}`).catch(() => ({ periods: [] })),
        api(`/hrms/action-plans/${emp.id}`).catch(() => ({ plans: [] })),
        api(`/hrms/onboarding/${emp.id}`).catch(() => ({ checklist: null })),
        api(`/hrms/offboarding/${emp.id}`).catch(() => ({ offboarding: {}, clearance: [] })),
      ]);

      const periodRows = (periods.periods || [])
        .map((p) => `<li>${p.startDate}${p.endDate ? ` → ${p.endDate}` : " (current)"}</li>`)
        .join("");
      const planRows = (plans.plans || [])
        .map(
          (p) =>
            `<li>${p.weekStart} – ${p.weekEnd} <span class="badge">${p.status}</span> ${p.status === "active" ? `<button class="btn btn-sm" data-cancel-aip="${p.id}">Cancel</button>` : ""}</li>`
        )
        .join("");

      const ob = onboard.checklist || {};
      const off = offboard.offboarding || {};
      const clearance = offboard.clearance || [];

      html = `
        <div class="card card-flat" style="margin-top:1rem;grid-column:1/-1" id="hrms-lifecycle-panel">
          <h4>Employment lifecycle</h4>
          <div class="grid-2" style="margin-top:.75rem">
            <div>
              <p class="muted">Employment periods</p>
              <ul class="muted" style="font-size:.85rem">${periodRows || "<li>No periods recorded</li>"}</ul>
              <div class="btn-row" style="margin-top:.5rem">
                <button type="button" class="btn btn-sm" id="hrms-rehire-btn">Re-hire</button>
                <button type="button" class="btn btn-sm" id="hrms-depart-btn">Mark depart</button>
                <button type="button" class="btn btn-sm" id="hrms-add-period-btn">Add period</button>
              </div>
            </div>
            <div>
              <p class="muted">Action Plan Week</p>
              <ul class="muted" style="font-size:.85rem">${planRows || "<li>No plans</li>"}</ul>
              <button type="button" class="btn btn-sm" id="hrms-new-aip-btn" style="margin-top:.5rem">+ Add Action Plan Week</button>
            </div>
          </div>
          <details style="margin-top:1rem">
            <summary>Onboarding checklist</summary>
            <div class="field-grid" style="margin-top:.5rem">
              ${["adUser", "idScanned", "contract", "trainingPhase1", "trainingPhase2", "trainingPhase3", "trainingPhase4"]
                .map(
                  (k) =>
                    `<label class="toggle-label"><input type="checkbox" data-onboard="${k}" ${ob[k] ? "checked" : ""} /> ${k.replace(/([A-Z])/g, " $1")}</label>`
                )
                .join("")}
            </div>
          </details>
          <details id="hrms-offboarding-section" style="margin-top:.75rem">
            <summary>Offboarding & clearance</summary>
            <label class="toggle-label"><input type="checkbox" id="off-revoke" ${off.revokeAccess ? "checked" : ""} /> Revoke access</label>
            <label class="toggle-label"><input type="checkbox" id="off-final-pay" ${off.finalPay ? "checked" : ""} /> Final pay</label>
            ${clearance
              .map(
                (c) =>
                  `<label class="field"><span>${escapeHtml(c.itemKey)}</span>
                <select data-clearance="${c.itemKey}"><option value="pending" ${c.status === "pending" ? "selected" : ""}>Pending</option>
                <option value="done" ${c.status === "done" ? "selected" : ""}>Done</option>
                <option value="not_needed" ${c.status === "not_needed" ? "selected" : ""}>Not needed</option></select></label>`
              )
              .join("")}
          </details>
        </div>`;
    } catch {
      /* supabase optional */
    }
    return html;
  }

  async function refreshLifecyclePanel(emp, api, helpers) {
    const panel = document.getElementById("hrms-lifecycle-panel");
    if (!panel) return;
    const html = await buildLifecyclePanelHtml(emp, api, helpers);
    if (!html) return;
    panel.outerHTML = html;
    bindLifecyclePanel(emp, api, helpers);
  }

  function bindLifecyclePanel(emp, api, helpers) {
    const { openModal, closeModal } = helpers;
    const panel = document.getElementById("hrms-lifecycle-panel");
    if (!panel) return;

    const toast = (msg) => {
      if (typeof showSaveIndicator === "function") showSaveIndicator(msg, "saved");
      else alert(msg);
    };

    panel.querySelector("#hrms-rehire-btn")?.addEventListener("click", () => {
      openModal(`
        <div class="modal-header"><h2>Re-hire ${escapeHtml(emp.american_name || emp.id)}</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="rehire-form" class="modal-body field-grid">
          <label class="field"><span>Start date</span><input name="startDate" type="date" required /></label>
          <label class="field"><span>Status</span><select name="status"><option value="Active">Active</option><option value="Paused">Paused</option></select></label>
          <label class="field" style="grid-column:1/-1"><span>Notes</span><textarea name="notes"></textarea></label>
        </form>
        <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="confirm-rehire">Re-hire</button></div>`);
      document.getElementById("confirm-rehire").onclick = async () => {
        const fd = new FormData(document.getElementById("rehire-form"));
        try {
          await api(`/hrms/employment-periods/${emp.id}/rehire`, {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(fd)),
          });
          closeModal();
          toast("Re-hired — employment period created.");
          await refreshLifecyclePanel(emp, api, helpers);
        } catch (e) {
          alert(e.message);
        }
      };
    });

    panel.querySelector("#hrms-depart-btn")?.addEventListener("click", () => {
      openModal(`
        <div class="modal-header"><h2>Mark depart</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="depart-form" class="modal-body field-grid">
          <label class="field"><span>Depart date</span><input name="departDate" type="date" required /></label>
          <label class="field"><span>Notice</span>
            <select name="notice_type" required>
              <option value="with_notice">Left with 2 weeks notice</option>
              <option value="without_notice">Left without 2 weeks notice</option>
            </select>
          </label>
          <label class="field" style="grid-column:1/-1"><span>Notes</span><textarea name="notes"></textarea></label>
        </form>
        <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="confirm-depart">Save</button></div>`);
      document.getElementById("confirm-depart").onclick = async () => {
        const fd = new FormData(document.getElementById("depart-form"));
        try {
          await api(`/hrms/employment-periods/${emp.id}/depart`, {
            method: "POST",
            body: JSON.stringify({
              departDate: fd.get("departDate"),
              status: "out",
              notice_type: fd.get("notice_type") || "with_notice",
              notes: fd.get("notes"),
            }),
          });
          closeModal();
          toast("Depart recorded.");
          await refreshLifecyclePanel(emp, api, helpers);
        } catch (e) {
          alert(e.message);
        }
      };
    });

    panel.querySelector("#hrms-add-period-btn")?.addEventListener("click", () => {
      openModal(`
        <div class="modal-header"><h2>Add employment period</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="period-form" class="modal-body field-grid">
          <label class="field"><span>Start date</span><input name="startDate" type="date" required /></label>
          <label class="field"><span>End date (optional)</span><input name="endDate" type="date" /></label>
          <label class="field" style="grid-column:1/-1"><span>Notes</span><textarea name="notes"></textarea></label>
        </form>
        <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="confirm-period">Add</button></div>`);
      document.getElementById("confirm-period").onclick = async () => {
        const fd = new FormData(document.getElementById("period-form"));
        try {
          await api(`/hrms/employment-periods/${emp.id}`, {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(fd)),
          });
          closeModal();
          toast("Employment period added.");
          await refreshLifecyclePanel(emp, api, helpers);
        } catch (e) {
          alert(e.message);
        }
      };
    });

    panel.querySelector("#hrms-new-aip-btn")?.addEventListener("click", () => {
      openModal(`
        <div class="modal-header"><h2>Action Plan Week</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="aip-form" class="modal-body field-grid">
          <label class="field"><span>Week start (Monday)</span><input name="weekStart" type="date" required /></label>
        </form>
        <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="confirm-aip">Create</button></div>`);
      document.getElementById("confirm-aip").onclick = async () => {
        const weekStart = document.querySelector("#aip-form [name=weekStart]").value;
        try {
          await api("/hrms/action-plans", { method: "POST", body: JSON.stringify({ employeeId: emp.id, weekStart }) });
          closeModal();
          toast("Action Plan Week created.");
          await refreshLifecyclePanel(emp, api, helpers);
        } catch (e) {
          alert(e.message);
        }
      };
    });

    panel.querySelectorAll("[data-cancel-aip]").forEach((b) => {
      b.onclick = async () => {
        try {
          await api(`/hrms/action-plans/${b.dataset.cancelAip}/cancel`, { method: "POST" });
          toast("Action Plan Week cancelled.");
          await refreshLifecyclePanel(emp, api, helpers);
        } catch (e) {
          alert(e.message);
        }
      };
    });
        panel.querySelectorAll("[data-onboard]").forEach((cb) => {
          cb.onchange = async () => {
            const body = {};
            panel.querySelectorAll("[data-onboard]").forEach((x) => {
              body[x.dataset.onboard] = x.checked;
            });
            await api(`/hrms/onboarding/${emp.id}`, { method: "PUT", body: JSON.stringify(body) });
          };
        });
        const saveOff = async () => {
          await api(`/hrms/offboarding/${emp.id}`, {
            method: "PUT",
            body: JSON.stringify({
              revokeAccess: panel.querySelector("#off-revoke")?.checked,
              finalPay: panel.querySelector("#off-final-pay")?.checked,
            }),
          });
        };
        panel.querySelector("#off-revoke")?.addEventListener("change", saveOff);
        panel.querySelector("#off-final-pay")?.addEventListener("change", saveOff);
        panel.querySelectorAll("[data-clearance]").forEach((sel) => {
          sel.onchange = async () => {
            await api(`/hrms/clearance/${emp.id}/${sel.dataset.clearance}`, {
              method: "PUT",
              body: JSON.stringify({ status: sel.value }),
            });
          };
        });
  }

  async function appendEmployeeLifecyclePanel() {
    return "";
  }

  async function enhanceDashboard(root, api) {
    try {
      const { expiring } = await api("/documents/expiring");
      if (expiring?.length) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `<h3>Documents expiring (60 days)</h3><ul>${expiring
          .slice(0, 8)
          .map((d) => `<li>${escapeHtml(d.employeeId)}: ${escapeHtml(d.docType)} — ${d.expiry}</li>`)
          .join("")}</ul>`;
        root.querySelector(".grid-2")?.appendChild(card);
      }
    } catch {
      /* optional */
    }
    try {
      const { alerts } = await api("/hrms/alerts/employment?days=60");
      if (alerts?.length) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `<h3>Probation / contract ending (60 days)</h3><ul>${alerts
          .slice(0, 10)
          .map(
            (a) =>
              `<li>${escapeHtml(a.employeeId)} (${escapeHtml(a.name)}): ${a.type === "probation" ? "Probation" : "Contract"} ends ${a.date}</li>`
          )
          .join("")}</ul>`;
        root.querySelector(".grid-2")?.appendChild(card);
      }
    } catch {
      /* optional */
    }
  }

  async function enhancePayroll(root, api, state, helpers) {
    const { downloadFile, monthLabel, fmt, isChangesViewer } = helpers;
    let lock = null;
    try {
      lock = await api(`/hrms/payroll-lock/${state.month}`);
    } catch {
      /* ignore */
    }
    const header = root.querySelector(".page-header .btn-row");
    if (header && !document.getElementById("payroll-lock-btn")) {
      const lockBtn = document.createElement("button");
      lockBtn.id = "payroll-lock-btn";
      lockBtn.className = "btn btn-sm";
      lockBtn.textContent = lock?.lock ? "Unlock month" : "Lock month";
      lockBtn.onclick = async () => {
        await api(`/hrms/payroll-lock/${state.month}`, {
          method: "PUT",
          body: JSON.stringify({ locked: !lock?.lock, notes: "" }),
        });
        helpers.render();
      };
      header.prepend(lockBtn);

      const compareBtn = document.createElement("button");
      compareBtn.className = "btn btn-sm";
      compareBtn.textContent = "MoM compare";
      compareBtn.onclick = async () => {
        const report = await api(`/hrms/reports/payroll-compare?month=${state.month}`);
        alert(
          `Net pay ${monthLabel(state.month)}: ${fmt(report.current.totalNet)} EGP\nPrior month: ${fmt(report.previous.totalNet)} EGP\nDelta: ${fmt(report.deltaNet)} EGP${report.anomalies.length ? "\n\n" + report.anomalies.join("\n") : ""}`
        );
      };
      header.prepend(compareBtn);

      if (isChangesViewer()) {
        const finBtn = document.createElement("button");
        finBtn.className = "btn btn-sm btn-primary";
        finBtn.textContent = "Finance handoff ZIP";
        finBtn.onclick = () =>
          downloadFile(`/hrms/exports/finance-handoff?month=${state.month}`, `finance-handoff-${state.month}.zip`);
        header.prepend(finBtn);
      }
    }
    if (lock?.lock) {
      const banner = document.createElement("div");
      banner.className = "alert alert-warn";
      banner.textContent = `Payroll for ${state.month} is locked. Unlock to edit attendance, bonuses, and deductions.`;
      root.querySelector(".page-header")?.after(banner);
    }
  }

  async function enhanceSettings(root, api, state, helpers) {
    const { isChangesViewer, escapeHtml, openModal, closeModal } = helpers;
    const status = await api("/status");
    const taxRules = status.taxRules || { incomeTaxRate: 0, socialInsuranceRate: 0 };

    const grid = root.querySelector(".grid-2");
    if (!grid) return;

    grid.insertAdjacentHTML(
      "beforeend",
      `<div class="card" id="settings-password-card">
        <h3>Change password</h3>
        <form id="pw-form" class="field-grid">
          <label class="field"><span>Current</span><input name="currentPassword" type="password" required /></label>
          <label class="field"><span>New</span><input name="newPassword" type="password" required minlength="4" /></label>
        </form>
        <button class="btn btn-primary btn-sm" id="pw-save">Update password</button>
      </div>
      <div class="card" id="settings-tax-card">
        <h3>Tax rules (finance)</h3>
        <p class="muted">Rates default to 0% until configured.</p>
        <label class="field"><span>Income tax %</span><input id="tax-income" type="number" min="0" max="100" step="0.01" value="${taxRules.incomeTaxRate || 0}" /></label>
        <label class="field"><span>Social insurance %</span><input id="tax-social" type="number" min="0" max="100" step="0.01" value="${taxRules.socialInsuranceRate || 0}" /></label>
        <button class="btn btn-sm" id="tax-save">Save tax rules</button>
      </div>
      <div class="card" id="settings-holidays-card">
        <h3>Federal holidays (USA)</h3>
        <p class="muted">Disabled holidays are excluded from attendance prefill. Manual grid edits always win.</p>
        <div class="btn-row" style="margin-bottom:.5rem">
          <button class="btn btn-sm" id="import-holidays-btn">Import federal holidays (2024–2028)</button>
          <button class="btn btn-sm" id="add-holiday-btn">+ Add holiday</button>
        </div>
        <div id="holidays-list-usa" class="muted">Loading…</div>
      </div>`
    );

    const role = String(status.user?.role || "").toLowerCase();
    const isHolidayAdmin = ["admin", "ceo"].includes(role);
    if (isHolidayAdmin) {
      grid.insertAdjacentHTML(
        "beforeend",
        `<div class="card" id="settings-holidays-egy-card">
          <h3>Egyptian holidays</h3>
          <p class="muted">Imported inactive by default. When enabled, they affect attendance for everyone (pink columns, Day-OFF prefill). Only Admin can import or toggle.</p>
          <div class="btn-row" style="margin-bottom:.5rem">
            <button class="btn btn-sm" id="import-holidays-egy-btn">Import Egyptian holidays (2024–2028)</button>
          </div>
          <div id="holidays-list-egy" class="muted">Loading…</div>
        </div>`
      );
    }

    root.querySelector("#pw-save").onclick = async () => {
      const fd = new FormData(root.querySelector("#pw-form"));
      await api("/auth/change-password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword") }),
      });
      alert("Password updated.");
      root.querySelector("#pw-form").reset();
    };

    root.querySelector("#tax-save").onclick = async () => {
      await api("/settings/tax-rules", {
        method: "PUT",
        body: JSON.stringify({
          incomeTaxRate: root.querySelector("#tax-income").value,
          socialInsuranceRate: root.querySelector("#tax-social").value,
        }),
      });
      alert("Tax rules saved.");
    };

    async function loadHolidaysList(elId, country, { canToggle = true } = {}) {
      const { holidays } = await api("/hrms/holidays");
      const el = root.querySelector(elId);
      if (!el) return;
      const filtered = (holidays || []).filter((h) => {
        const c = String(h.country || "USA").toUpperCase();
        return country === "EGY" ? c === "EGY" : c !== "EGY";
      });
      const byYear = {};
      for (const h of filtered) {
        const y = String(h.date || h.holidayDate || "").slice(0, 4) || "Other";
        if (!byYear[y]) byYear[y] = [];
        byYear[y].push(h);
      }
      const years = Object.keys(byYear).sort();
      const emptyMsg =
        country === "EGY"
          ? "No Egyptian holidays — click Import Egyptian holidays."
          : "No holidays configured — click Import federal holidays.";
      el.innerHTML =
        years
          .map((year) => {
            const rows = byYear[year]
              .map(
                (h) =>
                  `<label class="adj-row toggle-label" style="display:flex;justify-content:space-between;gap:.5rem">
                    <span><input type="checkbox" data-holiday-active="${h.id}" ${h.active !== false ? "checked" : ""} ${canToggle ? "" : "disabled"} />
                    ${h.date || h.holidayDate}: ${escapeHtml(h.name)}</span>
                    <button type="button" class="btn btn-sm" data-del-holiday="${h.id}">Delete</button>
                  </label>`
              )
              .join("");
            return `<details class="holiday-year-block" ${Number(year) >= 2024 ? "open" : ""}>
              <summary><strong>${year}</strong> (${byYear[year].length})</summary>
              <div style="margin-top:.5rem">${rows}</div>
            </details>`;
          })
          .join("") || emptyMsg;
      el.querySelectorAll("[data-del-holiday]").forEach((b) => {
        b.onclick = async () => {
          await api(`/hrms/holidays/${b.dataset.delHoliday}`, { method: "DELETE" });
          loadHolidaysList(elId, country, { canToggle });
        };
      });
      el.querySelectorAll("[data-holiday-active]").forEach((cb) => {
        if (!canToggle) return;
        cb.onchange = async () => {
          try {
            await api(`/hrms/holidays/${cb.dataset.holidayActive}`, {
              method: "PATCH",
              body: JSON.stringify({ active: cb.checked }),
            });
          } catch (e) {
            alert(e.message);
            cb.checked = !cb.checked;
          }
        };
      });
    }

    async function loadHolidays() {
      await loadHolidaysList("#holidays-list-usa", "USA", { canToggle: true });
      if (isHolidayAdmin) {
        await loadHolidaysList("#holidays-list-egy", "EGY", { canToggle: true });
      }
    }
    loadHolidays();
    root.querySelector("#import-holidays-btn").onclick = async () => {
      try {
        const res = await api("/hrms/holidays/import-federal", { method: "POST" });
        alert(`Imported ${res.count || 0} federal holidays.`);
        loadHolidays();
      } catch (e) {
        alert(e.message);
      }
    };
    root.querySelector("#import-holidays-egy-btn")?.addEventListener("click", async () => {
      try {
        const res = await api("/hrms/holidays/import-egyptian", { method: "POST" });
        alert(`Imported ${res.count || 0} Egyptian holidays (inactive until you enable them).`);
        loadHolidays();
      } catch (e) {
        alert(e.message);
      }
    });
    root.querySelector("#add-holiday-btn").onclick = () => {
      openModal(`
        <div class="modal-header"><h2>Add holiday</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="holiday-form" class="modal-body field-grid">
          <label class="field"><span>Date</span><input name="date" type="date" required /></label>
          <label class="field"><span>Name</span><input name="name" required /></label>
        </form>
        <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save-holiday">Save</button></div>`);
      document.getElementById("save-holiday").onclick = async () => {
        const fd = new FormData(document.getElementById("holiday-form"));
        await api("/hrms/holidays", {
          method: "POST",
          body: JSON.stringify({ date: fd.get("date"), name: fd.get("name"), country: "USA" }),
        });
        closeModal();
        loadHolidays();
      };
    };

    if (isChangesViewer() || ["hr", "admin", "ceo"].includes(String(status.user?.role || "").toLowerCase())) {
      grid.insertAdjacentHTML(
        "beforeend",
        `<div class="card" id="settings-cleanup-card">
          <h3>Clean empty employee IDs</h3>
          <p class="muted">Preview stub records with no names and no linked attendance, bonuses, or sales.</p>
          <div id="empty-stubs-list" class="muted">Loading…</div>
          <button class="btn btn-sm btn-danger" id="clean-empty-ids" style="margin-top:.5rem">Delete previewed stubs</button>
        </div>`
      );
      api("/employees/empty-stubs")
        .then(({ stubs }) => {
          const list = root.querySelector("#empty-stubs-list");
          list.innerHTML =
            stubs?.length
              ? stubs.map((s) => `<div class="adj-row">${escapeHtml(s.id)} · ${escapeHtml(s.unit || "")} · ${escapeHtml(s.team || "")}</div>`).join("")
              : "No empty stubs found.";
        })
        .catch((err) => {
          const list = root.querySelector("#empty-stubs-list");
          if (list) list.textContent = err?.message || "Could not load preview (HR/admin + Supabase required).";
        });
      root.querySelector("#clean-empty-ids").onclick = async () => {
        if (!confirm("Delete all empty employee stub records shown in the preview?")) return;
        try {
          const res = await api("/employees/empty-stubs", { method: "DELETE" });
          alert(`Deleted ${res.count || 0} empty record(s).`);
          helpers.render();
        } catch (e) {
          alert(e.message);
        }
      };
    }

    if (status.canManageSessions) {
      grid.insertAdjacentHTML(
        "beforeend",
        `<div class="card"><h3>Active sessions</h3><div id="sessions-list" class="muted">Loading…</div></div>`
      );
      const { sessions } = await api("/auth/sessions");
      const list = root.querySelector("#sessions-list");
      list.innerHTML =
        (sessions || [])
          .map(
            (s) =>
              `<div class="adj-row"><span>${escapeHtml(s.username)} · ${escapeHtml(s.deviceLabel || "device")} · ${s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : ""}</span>
            ${s.revokedAt ? '<span class="badge">revoked</span>' : `<button class="btn btn-sm" data-revoke-session="${s.id}">Revoke</button>`}</div>`
          )
          .join("") || "No sessions.";
      list.querySelectorAll("[data-revoke-session]").forEach((b) => {
        b.onclick = async () => {
          await api(`/auth/sessions/${b.dataset.revokeSession}/revoke`, { method: "POST" });
          helpers.render();
        };
      });
    }

  }

  async function enhanceReports(root, api, state, helpers) {
    const { downloadFile, fmt, openModal, closeModal } = helpers;
    const toolbar = root.querySelector(".page-header .btn-row");
    if (!toolbar || document.getElementById("rpt-turnover-btn")) return;
    const turnoverBtn = document.createElement("button");
    turnoverBtn.id = "rpt-turnover-btn";
    turnoverBtn.className = "btn btn-sm";
    turnoverBtn.textContent = "Turnover report";
    turnoverBtn.onclick = async () => {
      const r = await api("/hrms/reports/turnover");
      alert(`Headcount: ${r.headcount.total}\nActive: ${r.headcount.active}\nOut: ${r.headcount.out}`);
    };
    const rankBtn = document.createElement("button");
    rankBtn.className = "btn btn-sm";
    rankBtn.textContent = "Attendance rankings CSV";
    rankBtn.onclick = () => {
      api(`/hrms/reports/attendance-rankings?month=${state.month}`).then((r) => {
        const header = "employeeId,name,unit,nsnc,lateness,halfDays\n";
        const rows = r.rankings.map((x) => [x.employeeId, x.name, x.unit, x.nsnc, x.lateness, x.halfDays].join(",")).join("\n");
        const blob = new Blob([header + rows], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `attendance-rankings-${state.month}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
    };
    toolbar.append(turnoverBtn, rankBtn);

    const savedCard = document.createElement("div");
    savedCard.className = "card";
    savedCard.style.marginTop = "1rem";
    savedCard.innerHTML = `<h3>Custom reports <button class="btn btn-sm" id="new-saved-report-btn">+ New</button></h3>
      <div id="saved-reports-list" class="muted">Loading…</div>`;
    root.querySelector(".page-header")?.after(savedCard);

    try {
      const { reports, columnSets } = await api("/hrms/saved-reports");
      const list = savedCard.querySelector("#saved-reports-list");
      list.innerHTML = reports?.length
        ? `<table><thead><tr><th>Name</th><th>Type</th><th></th></tr></thead><tbody>${reports
            .map(
              (r) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.reportType)}</td><td class="btn-row">
              <button class="btn btn-sm" data-run-report="${r.id}">Export CSV</button>
              <button class="btn btn-sm btn-danger" data-del-report="${r.id}">Delete</button></td></tr>`
            )
            .join("")}</tbody></table>`
        : "<p>No saved reports yet.</p>";
      list.querySelectorAll("[data-run-report]").forEach((b) => {
        b.onclick = () =>
          downloadFile(`/hrms/saved-reports/${b.dataset.runReport}/run?month=${state.month}`, `report-${state.month}.csv`);
      });
      list.querySelectorAll("[data-del-report]").forEach((b) => {
        b.onclick = async () => {
          if (!confirm("Delete this saved report?")) return;
          await api(`/hrms/saved-reports/${b.dataset.delReport}`, { method: "DELETE" });
          helpers.render();
        };
      });
      savedCard.querySelector("#new-saved-report-btn").onclick = () => {
        const types = Object.keys(columnSets || {});
        openModal(
          `<div class="modal-header"><h2>New saved report</h2><button class="btn btn-sm" data-close>✕</button></div>
          <form id="saved-report-form" class="modal-body field-grid">
            <label class="field"><span>Name</span><input name="name" required /></label>
            <label class="field"><span>Type</span><select name="reportType">${types.map((t) => `<option value="${t}">${t}</option>`).join("")}</select></label>
            <label class="field"><span>Filter unit</span><input name="unit" placeholder="optional" /></label>
            <label class="field"><span>Filter team</span><input name="team" placeholder="optional" /></label>
            <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button></div>
          </form>`,
          true
        );
        document.getElementById("saved-report-form").onsubmit = async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const reportType = fd.get("reportType");
          const filters = {};
          if (fd.get("unit")) filters.unit = fd.get("unit");
          if (fd.get("team")) filters.team = fd.get("team");
          filters.month = state.month;
          await api("/hrms/saved-reports", {
            method: "POST",
            body: JSON.stringify({
              name: fd.get("name"),
              reportType,
              filters,
              columns: columnSets[reportType] || [],
            }),
          });
          closeModal();
          helpers.render();
        };
      };
    } catch {
      savedCard.querySelector("#saved-reports-list").textContent = "Could not load saved reports.";
    }
  }

  function enhanceChanges(root, api) {
    const header = root.querySelector(".page-header");
    if (!header || document.getElementById("changes-export-csv")) return;
    const btn = document.createElement("button");
    btn.id = "changes-export-csv";
    btn.className = "btn btn-sm";
    btn.textContent = "Export CSV";
    btn.onclick = () => window.open("/api/hrms/exports/changelog?format=csv", "_blank");
    header.appendChild(btn);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return {
    attendanceDayClass,
    attendanceDayTitle,
    attendanceDayHolidayName,
    attendanceHolidaysBannerHtml,
    attendanceBannersHtml,
    initNotificationsBell,
    renderLeavePage,
    renderOrgPage,
    renderEquipmentPage,
    mountEmployeeLifecyclePanel,
    appendEmployeeLifecyclePanel,
    enhanceDashboard,
    enhancePayroll,
    enhanceSettings,
    enhanceReports,
    enhanceChanges,
    escapeHtml,
  };
})();
