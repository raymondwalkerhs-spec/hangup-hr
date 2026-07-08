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

  function navigateFromNotification(n) {
    if (!n) return;
    const entityType = n.entityType || n.type || "";
    const entityId   = n.entityId   || "";
    const navFn = typeof navigate === "function" ? navigate : (page) => {
      location.hash = page;
      if (typeof render === "function") render();
    };
    if (typeof closeModal === "function") closeModal();

    // ── Sales ────────────────────────────────────────────────
    if (entityType === "sale" && entityId) {
      navFn("sales");
      return;
    }

    // ── Leave / Requests ─────────────────────────────────────
    if (
      entityType === "leave" ||
      entityType === "leave_request" ||
      n.type === "leave" ||
      n.actionKey === "leave_submitted"
    ) {
      navFn("requests");
      return;
    }

    // ── Meeting requests ──────────────────────────────────────
    if (
      entityType === "meeting_request" ||
      n.type === "meeting_request_submitted" ||
      n.type === "meeting_request_reviewed" ||
      String(n.actionKey || "").includes("meeting_request")
    ) {
      navFn("meeting-requests");
      return;
    }

    // ── IT requests ───────────────────────────────────────────
    if (
      entityType === "it_request" ||
      String(n.actionKey || "").includes("it_request") ||
      String(n.type || "").includes("it_request")
    ) {
      navFn("it-requests");
      return;
    }

    // ── Quality notes / employee notes ────────────────────────
    if (entityType === "quality_note" || entityType === "employee_note") {
      const empId = String(entityId).split(":")[0] || entityId;
      if (empId && typeof openEmployeeById === "function") {
        navFn("employees");
        setTimeout(() => openEmployeeById(empId, entityType === "quality_note" ? "quality-notes" : "notes"), 150);
      } else {
        navFn("employees");
      }
      return;
    }

    // ── Bonus requests ────────────────────────────────────────
    if (entityType === "bonus_request") {
      navFn("bonuses");
      return;
    }

    // ── Loan requests ─────────────────────────────────────────
    if (entityType === "loan_request") {
      navFn("loan-approvals");
      return;
    }

    // ── Registration ──────────────────────────────────────────
    if (entityType === "registration") {
      navFn("users");
      return;
    }

    // ── Sale assignment (reviewer / verifier assigned) ────────
    if (
      n.type === "sale_reviewer_assigned" ||
      n.type === "sale_verifier_assigned" ||
      n.type === "sale_agent_assigned"
    ) {
      navFn("sales");
      return;
    }

    // ── HR warning ────────────────────────────────────────────
    if (entityType === "hr_warning" || n.type === "hr_warning") {
      navFn("employees");
      return;
    }
  }

  async function openNotificationsModal(api, items, unreadCount) {
    const esc = escapeHtml;
    const list =
      items.length === 0
        ? '<p class="muted">No notifications yet.</p>'
        : `<div class="notif-modal-list">${items
            .map((n) => {
              const unread = n.persisted && !n.readAt;
              const when = n.createdAt ? new Date(n.createdAt).toLocaleString() : "";
              return `<button type="button" class="notif-modal-item${unread ? " unread" : ""}" data-notif-id="${esc(
                n.id || ""
              )}" data-persisted="${n.persisted ? "1" : "0"}" data-entity-type="${esc(n.entityType || "")}" data-entity-id="${esc(
                n.entityId || ""
              )}">
                <strong>${esc(n.title || "Notification")}</strong>
                <p class="muted" style="margin:.35rem 0 0">${esc(n.body || "")}</p>
                <div class="notif-modal-meta muted">${esc(when)}${unread ? " · Unread" : ""}</div>
              </button>`;
            })
            .join("")}</div>`;
    if (typeof openModal !== "function") return;
    openModal(
      `<div class="modal-header flex-between">
        <h2>Notifications</h2>
        <div class="btn-row">
          <button type="button" class="btn btn-sm" id="notif-mark-all">Mark all read</button>
          <button class="btn btn-sm" data-close>✕</button>
        </div>
      </div>
      <div class="modal-body modal-body-scroll">
        <p class="muted">${unreadCount} unread · ${items.length} total</p>
        ${list}
      </div>`,
      true
    );
    document.querySelector("#modal-root .modal")?.classList.add("sale-form-modal");
    document.getElementById("notif-mark-all")?.addEventListener("click", async () => {
      await api("/hrms/notifications/read-all", { method: "POST", body: "{}" });
      if (typeof closeModal === "function") closeModal();
      if (window.__hrRefreshNotifications) window.__hrRefreshNotifications(false);
    });
    document.querySelectorAll(".notif-modal-item").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.notifId;
        const n = items.find((x) => String(x.id) === String(id)) || {
          id,
          entityType: btn.dataset.entityType,
          entityId: btn.dataset.entityId,
          persisted: btn.dataset.persisted === "1",
        };
        if (n.persisted && id && !String(id).startsWith("leave-")) {
          try {
            await api(`/hrms/notifications/${encodeURIComponent(id)}/read`, { method: "POST", body: "{}" });
          } catch {
            /* ignore */
          }
        }
        if (typeof closeModal === "function") closeModal();
        navigateFromNotification(n);
        if (window.__hrRefreshNotifications) window.__hrRefreshNotifications(false);
      });
    });
  }

  async function initNotificationsBell(api, state) {
    const mounts = [
      document.getElementById("sidebar-notif-wrap"),
      document.getElementById("top-notif-wrap"),
    ].filter(Boolean);
    if (!mounts.length || document.getElementById("hr-notif-bell")) return;

    let lastUnread = 0;
    let cachedItems = [];

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

    function attachBell(mount) {
      const btn = document.createElement("button");
      btn.className = "btn btn-sm btn-ghost notif-bell";
      btn.type = "button";
      btn.title = "Notifications";
      btn.setAttribute("aria-label", "Notifications");
      btn.innerHTML = '🔔 <span class="notif-count hidden hr-notif-count">0</span>';
      mount.appendChild(btn);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openNotificationsModal(api, cachedItems, lastUnread);
      });
      return btn;
    }

    const btn = document.createElement("button");
    btn.id = "hr-notif-bell";
    btn.style.display = "none";
    document.body.appendChild(btn);
    mounts.forEach((m) => attachBell(m));

    async function refresh(playSound = false) {
      try {
        const res = await api("/hrms/notifications");
        const items = res.notifications || [];
        const unread = res.unreadCount != null ? res.unreadCount : items.filter((n) => n.persisted && !n.readAt).length;
        cachedItems = items;
        if (playSound && unread > 0 && unread > lastUnread) playNotifSound();
        lastUnread = unread;
        document.querySelectorAll(".hr-notif-count").forEach((countEl) => {
          countEl.textContent = String(unread);
          countEl.classList.toggle("hidden", unread === 0);
        });
        document.querySelectorAll(".notif-bell").forEach((b) => {
          b.classList.toggle("notif-bell-has-items", unread > 0);
        });
      } catch (err) {
        document.querySelectorAll(".hr-notif-count").forEach((countEl) => {
          countEl.textContent = "!";
          countEl.classList.remove("hidden");
          countEl.title = err?.message || "Could not load notifications";
        });
      }
    }

    window.__hrRefreshNotifications = refresh;
    await refresh(false);
    setInterval(() => refresh(true), 30000);
  }

  async function openNotificationRoutingModal(api, helpers) {
    const { escapeHtml: esc, openModal, closeModal } = helpers;
    const data = await api("/hrms/notification-routing");
    const rules = data.rules || [];
    const roleOpts = ["agent", "tl", "op", "quality", "rtm", "hr", "admin", "finance", "ceo"];
    const rows = rules
      .map((r) => {
        const checks = roleOpts
          .map(
            (role) =>
              `<label class="perm-check"><input type="checkbox" data-action="${esc(r.actionKey)}" data-role="${role}" ${
                (r.recipientRoles || []).includes(role) ? "checked" : ""
              } /><span>${role}</span></label>`
          )
          .join("");
        return `<tr><td><strong>${esc(r.label)}</strong><br><span class="muted">${esc(r.actionKey)}</span><br><small class="muted">${esc(
          r.description || ""
        )}</small></td><td class="notif-routing-roles">${checks}</td></tr>`;
      })
      .join("");
    openModal(
      `<div class="modal-header"><h2>Notification routing</h2><button class="btn btn-sm" data-close>✕</button></div>
      <div class="modal-body modal-body-scroll">
        <p class="muted">Choose which roles receive each notification type. Admin and RTM can adjust these defaults.</p>
        <div class="table-wrap"><table><thead><tr><th>Action</th><th>Notify roles</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sm" id="notif-routing-seed">Reset defaults</button>
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="notif-routing-save">Save</button>
      </div>`,
      true
    );
    document.getElementById("notif-routing-seed")?.addEventListener("click", async () => {
      if (!confirm("Reset all notification routing to defaults?")) return;
      await api("/hrms/notification-routing/seed", { method: "POST", body: "{}" });
      closeModal();
      openNotificationRoutingModal(api, helpers);
    });
    document.getElementById("notif-routing-save")?.addEventListener("click", async () => {
      const byAction = {};
      document.querySelectorAll("[data-action][data-role]").forEach((input) => {
        const key = input.dataset.action;
        if (!byAction[key]) byAction[key] = [];
        if (input.checked) byAction[key].push(input.dataset.role);
      });
      for (const [actionKey, recipientRoles] of Object.entries(byAction)) {
        await api(`/hrms/notification-routing/${encodeURIComponent(actionKey)}`, {
          method: "PUT",
          body: JSON.stringify({ recipientRoles, enabled: true }),
        });
      }
      closeModal();
      alert("Notification routing saved.");
    });
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
      canManageOrgStructure,
    } = helpers;
    const canManage =
      (typeof canManageOrgStructure === "function" && canManageOrgStructure()) ||
      (typeof canManagePayrollEvents === "function" && canManagePayrollEvents());
    const viewerRole = String(typeof state !== "undefined" ? state.user?.role : "").toLowerCase();
    const agentPrivacyView =
      !canManage && (viewerRole === "agent" || viewerRole === "office_assistant");
    const eq = typeof employeesQuery === "function" ? employeesQuery() : "";
    const [structure, empData, teamsRes, mgrRes] = await Promise.all([
      api(`/hrms/org-structure${eq}`),
      api(`/employees${eq}`).catch(() => ({ employees: [] })),
      api("/hrms/teams").catch(() => ({ teams: [], orgUnits: ["HS-1", "HS-2", "HS-3", "HS-Back-End", "HS-MGMT"] })),
      api("/org/managers").catch(() => ({ managers: [] })),
    ]);
    const employees = empData.employees || [];
    const orgUnits = teamsRes.orgUnits || structure.orgUnits || ["HS-1", "HS-2", "HS-3", "HS-Back-End", "HS-MGMT"];
    const allTeams = teamsRes.teams || [];
    const mgrByUnit = new Map((mgrRes.managers || []).map((m) => [m.unit, m]));
    const teamTlsByTeam = mgrRes.teamTls || {};
    const unitOpsByUnit = mgrRes.unitOps || {};
    if (typeof state !== "undefined") state.orgTeams = allTeams;

    function empName(id, opts = {}) {
      if (!id) return "—";
      const e = employees.find((x) => x.id === id);
      if (!e) return id;
      if (opts.nameOnly || agentPrivacyView) return e.american_name || e.arabic_name || e.id;
      return `${e.id} — ${e.american_name || e.id}`;
    }

    function opOptions(unit, selected) {
      const normUnit = (u) => String(u || "").replace(/\s+/g, "").toUpperCase();
      const unitMatch = (e) => normUnit(e.unit) === normUnit(unit) || e.unit === unit;
      const ops = employees.filter(
        (e) =>
          unitMatch(e) &&
          (/^OP/i.test(String(e.id || "")) || String(e.role || "").toLowerCase() === "op")
      );
      const tlsOnUnit = employees.filter((e) => unitMatch(e) && isTlEmployee(e));
      const otherTls = employees.filter((e) => isTlEmployee(e) && !unitMatch(e));
      const opt = (e, tag) =>
        `<option value="${esc(e.id)}" ${selected === e.id ? "selected" : ""}>${tag ? tag + " " : ""}${esc(e.id)} — ${esc(e.american_name || e.id)}</option>`;
      return `<optgroup label="OPs in ${esc(unit)}">${ops.map((e) => opt(e)).join("") || '<option disabled>(none)</option>'}</optgroup>
        <optgroup label="TLs in ${esc(unit)}">${tlsOnUnit.map((e) => opt(e, "★")).join("") || '<option disabled>(none)</option>'}</optgroup>
        <optgroup label="Other TLs">${otherTls.map((e) => opt(e, "★")).join("") || '<option disabled>(none)</option>'}</optgroup>`;
    }

    function isTlEmployee(e) {
      const lead = String(e?.lead_role || e?.role || "").toUpperCase();
      const tlOnTeam = allTeams.some((t) => t.tlEmployeeId === e?.id || (t.tlEmployeeIds || []).includes(e?.id));
      return /^TL/i.test(String(e?.id || "")) || lead === "TL" || tlOnTeam;
    }

    function tlOptions(teamName, selected) {
      const normTeam = (t) => String(t || "").replace(/^team\s+/i, "").trim();
      const onTeam = employees.filter((e) => normTeam(e.team) === normTeam(teamName) && isTlEmployee(e));
      const otherTls = employees.filter((e) => isTlEmployee(e) && normTeam(e.team) !== normTeam(teamName));
      const agents = employees.filter(
        (e) => !isTlEmployee(e) && String(e.status || "").toLowerCase() !== "out"
      );
      const opt = (e) =>
        `<option value="${esc(e.id)}" ${selected === e.id ? "selected" : ""}>${esc(e.id)} — ${esc(e.american_name || e.id)}</option>`;
      return `<optgroup label="TLs on ${esc(teamName)}">${onTeam.map(opt).join("") || '<option disabled>(none on team)</option>'}</optgroup>
        <optgroup label="Other TLs">${otherTls.map(opt).join("") || '<option disabled>(none)</option>'}</optgroup>
        <optgroup label="Agents (unusual)">${agents.slice(0, 80).map(opt).join("")}</optgroup>`;
    }

    const teamNames = [...new Set(allTeams.map((t) => t.name).filter(Boolean))].sort();
    const unitSections = (structure.units || [])
      .filter((section) => section.unit !== "HS-2" || (typeof state !== "undefined" && state.user?.canManageHs2Company))
      .map((section) => {
      const teams = section.teams || [];
      const unit = section.unit;
      const isBackend = unit === "HS-Back-End" || unit === "HS-MGMT";
      const mgr = mgrByUnit.get(unit) || {};
      const opIds = [...new Set([
        mgr.opEmployeeId || "",
        ...(unitOpsByUnit[unit] || []),
      ].filter(Boolean))];
      const opChips = opIds.map((id) =>
        `<span class="org-chip" data-unit-op="${esc(unit)}" data-op-id="${esc(id)}">${esc(empName(id, { nameOnly: true }))}${canManage ? `<button class="org-chip-remove" data-remove-op="${esc(unit)}" data-op-id="${esc(id)}" title="Remove OP">×</button>` : ""}</span>`
      ).join(" ");
      const opHeader = isBackend
        ? `<span class="muted">Reports to CEO · HR: ${esc(empName(mgr.hrManagerId || employees.find((e) => /^HR/i.test(e.id) && /phoebe/i.test(e.american_name || ""))?.id))}</span>`
        : `<div class="org-ops">
            <span class="muted">OP${opIds.length !== 1 ? "s" : ""}:</span>
            ${opChips || '<span class="muted">—</span>'}
            ${canManage ? `<select class="org-op-add" data-unit="${esc(unit)}">
              <option value="">+ Add OP</option>
              ${opOptions(unit, "")}
            </select>` : ""}
          </div>`;
      return `<section class="card org-unit-block org-hierarchy-unit" style="margin-bottom:1rem" data-unit="${esc(unit)}">
        <div class="flex-between" style="margin-bottom:.75rem;align-items:flex-start;gap:1rem;flex-wrap:wrap">
          <div><h2 style="margin:0">${esc(unit)}${unit === "HS-2" && (typeof state !== "undefined" && state.user?.canManageHs2Company) ? ' <span class="badge">HS2 Company</span>' : ""}</h2>${opHeader}</div>
          ${canManage ? `<button class="btn btn-sm" data-add-team-unit="${esc(unit)}">+ Add team</button>` : ""}
        </div>
        <div class="stack org-team-stack">${teams.map((t) => {
          const agents = t.agents || [];
          const meta = allTeams.find((x) => x.name === t.name) || {};
          const tlIds = [...new Set([
            meta.tlEmployeeId || "",
            ...(teamTlsByTeam[meta.id] || []),
          ].filter(Boolean))];
          const dialBadge = t.dialsSales === false ? '<span class="badge muted">No dial</span>' : "";
          const tlChips = tlIds.map((id) =>
            `<span class="org-chip" data-team-tl="${esc(meta.id)}" data-tl-id="${esc(id)}">${esc(empName(id, { nameOnly: true }))}${canManage ? `<button class="org-chip-remove" data-remove-tl="${esc(meta.id)}" data-tl-id="${esc(id)}" title="Remove TL">×</button>` : ""}</span>`
          ).join(" ");
          const tlHeader = `<div class="org-tls">
            <span class="muted">TL${tlIds.length !== 1 ? "s" : ""}:</span>
            ${tlChips || '<span class="muted">—</span>'}
            ${canManage && meta.id ? `<select class="org-tl-add" data-team-id="${esc(meta.id)}">
              <option value="">+ Add TL</option>
              ${tlOptions(t.name, "")}
            </select>` : ""}
          </div>`;
          return `<details class="card card-flat org-team-card" open data-team="${esc(t.name)}">
            <summary class="flex-between" style="align-items:center;gap:.5rem;flex-wrap:wrap">
              <span><strong>${esc(t.name)}</strong> ${dialBadge} <span class="muted">(${agents.length} agents)</span></span>
              <span class="org-team-meta">${tlHeader} ${canManage ? `<button type="button" class="btn btn-sm" data-edit-team="${esc(meta.id || "")}" data-team-name="${esc(t.name)}">Edit</button>` : ""}</span>
            </summary>
            <div class="table-wrap" style="margin-top:.5rem"><table>
              <thead><tr>${agentPrivacyView ? "<th>Name</th>" : "<th>ID</th><th>Name</th><th>Position</th>"}${canManage ? "<th>Team</th>" : ""}</tr></thead>
              <tbody>${agents.map((a) => `<tr class="${agentPrivacyView ? "" : "clickable-row"}" ${agentPrivacyView ? "" : `data-agent-id="${esc(a.id)}"`}>
                ${agentPrivacyView ? `<td>${esc(a.name)}</td>` : `<td>${esc(a.id)}</td><td>${esc(a.name)}</td><td>${esc(a.position || "—")}</td>`}
                ${canManage ? `<td><select class="org-team-select" data-emp-id="${esc(a.id)}">
                  <option value="">—</option>
                  ${teamNames.map((tn) => `<option value="${esc(tn)}" ${tn === t.name ? "selected" : ""}>${esc(tn)}</option>`).join("")}
                </select></td>` : ""}
              </tr>`).join("") || `<tr><td colspan="${canManage ? (agentPrivacyView ? 2 : 4) : (agentPrivacyView ? 1 : 3)}" class="muted">No agents</td></tr>`}
              </tbody>
            </table></div>
          </details>`;
        }).join("") || '<p class="muted">No teams in this unit.</p>'}</div>
      </section>`;
    }).join("");

    const unassigned = structure.unassigned || [];
    const role = typeof state !== "undefined" ? state.user?.role : "";
    const canViewPin = ["op", "rtm", "hr", "admin", "ceo", "quality"].includes(role);
    const canApproveReg = ["op", "admin", "hr", "ceo"].includes(role);
    let regPanel = "";
    if (canViewPin || canApproveReg) {
      let pinBlock = "";
      let pendingBlock = "";
      if (canViewPin) {
        try {
          const pinRes = await api("/registration/daily-pin");
          pinBlock = `<div class="card card-flat" style="padding:.75rem 1rem;margin-bottom:.75rem;background:var(--surface-2)">
            <strong>Today's agent registration PIN:</strong>
            <span style="font-size:1.35rem;letter-spacing:.2em;margin-left:.5rem">${esc(pinRes.pin || "—")}</span>
            <span class="muted" style="margin-left:.5rem">(${esc(pinRes.date || "today")}) — share with new agents only</span>
          </div>`;
        } catch (_) {
          pinBlock = `<p class="muted">Registration PIN unavailable (Supabase required).</p>`;
        }
      }
      if (canApproveReg) {
        try {
          const pendRes = await api("/registration/pending");
          const pending = pendRes.pending || [];
          pendingBlock = pending.length
            ? `<section class="card" style="margin-bottom:1rem"><h3>Pending agent registrations (${pending.length})</h3>
              <div class="table-wrap"><table><thead><tr><th>Full name</th><th>American name</th><th>Nationality</th><th>ID / Passport</th><th>Unit</th><th>Phone</th><th>Submitted</th><th></th></tr></thead>
              <tbody>${pending.map((p) => `<tr>
                <td>${esc(p.fullName || p.arabicName || "—")}</td>
                <td>${esc(p.americanName)}</td>
                <td>${esc(p.nationality || "—")}</td>
                <td>${esc(p.nationalId || p.passportNumber || "—")}</td>
                <td>${esc(p.unit || "—")}</td>
                <td>${esc(p.phone || "—")}</td>
                <td class="muted">${p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}</td>
                <td class="btn-row">
                  <button type="button" class="btn btn-sm btn-primary" data-approve-reg="${esc(p.id)}">Approve</button>
                  <button type="button" class="btn btn-sm btn-danger" data-reject-reg="${esc(p.id)}">Reject</button>
                </td></tr>`).join("")}
              </tbody></table></div></section>`
            : "";
        } catch (_) {}
      }
      regPanel = pinBlock + pendingBlock;
    }

    root.innerHTML = `
      <style>
        .org-ops, .org-tls { display: flex; align-items: center; gap: .35rem; flex-wrap: wrap; }
        .org-chip { display: inline-flex; align-items: center; gap: .2rem; background: var(--bg2, #eee); padding: .1rem .4rem; border-radius: 3px; font-size: .8rem; }
        .org-chip-remove { background: none; border: none; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0 .1rem; color: var(--text-muted, #888); }
        .org-chip-remove:hover { color: #c00; }
        .org-op-add, .org-tl-add { font-size: .8rem; max-width: 8rem; }
      </style>
      <div class="page-header flex-between">
        <div><h1>Organization</h1><p class="muted">Unit → Team → Agent · OP manages unit · TL manages team · Back-End reports to CEO</p></div>
      </div>
      ${regPanel}
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

    root.querySelectorAll("[data-approve-reg]").forEach((btn) => {
      btn.onclick = () => {
        const regId = btn.dataset.approveReg;
        const row = btn.closest("tr");
        const unitCell = row?.querySelector("td:nth-child(5)");
        const regUnit = unitCell?.textContent?.trim() || "HS-3";
        const unitTeams = allTeams.filter((t) => t.unit === regUnit);
        const teamOpts = unitTeams.length
          ? unitTeams
              .map(
                (t) =>
                  `<option value="${esc(t.name)}">${esc(t.name)}</option>`
              )
              .join("")
          : "";
        openModal(
          `<div class="modal-header"><h2>Approve registration</h2><button class="btn btn-sm" data-close>✕</button></div>
          <form id="approve-reg-form" class="modal-body field-grid">
            <p class="muted" style="grid-column:1/-1">Creates employee + inactive login. Assign a team from Organization (active teams only).</p>
            <label class="field"><span>Unit</span><input value="${esc(regUnit)}" readonly /></label>
            <label class="field"><span>Team</span>
              <select name="team" id="approve-reg-team">
                <option value="">— Unassigned (assign later) —</option>
                ${teamOpts}
              </select>
            </label>
          </form>
          <div class="modal-footer"><button type="button" class="btn" data-close>Cancel</button><button type="submit" form="approve-reg-form" class="btn btn-primary">Approve</button></div>`,
          true
        );
        document.getElementById("approve-reg-form").onsubmit = async (e) => {
          e.preventDefault();
          const team = document.getElementById("approve-reg-team")?.value || "";
          try {
            const res = await api(`/registration/${regId}/approve`, {
              method: "POST",
              body: JSON.stringify({ unit: regUnit, team }),
            });
            closeModal();
            await renderOrgPage(root, api, helpers);
            if (typeof showRegistrationCredentialsModal === "function") {
              showRegistrationCredentialsModal(
                res,
                team ? `Team set to ${team}.` : "Assign the agent's team on Organization if needed."
              );
            }
          } catch (err) {
            alert(err.message);
          }
        };
      };
    });
    root.querySelectorAll("[data-reject-reg]").forEach((btn) => {
      btn.onclick = () => {
        openConfirmModal({
          title: "Reject registration",
          message: "Reject this registration?",
          confirmLabel: "Reject",
          danger: true,
          onConfirm: async () => {
            await api(`/registration/${btn.dataset.rejectReg}/reject`, { method: "POST", body: "{}" });
            await renderOrgPage(root, api, helpers);
          },
        });
      };
    });

    root.querySelectorAll("[data-agent-id]").forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest(".org-team-select, .org-tl-select, .org-op-select, .org-tl-add, .org-op-add, .org-chip-remove, .org-chip")) return;
        const emp = employees.find((x) => String(x.id) === String(row.dataset.agentId));
        if (emp && typeof openEmployeeModal === "function") openEmployeeModal(emp);
      };
    });

    root.querySelectorAll(".org-op-add").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const employeeId = sel.value;
        if (!employeeId) return;
        const unit = sel.dataset.unit;
        const emp = employees.find((x) => String(x.id) === employeeId);
        const isOp =
          /^OP/i.test(String(emp?.id || "")) || String(emp?.role || "").toLowerCase() === "op";
        if (!isOp) {
          if (!confirm(`Assign ${emp?.id || employeeId} as OP for ${unit}? This is unusual.`) ||
              !confirm("Please confirm again — OP manager assignment.")) {
            sel.value = "";
            return;
          }
        }
        try {
          await api(`/org/unit-ops/${encodeURIComponent(unit)}`, {
            method: "POST",
            body: JSON.stringify({ employeeId }),
          });
          await renderOrgPage(root, api, helpers);
        } catch (e) {
          alert(e.message);
        }
        sel.value = "";
      });
    });

    root.querySelectorAll(".org-tl-add").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const employeeId = sel.value;
        if (!employeeId) return;
        const teamId = sel.dataset.teamId;
        const teamCard = sel.closest(".org-team-card");
        const teamName = teamCard?.dataset?.team || "";
        const emp = employees.find((x) => String(x.id) === employeeId);
        const isAgentPick = !isTlEmployee(emp);
        const normTeam = (t) => String(t || "").replace(/^team\s+/i, "").trim();
        const crossTeam = isTlEmployee(emp) && normTeam(emp?.team) !== normTeam(teamName);
        if (!emp || isAgentPick || crossTeam) {
          const msg = !emp
            ? `Assign ${employeeId} as TL for "${teamName}"?`
            : isAgentPick
              ? `Assign agent ${employeeId} as TL for team "${teamName}"? This is unusual.`
              : `Assign TL ${employeeId} from team "${emp?.team || "?"}" to lead "${teamName}"?`;
          if (!confirm(msg) || !confirm("Please confirm again — this changes team leadership.")) {
            sel.value = "";
            return;
          }
        }
        try {
          await api(`/org/team-tls/${teamId}`, {
            method: "POST",
            body: JSON.stringify({ employeeId }),
          });
          await renderOrgPage(root, api, helpers);
        } catch (e) {
          alert(e.message);
        }
        sel.value = "";
      });
    });

    root.querySelectorAll("[data-remove-op]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const unit = btn.dataset.removeOp;
        const employeeId = btn.dataset.opId;
        if (!confirm(`Remove ${empName(employeeId, { nameOnly: true })} as OP for ${unit}?`)) return;
        try {
          await api(`/org/unit-ops/${encodeURIComponent(unit)}/${encodeURIComponent(employeeId)}`, { method: "DELETE" });
          await renderOrgPage(root, api, helpers);
        } catch (e) {
          alert(e.message);
        }
      });
    });

    root.querySelectorAll("[data-remove-tl]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const teamId = btn.dataset.removeTl;
        const employeeId = btn.dataset.tlId;
        if (!confirm(`Remove ${empName(employeeId, { nameOnly: true })} as TL from this team?`)) return;
        try {
          await api(`/org/team-tls/${teamId}/${encodeURIComponent(employeeId)}`, { method: "DELETE" });
          await renderOrgPage(root, api, helpers);
        } catch (e) {
          alert(e.message);
        }
      });
    });

    root.querySelectorAll(".org-team-select").forEach((sel) => {
      sel.addEventListener("click", (e) => e.stopPropagation());
      sel.addEventListener("change", async () => {
        const teamName = sel.value;
        const teamMeta = allTeams.find((t) => t.name === teamName);
        const emp = employees.find((e) => e.id === sel.dataset.empId);
        const patch = { team: teamName };
        if (teamMeta?.unit && emp && teamMeta.unit !== emp.unit) {
          if (
            !confirm(
              `Team "${teamName}" belongs to ${teamMeta.unit}, but employee is on ${emp.unit || "?"}. Update employee unit to ${teamMeta.unit}?`
            )
          ) {
            sel.value = emp?.team || "";
            return;
          }
          patch.unit = teamMeta.unit;
        }
        try {
          const res = await api(`/employees/${sel.dataset.empId}`, {
            method: "PUT",
            body: JSON.stringify(patch),
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
          <div class="modal-body">
            <div class="field-grid">
              <label class="field"><span>Assign existing team</span>
                <select id="assign-existing-team"><option value="">— Create new below —</option>${teamPickOpts}</select>
              </label>
              <div class="field" style="display:flex;align-items:flex-end">
                <button type="button" class="btn btn-sm btn-primary" id="assign-team-btn">Assign selected team to ${esc(unit)}</button>
              </div>
            </div>
            <hr />
            <p class="muted">Or create a new team:</p>
            <form id="new-team-form" class="field-grid">
              <label class="field"><span>Team name</span><input id="new-team-name" name="name" type="text" autocomplete="off" spellcheck="false" data-autofocus placeholder="e.g. Kate" /></label>
              <label class="field"><span>Unit</span>
                <select name="unit">${orgUnits.map((u) => `<option value="${esc(u)}" ${u === unit ? "selected" : ""}>${esc(u)}</option>`).join("")}</select>
              </label>
              <label class="field"><span>Dials sales</span>
                <select name="dialsSales"><option value="true">Yes — dialing team</option><option value="false">No — support / mgmt</option></select>
              </label>
              <label class="field"><span>Display order</span><input name="displayOrder" type="number" value="0" /></label>
            </form>
          </div>
          <div class="modal-footer"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn btn-primary" id="save-new-team">Create new team</button></div>`);
        document.getElementById("assign-team-btn").onclick = async () => {
          const teamId = document.getElementById("assign-existing-team")?.value;
          if (!teamId) return alert("Select a team to assign, or create a new one below.");
          const team = allTeams.find((t) => t.id === teamId);
          if (!team) return;
          if (team.unit && team.unit !== unit) {
            if (!confirm(`Move "${team.name}" from ${team.unit} to ${unit}? All agents on this team will be updated.`)) return;
            const reassignIds = confirm("Reassign dialing agent IDs for the new unit prefix?");
            await api(`/hrms/teams/${team.id}/relocate`, {
              method: "POST",
              body: JSON.stringify({ unit, reassignIds }),
            });
          } else {
            await api(`/hrms/teams/${team.id}`, {
              method: "PATCH",
              body: JSON.stringify({ name: team.name, unit, dialsSales: team.dialsSales !== false, displayOrder: team.displayOrder || 0 }),
            });
          }
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
            <label class="field"><span>Team name</span><input name="name" type="text" autocomplete="off" data-autofocus value="${esc(team.name)}" required /></label>
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
            <div class="card card-flat" style="grid-column:1/-1">
              <h4>Move whole team to another unit</h4>
              <p class="muted">Updates every agent on this team to the new unit. Dialing agents get new IDs (e.g. HS3-01) — old IDs stay reserved forever.</p>
              <label class="field"><span>New unit</span>
                <select id="relocate-unit">${orgUnits.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join("")}</select>
              </label>
              <label class="field"><input type="checkbox" id="relocate-reassign" checked /> Reassign agent IDs for new unit prefix</label>
              <button type="button" class="btn btn-warn" id="relocate-team-btn">Move team &amp; reassign IDs</button>
            </div>
            <div class="card card-flat" style="grid-column:1/-1;border-color:var(--danger,#c44)">
              <h4>Delete team</h4>
              <p class="muted">Removes this team from Organization. Agents on it become <strong>unassigned</strong> until you assign a new team manually.</p>
              <button type="button" class="btn btn-danger btn-sm" id="delete-team-btn">Delete team</button>
            </div>
          </form>
          <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save-edit-team">Save</button></div>`);
        document.getElementById("delete-team-btn").onclick = async () => {
          const n = employees.filter((e) => String(e.team || "").toLowerCase() === String(team.name).toLowerCase() || String(e.team || "").replace(/^team\s+/i, "").toLowerCase() === String(team.name).toLowerCase()).length;
          if (
            !confirm(
              `Delete team "${team.name}"? ${n} agent(s) will have no team until reassigned.`
            )
          ) {
            return;
          }
          if (!confirm(`Permanently remove "${team.name}" from Organization?`)) return;
          try {
            const res = await api(`/hrms/teams/${team.id}`, { method: "DELETE" });
            alert(`Team deleted. ${(res.clearedEmployeeIds || []).length} employee(s) unassigned.`);
            closeModal();
            await renderOrgPage(root, api, helpers);
          } catch (err) {
            alert(err.message || "Delete failed");
          }
        };
        document.getElementById("relocate-team-btn").onclick = async () => {
          const newUnit = document.getElementById("relocate-unit")?.value;
          const reassignIds = document.getElementById("relocate-reassign")?.checked !== false;
          if (!newUnit) return alert("Select a unit");
          if (newUnit === team.unit && !reassignIds) return alert("Team is already on this unit");
          if (
            !confirm(
              `Move "${team.name}" to ${newUnit}${reassignIds ? " and assign new agent IDs" : ""} for all agents on this team?`
            )
          ) {
            return;
          }
          try {
            const res = await api(`/hrms/teams/${team.id}/relocate`, {
              method: "POST",
              body: JSON.stringify({ unit: newUnit, reassignIds }),
            });
            const n = (res.changes || []).length;
            const skipped = (res.skipped || []).length;
            alert(
              `Team moved. ${n} agent${n === 1 ? "" : "s"} updated.${skipped ? ` ${skipped} skipped (not dialing agents or no ID rule).` : ""}`
            );
            closeModal();
            await renderOrgPage(root, api, helpers);
          } catch (err) {
            alert(err.message || "Relocate failed");
          }
        };
        document.getElementById("save-edit-team").onclick = async () => {
          const fd = new FormData(document.getElementById("edit-team-form"));
          const newUnit = String(fd.get("unit") || "").trim();
          const payload = {
            name: fd.get("name"),
            unit: newUnit,
            dialsSales: fd.get("dialsSales") === "true",
            displayOrder: Number(fd.get("displayOrder")) || 0,
          };
          try {
            if (newUnit && newUnit !== team.unit) {
              if (
                !confirm(
                  `Move "${team.name}" from ${team.unit} to ${newUnit}? All agents on this team will be updated.`
                )
              ) {
                return;
              }
              const reassignIds = confirm("Reassign dialing agent IDs for the new unit prefix?");
              await api(`/hrms/teams/${team.id}/relocate`, {
                method: "POST",
                body: JSON.stringify({ unit: newUnit, reassignIds }),
              });
              if (
                payload.name !== team.name ||
                payload.dialsSales !== (team.dialsSales !== false) ||
                payload.displayOrder !== (team.displayOrder ?? 0)
              ) {
                await api(`/hrms/teams/${team.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    name: payload.name,
                    dialsSales: payload.dialsSales,
                    displayOrder: payload.displayOrder,
                  }),
                });
              }
            } else {
              await api(`/hrms/teams/${team.id}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
              });
            }
            closeModal();
            await renderOrgPage(root, api, helpers);
          } catch (err) {
            alert(err.message || "Save failed");
          }
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
    const inventory = state.user?.canViewEquipmentInventory === true;
    const selfId = state.user?.employeeId || "";
    if (!inventory) {
      if (!selfId) {
        root.innerHTML = '<p class="muted">Equipment is only visible for your own assigned devices.</p>';
        return;
      }
      const viewId = state.hrmsEmployeeFilter || selfId;
      if (viewId !== selfId) {
        root.innerHTML = '<p class="muted">You can only view your own equipment.</p>';
        return;
      }
      const data = await api(`/hrms/equipment/${encodeURIComponent(selfId)}`);
      const assignments = (data.assignments || []).filter((a) => !a.returnedAt);
      root.innerHTML = `
        <div class="page-header"><div><h1>My equipment</h1><p class="muted">${assignments.length} active device(s)</p></div></div>
        <div class="table-wrap table-zebra"><table>
          <thead><tr><th>Device</th><th>Issued</th><th>Notes</th></tr></thead>
          <tbody>${assignments.length ? assignments.map((a) => `<tr>
            <td>${escapeHtml(a.itemType || a.equipmentType || "—")}</td>
            <td>${escapeHtml(String(a.assignedAt || a.issuedAt || "").slice(0, 10) || "—")}</td>
            <td class="muted">${escapeHtml(a.notes || "")}</td>
          </tr>`).join("") : '<tr><td colspan="3" class="muted">No equipment assigned</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    const [data, empData] = await Promise.all([
      api("/hrms/equipment"),
      api(`/employees${typeof employeesQuery === "function" ? employeesQuery() : ""}`).catch(() => ({ employees: [] })),
    ]);
    const equipment = data.equipment || [];
    const assignments = data.assignments || [];
    const employees = empData.employees || [];
    const pickerEmployees = employees.filter(
      (e) => String(e.status || "").toLowerCase() !== "out"
    );
    const canIssue =
      typeof state !== "undefined" && state.user?.canIssueEquipment === true;
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
        <div><h1>Equipment</h1><p class="muted">Devices issued to employees — unit comes from the employee record${filterEmp ? ` · filtered: <strong>${escapeHtml(filterEmp)}</strong> <button class="btn btn-sm" id="clear-equip-filter">Show all</button>` : ""}</p></div>
        ${canIssue ? `<button class="btn btn-primary btn-sm" id="add-equipment-btn">+ Issue device</button>` : ""}
      </div>
      <div class="toolbar equip-toolbar">
        <label class="field field-inline field-search"><span>View agent equipment</span>
          <input type="search" id="equip-agent-search" class="search-input" list="equip-agent-list" placeholder="Type name or ID…" value="${filterEmp ? escapeHtml(empById(filterEmp)?.american_name ? `${empById(filterEmp).american_name} (${filterEmp})` : filterEmp) : ""}" />
          <datalist id="equip-agent-list">${pickerEmployees.map((e) => `<option value="${escapeHtml(e.american_name || e.arabic_name || e.id)} (${escapeHtml(e.id)})" data-id="${escapeHtml(e.id)}"></option>`).join("")}</datalist>
        </label>
        <button type="button" class="btn btn-sm" id="equip-view-agent-btn">View equipment</button>
        ${filterEmp ? '<button type="button" class="btn btn-sm" id="clear-equip-filter-top">Show all</button>' : ""}
      </div>
      <div class="table-wrap table-zebra"><table>
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
      window.location.hash = "equipment";
      renderEquipmentPage(root, api, helpers);
    });
    root.querySelector("#clear-equip-filter-top")?.addEventListener("click", () => {
      state.hrmsEmployeeFilter = "";
      window.location.hash = "equipment";
      renderEquipmentPage(root, api, helpers);
    });

    function resolveEquipAgentId() {
      const raw = root.querySelector("#equip-agent-search")?.value?.trim() || "";
      if (!raw) return "";
      const paren = raw.match(/\(([^)]+)\)\s*$/);
      if (paren) return paren[1].trim();
      const byId = pickerEmployees.find((e) => e.id.toLowerCase() === raw.toLowerCase());
      if (byId) return byId.id;
      const byName = pickerEmployees.find((e) =>
        String(e.american_name || e.arabic_name || "").toLowerCase().includes(raw.toLowerCase())
      );
      return byName?.id || "";
    }

    root.querySelector("#equip-view-agent-btn")?.addEventListener("click", () => {
      const id = resolveEquipAgentId();
      if (!id) return alert("Choose an agent from the list");
      state.hrmsEmployeeFilter = id;
      window.location.hash = `equipment?employee=${encodeURIComponent(id)}`;
      renderEquipmentPage(root, api, helpers);
    });
    root.querySelector("#equip-agent-search")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        root.querySelector("#equip-view-agent-btn")?.click();
      }
    });

    root.querySelector("#add-equipment-btn").onclick = () => {
      openModal(`
        <div class="modal-header"><h2>Issue device</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="equip-form" class="modal-body field-grid modal-body-scroll">
          <label class="field"><span>Agent</span><select name="employeeId" required>
            <option value="">— Select agent —</option>
            ${employeeOptionsHtml(pickerEmployees, filterEmp || "")}
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

  function trainingStatusOptions(selected) {
    const opts = [
      ["pending", "Pending"],
      ["passed", "Passed"],
      ["rejected", "Rejected"],
      ["passed_exception", "Passed (Exception)"],
    ];
    return opts
      .map(([v, label]) => `<option value="${v}" ${selected === v ? "selected" : ""}>${label}</option>`)
      .join("");
  }

  function trainingOutcomeOptions(selected) {
    const opts = [
      ["active", "Active"],
      ["passed", "Passed"],
      ["failed", "Failed"],
      ["voluntary_leave", "Agent left"],
      ["company_terminated", "Company terminated"],
    ];
    return opts
      .map(([v, label]) => `<option value="${v}" ${selected === v ? "selected" : ""}>${label}</option>`)
      .join("");
  }

  function buildTrainingSectionHtml(program, escapeHtml, trainingPassed = false) {
    if (!program) {
      const passedNote = trainingPassed
        ? `<p class="badge badge-ok" style="display:inline-block;margin:.5rem 0">Baseline training passed</p>`
        : "";
      return `<details open style="margin-top:1rem" id="hrms-training-section">
        <summary><strong>Training program (4 weeks)</strong></summary>
        ${passedNote}
        <p class="muted" style="margin:.5rem 0">No active training program. HR/Admin can start a new program anytime.</p>
        <div class="field-grid" style="max-width:24rem">
          <label class="field"><span>Phase 1 week starts (Monday)</span><input type="date" id="train-phase1-start" /></label>
          <button type="button" class="btn btn-sm btn-primary" id="train-start-btn">Start training program</button>
        </div>
      </details>`;
    }
    const rejectedNote = program.rejectedAtPhase
      ? `<p class="muted">Rejected at phase ${program.rejectedAtPhase} — later phases hidden.</p>`
      : "";
    const rows = (program.phases || [])
      .map(
        (p) => `<tr data-phase-id="${escapeHtml(p.id)}">
          <td><strong>Phase ${p.phaseNumber}</strong></td>
          <td><input type="date" class="train-week-start" value="${escapeHtml(p.weekStart)}" style="max-width:9rem" />
            <span class="muted"> – </span>
            <input type="date" class="train-week-end" value="${escapeHtml(p.weekEnd)}" style="max-width:9rem" /></td>
          <td><select class="train-status">${trainingStatusOptions(p.status)}</select></td>
          <td><strong>${p.salesPassed}</strong> passed <span class="muted">/ ${p.salesTotal} total</span></td>
          <td><button type="button" class="btn btn-sm train-save-phase">Save</button></td>
        </tr>`
      )
      .join("");
    const salesEval = program.salesEvaluation || {};
    const salesWarn =
      salesEval.totalPassed != null && salesEval.totalPassed < 12
        ? `<p class="badge badge-warn" style="display:inline-block;margin:.35rem 0">Program total: ${salesEval.totalPassed}/12 passed sales</p>`
        : salesEval.meetsMinimum12
          ? `<p class="badge badge-ok" style="display:inline-block;margin:.35rem 0">12+ passed sales — ready to promote</p>`
          : "";
    const outcomeBlock = `<div class="field-grid" style="max-width:36rem;margin:.75rem 0">
      <label class="field"><span>Program outcome</span>
        <select id="train-outcome">${trainingOutcomeOptions(program.outcome || "active")}</select></label>
      <label class="field"><span>Promotion effective date</span>
        <input type="date" id="train-promo-date" value="${escapeHtml(program.promotionEffectiveDate || program.passedOnDate || "")}" /></label>
      <label class="field"><span>Passed on date</span>
        <input type="date" id="train-passed-date" value="${escapeHtml(program.passedOnDate || "")}" /></label>
      <label class="field" style="grid-column:1/-1"><span>Exit notes</span>
        <input type="text" id="train-exit-notes" value="${escapeHtml(program.exitNotes || "")}" /></label>
      <label class="field" style="grid-column:1/-1;display:flex;align-items:center;gap:.5rem">
        <input type="checkbox" id="train-exception-flag" style="width:16px;height:16px;accent-color:var(--primary,#2563eb)" />
        <span>Exception <span class="muted">(promote without 12-sales requirement — HR/Admin override)</span></span>
      </label>
    </div>
    <div class="btn-row" style="margin-bottom:.5rem">
      <button type="button" class="btn btn-sm" id="train-save-outcome">Save outcome</button>
      <button type="button" class="btn btn-sm btn-primary" id="train-promote-btn">Promote to Agent</button>
      <button type="button" class="btn btn-sm btn-danger" id="train-cancel-btn">Cancel / End training</button>
      <button type="button" class="btn btn-sm" id="train-pay-preview-btn">Refresh pay preview</button>
    </div>
    <div id="train-pay-preview" class="muted" style="font-size:.85rem;margin-bottom:.5rem"></div>
    ${salesWarn}`;
    return `<details open style="margin-top:1rem" id="hrms-training-section">
      <summary><strong>Training program (4 weeks)</strong> ${program.active ? '<span class="badge badge-ok">Active</span>' : '<span class="badge">Paused</span>'}${program.outcome && program.outcome !== "active" ? ` <span class="badge">${escapeHtml(program.outcomeLabel || program.outcome)}</span>` : ""}</summary>
      ${rejectedNote}
      ${outcomeBlock}
      <div class="table-wrap" style="margin-top:.5rem"><table>
        <thead><tr><th>Phase</th><th>Week (Mon–Fri)</th><th>Status</th><th>Sales</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="btn-row" style="margin-top:.5rem">
        <button type="button" class="btn btn-sm" id="train-recalc-btn">Recalculate phases 2–4 from phase 1</button>
        <button type="button" class="btn btn-sm" id="train-toggle-active">${program.active ? "Pause program" : "Resume program"}</button>
      </div>
    </details>`;
  }

  async function buildLifecyclePanelHtml(emp, api, helpers) {
    const { escapeHtml, openModal, closeModal, canManagePayrollEvents } = helpers;
    if (!canManagePayrollEvents()) return "";
    let html = "";
    try {
      const [periods, plans, onboard, offboard, trainingRes] = await Promise.all([
        api(`/hrms/employment-periods/${emp.id}`).catch(() => ({ periods: [] })),
        api(`/hrms/action-plans/${emp.id}`).catch(() => ({ plans: [] })),
        api(`/hrms/onboarding/${emp.id}`).catch(() => ({ checklist: null })),
        api(`/hrms/offboarding/${emp.id}`).catch(() => ({ offboarding: {}, clearance: [] })),
        api(`/hrms/training/${emp.id}`).catch(() => ({ program: null })),
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
              ${["adUser", "idScanned", "contract"]
                .map(
                  (k) =>
                    `<label class="toggle-label"><input type="checkbox" data-onboard="${k}" ${ob[k] ? "checked" : ""} /> ${k.replace(/([A-Z])/g, " $1")}</label>`
                )
                .join("")}
            </div>
          </details>
          ${buildTrainingSectionHtml(trainingRes.program, escapeHtml, emp.training_passed)}
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
    const { openModal, closeModal, escapeHtml: esc = window.escapeHtml } = helpers;
    const panel = document.getElementById("hrms-lifecycle-panel");
    if (!panel) return;

    const toast = (msg) => {
      if (typeof showSaveIndicator === "function") showSaveIndicator(msg, "saved");
      else alert(msg);
    };

    panel.querySelector("#hrms-rehire-btn")?.addEventListener("click", () => {
      openModal(`
        <div class="modal-header"><h2>Re-hire ${esc(emp.american_name || emp.id)}</h2><button class="btn btn-sm" data-close>✕</button></div>
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
        try {
          await api(`/hrms/onboarding/${emp.id}`, { method: "PUT", body: JSON.stringify(body) });
          toast("Onboarding updated.");
        } catch (e) {
          alert(e.message);
        }
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

    bindTrainingPanel(emp, api, helpers, panel);
  }

  function bindTrainingPanel(emp, api, helpers, panel) {
    const toast = (msg) => {
      if (typeof showSaveIndicator === "function") showSaveIndicator(msg, "saved");
      else alert(msg);
    };
    const section = panel?.querySelector("#hrms-training-section") || document.getElementById("hrms-training-section");
    if (!section) return;

    section.querySelector("#train-start-btn")?.addEventListener("click", async () => {
      const phase1Start = section.querySelector("#train-phase1-start")?.value;
      if (!phase1Start) return alert("Pick phase 1 start date");
      try {
        await api(`/hrms/training/${emp.id}`, { method: "POST", body: JSON.stringify({ phase1Start }) });
        toast("Training program started.");
        await refreshLifecyclePanel(emp, api, helpers);
      } catch (e) {
        alert(e.message);
      }
    });

    section.querySelectorAll(".train-save-phase").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("tr");
        const phaseId = row?.dataset.phaseId;
        if (!phaseId) return;
        try {
          await api(`/hrms/training/phases/${phaseId}`, {
            method: "PATCH",
            body: JSON.stringify({
              weekStart: row.querySelector(".train-week-start")?.value,
              weekEnd: row.querySelector(".train-week-end")?.value,
              status: row.querySelector(".train-status")?.value,
              recalculateFollowing: false,
            }),
          });
          toast("Phase saved.");
          await refreshLifecyclePanel(emp, api, helpers);
        } catch (e) {
          alert(e.message);
        }
      });
    });

    section.querySelector("#train-recalc-btn")?.addEventListener("click", async () => {
      try {
        await api(`/hrms/training/${emp.id}/recalculate`, {
          method: "POST",
          body: JSON.stringify({ fromPhase: 1 }),
        });
        toast("Phases 2–4 recalculated from phase 1.");
        await refreshLifecyclePanel(emp, api, helpers);
      } catch (e) {
        alert(e.message);
      }
    });

    section.querySelector("#train-toggle-active")?.addEventListener("click", async () => {
      const isPause = section.querySelector("#train-toggle-active")?.textContent?.includes("Pause");
      try {
        await api(`/hrms/training/${emp.id}/active`, {
          method: "PUT",
          body: JSON.stringify({ active: !isPause }),
        });
        toast(isPause ? "Training paused." : "Training resumed.");
        await refreshLifecyclePanel(emp, api, helpers);
      } catch (e) {
        alert(e.message);
      }
    });

    section.querySelector("#train-save-outcome")?.addEventListener("click", async () => {
      try {
        await api(`/hrms/training/${emp.id}/outcome`, {
          method: "PATCH",
          body: JSON.stringify({
            outcome: section.querySelector("#train-outcome")?.value,
            promotionEffectiveDate: section.querySelector("#train-promo-date")?.value || null,
            passedOnDate: section.querySelector("#train-passed-date")?.value || null,
            exitNotes: section.querySelector("#train-exit-notes")?.value || "",
          }),
        });
        toast("Training outcome saved.");
        await refreshLifecyclePanel(emp, api, helpers);
      } catch (e) {
        alert(e.message);
      }
    });

    section.querySelector("#train-promote-btn")?.addEventListener("click", async () => {
      const isException = section.querySelector("#train-exception-flag")?.checked === true;
      const salesEval = program.salesEvaluation || {};
      const needsConfirm = isException
        ? `Promote to Agent as EXCEPTION (${salesEval.totalPassed ?? "?"}/12 sales)? This bypasses the sales requirement.`
        : "Promote to Agent and close training program?";
      if (!confirm(needsConfirm)) return;
      try {
        await api(`/hrms/training/${emp.id}/promote`, {
          method: "POST",
          body: JSON.stringify({
            promotionEffectiveDate: section.querySelector("#train-promo-date")?.value,
            passedOnDate: section.querySelector("#train-passed-date")?.value,
            exception: isException,
          }),
        });
        toast(isException ? "Promoted to Agent (exception)." : "Promoted to Agent.");
        await refreshLifecyclePanel(emp, api, helpers);
      } catch (e) {
        alert(e.message);
      }
    });

    section.querySelector("#train-cancel-btn")?.addEventListener("click", async () => {
      if (!confirm("Cancel / end training program for this employee? This marks the program as inactive and sets outcome.")) return;
      try {
        // Set outcome to voluntary_leave or company_terminated based on exit-notes or just mark inactive
        const outcome = section.querySelector("#train-outcome")?.value || "voluntary_leave";
        const exitNotes = section.querySelector("#train-exit-notes")?.value || "Training cancelled by HR";
        await api(`/hrms/training/${emp.id}/outcome`, {
          method: "PATCH",
          body: JSON.stringify({ outcome: ["active", "passed"].includes(outcome) ? "voluntary_leave" : outcome, exitNotes }),
        });
        await api(`/hrms/training/${emp.id}/active`, {
          method: "PUT",
          body: JSON.stringify({ active: false }),
        });
        toast("Training cancelled.");
        await refreshLifecyclePanel(emp, api, helpers);
      } catch (e) {
        alert(e.message);
      }
    });

    async function loadPayPreview() {
      const el = section.querySelector("#train-pay-preview");
      if (!el) return;
      try {
        const month = typeof state !== "undefined" && state.month ? state.month : new Date().toISOString().slice(0, 7);
        const res = await api(`/hrms/training/${emp.id}/pay-preview?month=${month}`);
        const p = res.preview;
        if (!p) {
          el.textContent = "No pay preview.";
          return;
        }
        el.innerHTML = `Pay preview (${res.month}): <strong>${p.trainingDayCount}</strong> training days, <strong>${p.agentDayCount}</strong> agent days · est. training basic <strong>${p.estimatedTrainingBasic}</strong> EGP${p.dualPayroll ? " · <span class=\"badge badge-ok\">Dual payslip</span>" : ""}`;
      } catch (e) {
        el.textContent = e.message || "Preview unavailable";
      }
    }

    section.querySelector("#train-pay-preview-btn")?.addEventListener("click", loadPayPreview);
    loadPayPreview();
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
    const canHolidays = status.user?.canViewSettingsHolidays === true;
    const canManagePayroll =
      status.user?.canManageEmployees === true || ["admin", "ceo", "hr"].includes(String(status.user?.role || ""));

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
      ${
        canManagePayroll
          ? `<div class="card" id="settings-tax-card">
        <h3>Tax rules (finance)</h3>
        <p class="muted">Rates default to 0% until configured.</p>
        <label class="field"><span>Income tax %</span><input id="tax-income" type="number" min="0" max="100" step="0.01" value="${taxRules.incomeTaxRate || 0}" /></label>
        <label class="field"><span>Social insurance %</span><input id="tax-social" type="number" min="0" max="100" step="0.01" value="${taxRules.socialInsuranceRate || 0}" /></label>
        <button class="btn btn-sm" id="tax-save">Save tax rules</button>
      </div>`
          : ""
      }
      ${
        canHolidays
          ? `<div class="card" id="settings-holidays-card">
        <h3>Federal holidays (USA)</h3>
        <p class="muted">Disabled holidays are excluded from attendance prefill. Manual grid edits always win.</p>
        <div class="btn-row" style="margin-bottom:.5rem">
          <button class="btn btn-sm" id="import-holidays-btn">Import federal holidays (2024–2028)</button>
          <button class="btn btn-sm" id="add-holiday-btn">+ Add holiday</button>
        </div>
        <div id="holidays-list-usa" class="muted">Loading…</div>
      </div>`
          : ""
      }`
    );

    const role = String(status.user?.role || "").toLowerCase();
    const canNotifRouting = ["admin", "ceo", "rtm"].includes(role);
    if (canNotifRouting) {
      grid.insertAdjacentHTML(
        "beforeend",
        `<div class="card" id="settings-notif-routing-card">
          <h3>Notification routing</h3>
          <p class="muted">Configure which roles receive each system notification (leave, sales, bonuses, notes).</p>
          <button type="button" class="btn btn-sm btn-primary" id="open-notif-routing-btn">Manage notification routing</button>
        </div>`
      );
      root.querySelector("#open-notif-routing-btn")?.addEventListener("click", () =>
        openNotificationRoutingModal(api, helpers)
      );
    }

    const isHolidayAdmin = ["admin", "ceo"].includes(role) && canHolidays;
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

    root.querySelector("#tax-save")?.addEventListener("click", async () => {
      await api("/settings/tax-rules", {
        method: "PUT",
        body: JSON.stringify({
          incomeTaxRate: root.querySelector("#tax-income").value,
          socialInsuranceRate: root.querySelector("#tax-social").value,
        }),
      });
      alert("Tax rules saved.");
    });

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
            return `<details class="holiday-year-block">
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
    if (canHolidays) {
      loadHolidays();
      root.querySelector("#import-holidays-btn")?.addEventListener("click", async () => {
        try {
          const res = await api("/hrms/holidays/import-federal", { method: "POST" });
          alert(`Imported ${res.count || 0} federal holidays.`);
          loadHolidays();
        } catch (e) {
          alert(e.message);
        }
      });
      root.querySelector("#import-holidays-egy-btn")?.addEventListener("click", async () => {
        try {
          const res = await api("/hrms/holidays/import-egyptian", { method: "POST" });
          alert(`Imported ${res.count || 0} Egyptian holidays (inactive until you enable them).`);
          loadHolidays();
        } catch (e) {
          alert(e.message);
        }
      });
      root.querySelector("#add-holiday-btn")?.addEventListener("click", () => {
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
      });
    }

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

    // ── Companies management (Admin/CEO only) ─────────────────────────────
    const canManageCompanies = ["admin", "ceo"].includes(role);
    if (canManageCompanies) {
      grid.insertAdjacentHTML(
        "beforeend",
        `<div class="card" id="settings-companies-card">
          <h3>Companies</h3>
          <p class="muted">
            Add separate companies and edit their names. Each company gets its own access control, roles,
            finance (loans, bonuses, deductions), and org structure.
            <br><strong>Hang-Up</strong> = HS-1 + HS-3 (merged). <strong>HS-2 Company</strong> = separate.
          </p>
          <div id="companies-list" class="muted">Loading…</div>
          <button class="btn btn-sm btn-primary" id="add-company-btn" style="margin-top:.75rem">+ Add company</button>
        </div>`
      );

      async function loadCompaniesList() {
        const el = root.querySelector("#companies-list");
        if (!el) return;
        try {
          const { companies } = await api("/companies");
          if (!companies || !companies.length) {
            el.textContent = "No companies found.";
            return;
          }
          el.innerHTML = `
            <style>
              .co-row{display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border,#eee);flex-wrap:wrap}
              .co-row:last-child{border-bottom:none}
              .co-name-input{flex:1;min-width:8rem;font-size:.9rem;padding:.25rem .4rem;border:1px solid var(--border,#ddd);border-radius:4px}
              .co-short-input{width:6rem;font-size:.85rem;padding:.25rem .4rem;border:1px solid var(--border,#ddd);border-radius:4px}
              .co-badge{font-size:.75rem;padding:.1rem .4rem;border-radius:10px;background:var(--surface2,#f0f0f0)}
            </style>
            ${companies.map((c) => `
              <div class="co-row" data-co-slug="${escapeHtml(c.slug)}">
                <span class="co-badge">${escapeHtml(c.slug)}</span>
                <input class="co-name-input" placeholder="Display name" value="${escapeHtml(c.name)}" data-co-name />
                <input class="co-short-input" placeholder="Short name" value="${escapeHtml(c.shortName || c.name)}" data-co-short />
                ${c.isDefault ? '<span class="badge badge-ok">Default</span>' : ''}
                ${!c.active ? '<span class="badge badge-out">Inactive</span>' : ''}
                <button class="btn btn-sm" data-co-save="${escapeHtml(c.slug)}">Save</button>
                ${!c.isDefault ? `<button class="btn btn-sm" data-co-toggle="${escapeHtml(c.slug)}" data-co-active="${c.active}">${c.active ? "Disable" : "Enable"}</button>` : ""}
                <button class="btn btn-sm" data-co-perms="${escapeHtml(c.slug)}">Access Control</button>
              </div>`).join("")}`;

          // Save name
          el.querySelectorAll("[data-co-save]").forEach((btn) => {
            btn.onclick = async () => {
              const slug = btn.dataset.coSave;
              const row  = el.querySelector(`[data-co-slug="${slug}"]`);
              const name  = row?.querySelector("[data-co-name]")?.value?.trim();
              const short = row?.querySelector("[data-co-short]")?.value?.trim();
              if (!name) return alert("Name cannot be empty");
              try {
                await api(`/companies/${slug}`, {
                  method: "PATCH",
                  body: JSON.stringify({ name, shortName: short || name }),
                });
                alert(`"${name}" saved.`);
                loadCompaniesList();
              } catch (e) { alert(e.message); }
            };
          });

          // Toggle active
          el.querySelectorAll("[data-co-toggle]").forEach((btn) => {
            btn.onclick = async () => {
              const slug   = btn.dataset.coToggle;
              const active = btn.dataset.coActive !== "false" && btn.dataset.coActive !== false;
              if (!confirm(`${active ? "Disable" : "Enable"} company "${slug}"?`)) return;
              try {
                await api(`/companies/${slug}`, {
                  method: "PATCH",
                  body: JSON.stringify({ active: !active }),
                });
                loadCompaniesList();
              } catch (e) { alert(e.message); }
            };
          });

          // Per-company access control
          el.querySelectorAll("[data-co-perms]").forEach((btn) => {
            btn.onclick = () => openCompanyAccessControlModal(btn.dataset.coPerms, api, helpers);
          });
        } catch (e) {
          const el2 = root.querySelector("#companies-list");
          if (el2) el2.textContent = "Could not load companies: " + (e.message || "unknown error");
        }
      }

      loadCompaniesList();

      root.querySelector("#add-company-btn")?.addEventListener("click", () => {
        openModal(`
          <div class="modal-header"><h2>Add Company</h2><button class="btn btn-sm" data-close>✕</button></div>
          <form id="add-company-form" class="modal-body field-grid">
            <label class="field"><span>Slug <span class="muted">(internal key, e.g. "myco")</span></span>
              <input name="slug" required placeholder="myco" pattern="[a-z0-9_-]+" title="Lowercase letters, numbers, hyphens only" /></label>
            <label class="field"><span>Display name</span>
              <input name="name" required placeholder="My Company" /></label>
            <label class="field"><span>Short name <span class="muted">(sidebar label)</span></span>
              <input name="shortName" placeholder="MyCo" /></label>
            <label class="field"><span>Sort order</span>
              <input name="sortOrder" type="number" value="99" min="1" /></label>
          </form>
          <div class="modal-footer">
            <button class="btn" data-close>Cancel</button>
            <button class="btn btn-primary" id="save-new-company">Add</button>
          </div>`);

        document.getElementById("save-new-company").onclick = async () => {
          const fd = new FormData(document.getElementById("add-company-form"));
          const slug = String(fd.get("slug") || "").trim().toLowerCase();
          const name = String(fd.get("name") || "").trim();
          if (!slug || !name) return alert("Slug and name are required");
          try {
            await api("/companies", {
              method: "POST",
              body: JSON.stringify({
                slug,
                name,
                shortName: String(fd.get("shortName") || "").trim() || name,
                sortOrder: Number(fd.get("sortOrder")) || 99,
              }),
            });
            closeModal();
            loadCompaniesList();
          } catch (e) { alert(e.message); }
        };
      });
    }

  }

  // ── Per-company Access Control modal ──────────────────────────────────────
  async function openCompanyAccessControlModal(companySlug, api, helpers) {
    const { escapeHtml, openModal, closeModal } = helpers;
    let data;
    try {
      data = await api(`/companies/${companySlug}/permissions`);
    } catch (e) {
      return alert("Could not load permissions: " + e.message);
    }
    const perms   = data.permissions   || [];
    const catalog = data.catalog       || [];

    // Group catalog by category
    const byCategory = {};
    for (const p of catalog) {
      if (!byCategory[p.category]) byCategory[p.category] = [];
      byCategory[p.category].push(p);
    }

    const ROLES = ["agent","office_assistant","quality","rtm","tl","op","finance","it","hr","admin","ceo"];

    function permState(role, key) {
      const hit = perms.find((p) => p.role === role && p.permissionKey === key);
      return hit ? (hit.allowed ? "allow" : "deny") : "inherit";
    }

    const categorySections = Object.entries(byCategory).map(([cat, items]) => `
      <div class="co-ac-section">
        <div class="co-ac-cat">${escapeHtml(cat)}</div>
        ${items.map((p) => `
          <div class="co-ac-row">
            <span class="co-ac-label" title="${escapeHtml(p.description || "")}">${escapeHtml(p.label)}</span>
            <div class="co-ac-roles">
              ${ROLES.map((r) => {
                const st = permState(r, p.key);
                return `<label class="co-ac-role-cell" title="${escapeHtml(r)}">
                  <span class="co-ac-role-abbr">${escapeHtml(r.slice(0,3))}</span>
                  <select data-co-perm-role="${escapeHtml(r)}" data-co-perm-key="${escapeHtml(p.key)}" class="co-ac-sel">
                    <option value="inherit" ${st==="inherit"?"selected":""}>—</option>
                    <option value="allow"   ${st==="allow"  ?"selected":""}>✓</option>
                    <option value="deny"    ${st==="deny"   ?"selected":""}>✕</option>
                  </select>
                </label>`;
              }).join("")}
            </div>
          </div>`).join("")}
      </div>`).join("");

    openModal(`
      <style>
        .co-ac-section{margin-bottom:1rem}
        .co-ac-cat{font-weight:700;font-size:.8rem;text-transform:uppercase;color:var(--text-muted,#888);margin:.5rem 0 .25rem}
        .co-ac-row{display:flex;align-items:center;gap:.5rem;padding:.2rem 0;flex-wrap:wrap}
        .co-ac-label{flex:1;min-width:10rem;font-size:.85rem}
        .co-ac-roles{display:flex;gap:.2rem;flex-wrap:wrap}
        .co-ac-role-cell{display:flex;flex-direction:column;align-items:center;font-size:.7rem}
        .co-ac-role-abbr{text-transform:uppercase;margin-bottom:.1rem;opacity:.7}
        .co-ac-sel{font-size:.75rem;padding:.1rem .15rem;width:2.8rem}
      </style>
      <div class="modal-header">
        <h2>Access Control — ${escapeHtml(companySlug)}</h2>
        <button class="btn btn-sm" data-close>✕</button>
      </div>
      <div class="modal-body modal-body-scroll" id="co-ac-body" style="max-height:65vh;overflow-y:auto">
        <p class="muted">
          Override permissions for this company. <strong>—</strong> = use global default.
          <strong>✓</strong> = always allow. <strong>✕</strong> = always deny.
        </p>
        ${categorySections}
      </div>
      <div class="modal-footer">
        <button class="btn" data-close>Close</button>
        <button class="btn btn-primary" id="co-ac-save-all">Save all changes</button>
      </div>`);

    // Track pending changes
    const pending = new Map(); // "role|key" → "allow"|"deny"|"inherit"

    document.getElementById("co-ac-body")?.querySelectorAll(".co-ac-sel").forEach((sel) => {
      sel.addEventListener("change", () => {
        const k = `${sel.dataset.coPermRole}|${sel.dataset.coPermKey}`;
        pending.set(k, sel.value);
      });
    });

    document.getElementById("co-ac-save-all").onclick = async () => {
      if (!pending.size) { closeModal(); return; }
      let saved = 0;
      for (const [k, val] of pending.entries()) {
        const [r, permKey] = k.split("|");
        try {
          if (val === "inherit") {
            await api(`/companies/${companySlug}/permissions`, {
              method: "DELETE",
              body: JSON.stringify({ role: r, permissionKey: permKey }),
            });
          } else {
            await api(`/companies/${companySlug}/permissions`, {
              method: "PUT",
              body: JSON.stringify({ role: r, permissionKey: permKey, allowed: val === "allow" }),
            });
          }
          saved++;
        } catch { /* skip single failures */ }
      }
      alert(`Saved ${saved} permission override(s) for ${companySlug}.`);
      pending.clear();
      closeModal();
    };
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
    openNotificationRoutingModal,
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
