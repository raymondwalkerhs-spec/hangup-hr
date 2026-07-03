/**
 * Sales management UI.
 */
window.SalesModule = (function () {
  const PERIOD_LABELS = { day: "Day", week: "Week", month: "Month" };

  function canApprove() {
    return ["hr", "admin", "ceo", "quality", "rtm"].includes(state.user?.role);
  }

  function canEdit() {
    return state.user?.canEditSales === true || canApprove() || state.user?.role === "op";
  }

  function canSubmit() {
    return state.user?.canViewSales !== false;
  }

  function canManagePermissions() {
    return ["hr", "admin", "ceo"].includes(state.user?.role);
  }

  async function openSaleAttachment(attachmentId, fileName) {
    const sessionId = typeof getSessionId === "function" ? getSessionId() : "";
    const res = await fetch(`/api/sales/attachments/${encodeURIComponent(attachmentId)}/file`, {
      headers: sessionId ? { "x-session-id": sessionId } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Could not open file");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const mime = res.headers.get("content-type") || "";
    if (/^audio\//i.test(mime)) {
      openModal(
        `<div class="modal-header"><h2>${escapeHtml(fileName || "Recording")}</h2><button class="btn btn-sm" data-close>✕</button></div>
        <div class="modal-body"><audio controls autoplay src="${url}" style="width:100%"></audio>
        <p class="muted" style="margin-top:.75rem">Cached on this PC for 48 hours after first open.</p></div>`
      );
    } else {
      window.open(url, "_blank");
    }
  }

  function monthEnd(ym) {
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${ym}-${String(last).padStart(2, "0")}`;
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function mondayOf(dateStr) {
    const dt = new Date(`${dateStr}T12:00:00`);
    const day = dt.getDay();
    const monday = new Date(dt);
    monday.setDate(dt.getDate() - ((day + 6) % 7));
    return monday.toISOString().slice(0, 10);
  }

  function shiftDate(dateStr, deltaDays) {
    const dt = new Date(`${dateStr}T12:00:00`);
    dt.setDate(dt.getDate() + deltaDays);
    return dt.toISOString().slice(0, 10);
  }

  function shortDateLabel(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function weekRangeLabel(monday) {
    const sunday = shiftDate(monday, 6);
    return `${shortDateLabel(monday)} – ${shortDateLabel(sunday)}`;
  }

  function statSum(dashboard, key) {
    if (dashboard.totals?.[key] != null) return dashboard.totals[key];
    return (dashboard.groups || []).reduce((s, g) => s + (g[key] || 0), 0);
  }

  function employeeSelectOptions(employees, escapeHtml, selectedId = "", filter = "all") {
    let list = employees.slice();
    if (filter === "dialing") {
      list = list.filter((e) => !/^(TL|CL|OP|HR|MG|OF|NW)/i.test(String(e.id || "")));
    } else if (filter === "leaders") {
      list = list.filter((e) => /^(TL|CL|OP|HR|quality|rtm)/i.test(String(e.id || "")) || ["quality", "rtm"].includes(String(e.role || "").toLowerCase()));
    } else if (filter === "quality") {
      list = list.filter((e) => /^(HR|quality|rtm|MG)/i.test(String(e.id || "")) || ["quality", "rtm", "hr", "admin", "ceo"].includes(String(e.role || "").toLowerCase()));
    }
    list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let html = '<option value="">— Select —</option>';
    for (const e of list) {
      html += `<option value="${e.id}" ${selectedId === e.id ? "selected" : ""}>${e.id} — ${escapeHtml(e.american_name || e.id)}</option>`;
    }
    return html;
  }

  function salesPersonFilters(employees, escapeHtml, state) {
    const agentOpts = employeeSelectOptions(employees, escapeHtml, state.salesAgentFilter || "", "dialing");
    const closerOpts = employeeSelectOptions(employees, escapeHtml, state.salesCloserFilter || "", "all");
    return `<select id="sales-agent-filter" title="Filter by agent"><option value="">All agents</option>${agentOpts.replace('<option value="">— Select —</option>', "")}</select>
      <select id="sales-closer-filter" title="Filter by closer"><option value="">All closers</option>${closerOpts.replace('<option value="">— Select —</option>', "")}</select>`;
  }

  function periodToolbar(period, state, monthToolbar, monthLabel, employees, escapeHtml) {
    const personFilters = period === "month" ? salesPersonFilters(employees, escapeHtml, state) : "";
    const extra = `${personFilters}<select id="sales-period">
      <option value="day" ${period === "day" ? "selected" : ""}>Daily</option>
      <option value="week" ${period === "week" ? "selected" : ""}>Weekly</option>
      <option value="month" ${period === "month" ? "selected" : ""}>Monthly</option>
    </select>
    <select id="sales-status-filter">
      <option value="">All statuses</option>
    </select>`;

    if (period === "month") {
      return monthToolbar(extra);
    }
    if (period === "day") {
      const d = state.salesPickDate || todayIso();
      return `<div class="toolbar">
        <button class="btn" id="prev-day">←</button>
        <strong>${shortDateLabel(d)}</strong>
        <button class="btn" id="next-day">→</button>
        <input type="date" id="sales-pick-date" value="${d}" />
        ${extra}
      </div>`;
    }
    const mon = state.salesWeekDate || mondayOf(todayIso());
    return `<div class="toolbar">
      <button class="btn" id="prev-week">←</button>
      <strong>${weekRangeLabel(mon)}</strong>
      <button class="btn" id="next-week">→</button>
      <input type="date" id="sales-week-date" value="${mon}" title="Pick any day — snaps to Monday of that week" />
      ${extra}
    </div>`;
  }

  function bindPeriodNav(root, period, state, rerender) {
    root.querySelector("#prev-day")?.addEventListener("click", () => {
      state.salesPickDate = shiftDate(state.salesPickDate || todayIso(), -1);
      rerender();
    });
    root.querySelector("#next-day")?.addEventListener("click", () => {
      state.salesPickDate = shiftDate(state.salesPickDate || todayIso(), 1);
      rerender();
    });
    root.querySelector("#sales-pick-date")?.addEventListener("change", (e) => {
      state.salesPickDate = e.target.value;
      rerender();
    });
    root.querySelector("#prev-week")?.addEventListener("click", () => {
      state.salesWeekDate = shiftDate(state.salesWeekDate || mondayOf(todayIso()), -7);
      rerender();
    });
    root.querySelector("#next-week")?.addEventListener("click", () => {
      state.salesWeekDate = shiftDate(state.salesWeekDate || mondayOf(todayIso()), 7);
      rerender();
    });
    root.querySelector("#sales-week-date")?.addEventListener("change", (e) => {
      state.salesWeekDate = mondayOf(e.target.value);
      rerender();
    });
  }

  function agentsOffTitle(agentsOff, date, escapeHtml) {
    const list = agentsOff[date] || [];
    if (!list.length) return "";
    return list.map((a) => a.name).join(", ");
  }

  function agentsOffLine(agentsOff, date, escapeHtml) {
    const list = agentsOff[date] || [];
    if (!list.length) return "";
    const names = list.map((a) => escapeHtml(a.name)).join(", ");
    return `<br><span class="muted" style="font-size:.72rem;line-height:1.2">Off: ${names}</span>`;
  }

  function renderPeriodGrid(grid, escapeHtml) {
    if (!grid?.teams?.length) {
      return `<div class="card muted" style="padding:1rem;margin-bottom:1rem">No team data for this period.</div>`;
    }
    const { teams, dates, matrix, agentsOff } = grid;
    return `<div class="table-wrap card" style="margin-bottom:1rem;overflow-x:auto">
      <table class="sales-period-grid">
        <thead><tr>
          <th>Team</th>
          ${dates.map((d) => {
            const title = agentsOffTitle(agentsOff, d, escapeHtml);
            return `<th title="${escapeHtml(title)}">${shortDateLabel(d)}${agentsOffLine(agentsOff, d, escapeHtml)}</th>`;
          }).join("")}
        </tr></thead>
        <tbody>${teams.map((team) => `<tr>
          <td><strong>${escapeHtml(team)}</strong></td>
          ${dates.map((d) => {
            const count = matrix[team]?.[d] ?? 0;
            const title = agentsOffTitle(agentsOff, d, escapeHtml);
            return `<td title="${escapeHtml(title)}" class="${count ? "" : "muted"}">${count || "—"}</td>`;
          }).join("")}
        </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  async function renderSalesPage(root, api, state, helpers) {
    const { monthLabel, escapeHtml, fmt, bindMonthNav, monthToolbar } = helpers;
    const month = state.month;
    const period = state.salesPeriod || "month";
    const today = todayIso();
    state.salesPickDate = state.salesPickDate || today;
    state.salesWeekDate = state.salesWeekDate || mondayOf(today);
    state.salesStatusFilter = state.salesStatusFilter || "";
    state.salesAgentFilter = state.salesAgentFilter || "";
    state.salesCloserFilter = state.salesCloserFilter || "";

    let from;
    let to;
    let dashDate;
    if (period === "day") {
      from = to = dashDate = state.salesPickDate;
    } else if (period === "week") {
      from = state.salesWeekDate;
      to = shiftDate(from, 6);
      dashDate = from;
    } else {
      from = `${month}-01`;
      to = monthEnd(month);
      dashDate = from;
    }

    const salesQ = new URLSearchParams({ from, to });
    if (state.salesStatusFilter) salesQ.set("status", state.salesStatusFilter);
    if (state.salesAgentFilter) salesQ.set("agentId", state.salesAgentFilter);
    if (state.salesCloserFilter) salesQ.set("closerId", state.salesCloserFilter);
    if (state.companyContext === "hs2") salesQ.set("company", "hs2");
    const dashQ = new URLSearchParams({ period, date: dashDate, groupBy: "team" });
    if (state.companyContext === "hs2") dashQ.set("company", "hs2");
    const [salesRes, dashRes, empRes] = await Promise.all([
      api(`/sales?${salesQ}`),
      api(`/sales/dashboard?${dashQ}`),
      api(`/employees${employeesQuery()}`),
    ]);
    let sales = salesRes.sales || [];
    if (state.salesStatusFilter) {
      sales = sales.filter((s) => s.status === state.salesStatusFilter);
    }
    const dashboard = dashRes;
    const employees = empRes.employees || [];
    const empById = new Map(employees.map((e) => [e.id, e]));
    const periodLabel = PERIOD_LABELS[period] || "Month";
    const headerLabel = period === "month"
      ? monthLabel(month)
      : period === "day"
        ? shortDateLabel(state.salesPickDate)
        : weekRangeLabel(state.salesWeekDate);

    const statusOpts = (salesRes.statuses || ["passed", "pending", "postdated", "denied", "callback"])
      .map((st) => `<option value="${st}" ${state.salesStatusFilter === st ? "selected" : ""}>${st}</option>`)
      .join("");

    root.innerHTML = `
      <div class="page-header">
        <div><h1>Sales log</h1><p class="muted">${headerLabel} · ${sales.length} records · For team dashboards use <strong>Team dashboards</strong> in the sidebar</p></div>
        ${canSubmit() ? '<button class="btn btn-primary" id="add-sale-btn">+ Add sale</button>' : ""}
        ${canManagePermissions() ? '<button class="btn btn-sm" id="sales-perms-btn">Column permissions</button>' : ""}
      </div>
      ${periodToolbar(period, state, monthToolbar, monthLabel, employees, escapeHtml).replace(
        '<option value="">All statuses</option>',
        `<option value="">All statuses</option>${statusOpts}`
      )}
      <div class="grid-2 sales-stat-grid" style="gap:1rem;margin-bottom:1rem">
        <div class="card card-stat card-stat-click" data-filter="passed"><strong>${statSum(dashboard, "passed")}</strong><span class="muted">Passed (${periodLabel})</span></div>
        <div class="card card-stat card-stat-click" data-filter="pending"><strong>${statSum(dashboard, "pending")}</strong><span class="muted">Pending</span></div>
        <div class="card card-stat card-stat-click" data-filter="callback"><strong>${statSum(dashboard, "callback")}</strong><span class="muted">Callback</span></div>
        <div class="card card-stat card-stat-click" data-filter="denied"><strong>${statSum(dashboard, "denied")}</strong><span class="muted">Denied</span></div>
      </div>
      <div class="table-wrap card"><table>
        <thead><tr><th>Date</th><th>Customer</th><th>Device</th><th>Agent</th><th>Status</th><th>Price</th><th></th></tr></thead>
        <tbody>${sales.length ? sales.map((s) => {
          const agent = empById.get(s.agentId);
          const agentName = agent ? (agent.american_name || s.agentId) : s.agentId;
          const postNote = s.status === "postdated" && s.submissionDate !== s.effectiveDate
            ? `<br><span class="muted">Postdated from ${s.submissionDate}</span>` : "";
          return `<tr>
            <td>${s.effectiveDate}${postNote}</td>
            <td><strong>${escapeHtml(s.fullName)}</strong><br><span class="muted">${escapeHtml(s.phoneNumber)}</span></td>
            <td>${escapeHtml(s.device)}</td>
            <td>${escapeHtml(s.agentId)}<br><span class="muted">${escapeHtml(agentName)}</span></td>
            <td><span class="badge">${escapeHtml(s.status)}</span></td>
            <td>${s.price != null ? fmt(s.price) : "—"}</td>
            <td class="btn-row">
              ${canEdit() ? `<button class="btn btn-sm" data-edit-sale="${s.id}">Edit</button>` : ""}
              ${canApprove() && s.status === "pending" ? `<button class="btn btn-sm" data-approve="${s.id}">Approve</button>
                <button class="btn btn-sm btn-danger" data-deny="${s.id}">Deny</button>` : ""}
              ${canApprove() ? `<button class="btn btn-sm" data-callback="${s.id}">Callback</button>` : ""}
            </td>
          </tr>`;
        }).join("") : `<tr><td colspan="7" class="muted">No sales in this ${periodLabel.toLowerCase()} period</td></tr>`}
        </tbody>
      </table></div>`;

    const rerender = () => renderSalesPage(root, api, state, helpers);
    if (period === "month") bindMonthNav(root);
    else bindPeriodNav(root, period, state, rerender);

    root.querySelector("#sales-period")?.addEventListener("change", (e) => {
      state.salesPeriod = e.target.value;
      rerender();
    });
    root.querySelector("#sales-status-filter")?.addEventListener("change", (e) => {
      state.salesStatusFilter = e.target.value;
      rerender();
    });
    root.querySelector("#sales-agent-filter")?.addEventListener("change", (e) => {
      state.salesAgentFilter = e.target.value;
      rerender();
    });
    root.querySelector("#sales-closer-filter")?.addEventListener("change", (e) => {
      state.salesCloserFilter = e.target.value;
      rerender();
    });
    root.querySelectorAll(".card-stat-click").forEach((card) => {
      card.addEventListener("click", () => {
        state.salesStatusFilter = card.dataset.filter || "";
        rerender();
      });
    });
    root.querySelector("#add-sale-btn")?.addEventListener("click", () =>
      openSaleModal(api, employees, helpers, null, rerender)
    );
    root.querySelector("#sales-perms-btn")?.addEventListener("click", () =>
      openSalesPermissionsModal(api, helpers, rerender)
    );
    root.querySelectorAll("[data-edit-sale]").forEach((btn) => {
      btn.onclick = () => {
        const sale = sales.find((s) => s.id === btn.dataset.editSale);
        if (sale) openSaleModal(api, employees, helpers, sale, rerender);
      };
    });
    root.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.onclick = async () => {
        await api(`/sales/${btn.dataset.approve}`, { method: "PATCH", body: JSON.stringify({ action: "approve" }) });
        rerender();
      };
    });
    root.querySelectorAll("[data-deny]").forEach((btn) => {
      btn.onclick = () => {
        openPromptModal({
          title: "Deny sale",
          message: "Optional denial reason:",
          placeholder: "Reason",
          confirmLabel: "Deny",
          onSubmit: async (feedback) => {
            await api(`/sales/${btn.dataset.deny}`, {
              method: "PATCH",
              body: JSON.stringify({ action: "deny", feedback }),
            });
            rerender();
          },
        });
      };
    });
    root.querySelectorAll("[data-callback]").forEach((btn) => {
      btn.onclick = () => {
        openModal(
          `<div class="modal-header"><h2>Callback</h2><button class="btn btn-sm" data-close>✕</button></div>
          <form id="sale-callback-form" class="modal-body">
            <label class="field"><span>Feedback</span><textarea name="feedback" required rows="3"></textarea></label>
            <label class="toggle-label"><input type="checkbox" name="visible" /> Allow agent to see this feedback</label>
          </form>
          <div class="modal-footer">
            <button class="btn" data-close>Cancel</button>
            <button type="submit" form="sale-callback-form" class="btn btn-primary">Send callback</button>
          </div>`,
          true
        );
        document.getElementById("sale-callback-form").onsubmit = async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const feedback = String(fd.get("feedback") || "").trim();
          if (!feedback) return alert("Feedback is required");
          await api(`/sales/${btn.dataset.callback}`, {
            method: "PATCH",
            body: JSON.stringify({
              action: "callback",
              feedback,
              callbackVisibleToAgent: fd.get("visible") === "on",
            }),
          });
          closeModal();
          rerender();
        };
      };
    });
  }

  function closerSelectOptions(employees, escapeHtml, selectedId = "") {
    const isLead = (e) => /^(TL|CL|OP)/i.test(String(e.id || ""));
    const excludedUnit = (u) => /back.?end/i.test(String(u || "")) || String(u || "") === "HS-Back-End";
    const isDialingAgent = (e) =>
      !/^(TL|CL|OP|HR|MG|OF|NW)/i.test(String(e.id || "")) && e.unit && !excludedUnit(e.unit);
    const leaders = employees.filter(isLead).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const agents = employees
      .filter((e) => isDialingAgent(e) && !isLead(e))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let html = '<option value="">— Select closer —</option>';
    for (const e of leaders) {
      html += `<option value="${e.id}" ${selectedId === e.id ? "selected" : ""}>★ ${e.id} — ${escapeHtml(e.american_name || e.id)}</option>`;
    }
    if (leaders.length && agents.length) html += '<option disabled>— Dialing agents —</option>';
    for (const e of agents) {
      html += `<option value="${e.id}" ${selectedId === e.id ? "selected" : ""}>${e.id} — ${escapeHtml(e.american_name || e.id)}</option>`;
    }
    return html;
  }

  async function openSaleModal(api, employees, helpers, sale, onDone) {
    const { escapeHtml, closeModal, openModal } = helpers;
    const isEdit = !!sale;
    const catalog = await api("/sales/field-catalog").catch(() => ({ fields: [], attachmentKinds: [] }));
    const fields = (catalog.fields || []).filter((f) => {
      if (isEdit && f.hideOnEdit) return false;
      if (!isEdit && f.hideOnCreate) return false;
      return true;
    });
    const formData = sale?.formData || {};
    const agentEmp = employees.find((e) => e.id === sale?.agentId);
    const closerEmp = employees.find((e) => e.id === sale?.closerId);
    const agentOpts = employeeSelectOptions(employees, escapeHtml, sale?.agentId || "", "dialing");

    function fieldHtml(f) {
      const val = formData[f.key] ?? sale?.[f.key] ?? "";
      const name = f.key === "deviceType" ? "device" : f.key;
      if (f.type === "employee") {
        const selected = val || "";
        return `<label class="field"><span>${escapeHtml(f.label)}</span><select name="${name}">${employeeSelectOptions(employees, escapeHtml, selected, f.employeeFilter || "all")}</select></label>`;
      }
      if (f.type === "select" && f.options) {
        return `<label class="field"><span>${escapeHtml(f.label)}</span><select name="${name}">${f.options.map((o) => `<option value="${o}" ${String(val) === o ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;
      }
      if (f.type === "textarea") {
        return `<label class="field" style="grid-column:1/-1"><span>${escapeHtml(f.label)}</span><textarea name="${name}">${escapeHtml(val)}</textarea></label>`;
      }
      const inputType = f.type === "tel" ? "tel" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
      const req = f.required ? " required" : "";
      return `<label class="field"><span>${escapeHtml(f.label)}</span><input name="${name}" type="${inputType}" value="${escapeHtml(val)}"${req} /></label>`;
    }

    const agentCloserHtml = isEdit
      ? `<div class="field" style="grid-column:1/-1">
          <span class="muted">Agent</span><div><strong>${escapeHtml(sale?.agentId || "—")}</strong> — ${escapeHtml(agentEmp?.american_name || "")}</div>
          <span class="muted">Closer</span><div><strong>${escapeHtml(sale?.closerId || "—")}</strong> — ${escapeHtml(closerEmp?.american_name || "")}</div>
        </div>`
      : `<label class="field"><span>Agent</span><select name="agentId" required>${agentOpts}</select></label>
         <label class="field"><span>Closer</span><select name="closerId">${closerSelectOptions(employees, escapeHtml, sale?.closerId || "")}</select></label>`;

    const sections = [...new Set(fields.map((f) => f.section || "general"))];
    const sectionHtml = sections.map((sec) => {
      const secFields = fields.filter((f) => (f.section || "general") === sec);
      if (!secFields.length) return "";
      return `<fieldset class="card card-flat" style="grid-column:1/-1"><legend>${escapeHtml(sec)}</legend><div class="field-grid">${secFields.map(fieldHtml).join("")}</div></fieldset>`;
    }).join("");

    const attachKinds = (catalog.attachmentKinds || []).filter((k) => k.viewRoles?.includes(state.user?.role) || canEdit());
    const attachHtml = isEdit && attachKinds.length
      ? `<div class="card card-flat" style="grid-column:1/-1"><h4>Attachments</h4>
        ${attachKinds.map((k) => `<label class="field"><span>${escapeHtml(k.label)}</span><input type="file" data-attach-kind="${k.key}" accept="audio/*,image/*,.pdf" /></label>`).join("")}
        <div id="sale-attachments-list" class="muted">Loading…</div></div>`
      : "";

    openModal(`
      <div class="modal-header"><h2>${isEdit ? "Edit sale" : "Add sale"}</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="sale-form" class="form-grid modal-body-scroll">
        ${agentCloserHtml}
        ${sectionHtml}
        ${attachHtml}
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button></div>
      </form>
    `, true);

    let salesClientsMeta = null;
    if (window.HRSalesConfigBreaks) {
      salesClientsMeta = await window.HRSalesConfigBreaks.enhanceSaleModal(
        api,
        { escapeHtml, closeModal, openModal },
        sale,
        document.getElementById("modal-root") || document,
        () => canEdit(),
        openSaleAttachment
      ).catch(() => null);
    } else if (isEdit && sale?.id) {
      api(`/sales/${sale.id}/attachments`).then((res) => {
        const el = document.getElementById("sale-attachments-list");
        if (!el) return;
        const list = res.attachments || [];
        el.innerHTML = list.length
          ? list.map((a) => `<div class="adj-row"><button type="button" class="btn btn-sm btn-link" data-open-attach="${a.id}">${escapeHtml(a.fileName)}</button> <span class="muted">${a.kind}</span></div>`).join("")
          : "<span>No attachments yet</span>";
        el.querySelectorAll("[data-open-attach]").forEach((btn) => {
          btn.onclick = () => openSaleAttachment(btn.dataset.openAttach, btn.textContent);
        });
      }).catch(() => {});
    }

    document.getElementById("sale-form").onsubmit = async (e) => {
      e.preventDefault();
      const clientId = document.getElementById("sale-client-select")?.value;
      if (clientId && window.HRSalesConfigBreaks) {
        const clients = salesClientsMeta?.clients || (await window.HRSalesConfigBreaks.loadCatalog(api).catch(() => ({ clients: [] }))).clients;
        const ok = await window.HRSalesConfigBreaks.validateClientSubmit(clients, clientId);
        if (!ok) return;
      }
      const fd = new FormData(e.target);
      const body = { formData: {} };
      for (const [k, v] of fd.entries()) {
        if (k === "agentId" || k === "closerId") body[k] = v;
        else if (k === "device") {
          body.device = v;
          body.formData.deviceType = v;
        } else {
          body.formData[k] = v;
          if (k === "phoneNumber") body.phoneNumber = v;
          if (k === "fullName") body.fullName = v;
          if (k === "price") body.price = Number(v) || null;
          if (k === "client") body.client = v;
          if (k === "salesClientId" || k === "salesProductId" || k === "salesPriceId") body.formData[k] = v;
          if (k === "submissionDate") body.submissionDate = v;
          if (k === "effectiveDate") body.effectiveDate = v;
          if (k === "status") body.status = v;
          if (k === "feedback") body.feedback = v;
        }
      }
      try {
        let saleId = sale?.id;
        if (isEdit) {
          body.edit = true;
          await api(`/sales/${sale.id}`, { method: "PATCH", body: JSON.stringify(body) });
        } else {
          const res = await api("/sales", { method: "POST", body: JSON.stringify(body) });
          saleId = res.sale?.id;
        }
        for (const input of e.target.querySelectorAll("[data-attach-kind]")) {
          const file = input.files?.[0];
          if (!file || !saleId) continue;
          const b64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(",")[1]);
            r.onerror = reject;
            r.readAsDataURL(file);
          });
          await api(`/sales/${saleId}/attachments`, {
            method: "POST",
            body: JSON.stringify({ fileName: file.name, contentBase64: b64, kind: input.dataset.attachKind }),
          });
        }
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const PERM_ROLE_GROUPS = [
    { key: "agent", label: "Agent", roles: ["agent"] },
    { key: "tl", label: "TL", roles: ["tl"] },
    { key: "op", label: "OP", roles: ["op"] },
    { key: "quality", label: "Quality", roles: ["quality"] },
    { key: "rtm", label: "RTM", roles: ["rtm"] },
    { key: "admin", label: "Admin/HR", roles: ["admin", "hr", "finance", "ceo"] },
  ];

  function groupHasAllRoles(list, groupRoles) {
    const set = new Set((list || []).map((r) => String(r).toLowerCase()));
    return groupRoles.every((r) => set.has(r));
  }

  function toggleGroupRoles(list, groupRoles, enabled) {
    const set = new Set((list || []).map((r) => String(r).toLowerCase()));
    for (const r of groupRoles) {
      if (enabled) set.add(r);
      else set.delete(r);
    }
    return [...set];
  }

  async function openSalesPermissionsModal(api, helpers, onDone) {
    const { escapeHtml, closeModal, openModal } = helpers;
    const catalog = await api("/sales/field-catalog?allFields=1");
    const perms = catalog.permissions || [];
    const permMap = Object.fromEntries(perms.map((p) => [p.fieldKey, p]));
    const fields = (catalog.fields && catalog.fields.length)
      ? catalog.fields
      : perms.map((p) => ({ key: p.fieldKey, label: p.label || p.fieldKey, section: p.section || "general" }));

    const headerCells = PERM_ROLE_GROUPS.map((g) => `<th colspan="2">${g.label}</th>`).join("");
    const subHeader = PERM_ROLE_GROUPS.map(() => `<th>View</th><th>Edit</th>`).join("");

    const rows = fields.map((f) => {
      const p = permMap[f.key] || {};
      const viewRoles = p.viewRoles || p.view_roles || [];
      const editRoles = p.editRoles || p.edit_roles || [];
      const cells = PERM_ROLE_GROUPS.map((g) => {
        const viewOn = groupHasAllRoles(viewRoles, g.roles);
        const editOn = groupHasAllRoles(editRoles, g.roles);
        return `<td><input type="checkbox" data-field="${f.key}" data-kind="view" data-group="${g.key}" ${viewOn ? "checked" : ""} /></td>
          <td><input type="checkbox" data-field="${f.key}" data-kind="edit" data-group="${g.key}" ${editOn ? "checked" : ""} /></td>`;
      }).join("");
      return `<tr><td>${escapeHtml(f.label || f.key)}<br><span class="muted">${escapeHtml(f.section || "")}</span></td>${cells}</tr>`;
    }).join("");

    openModal(`
      <div class="modal-header">
        <h2>Sales column permissions</h2>
        <button class="btn btn-sm" data-close>✕</button>
      </div>
      <div class="modal-body modal-body-scroll">
        <p class="muted">Control which role groups can view or edit each MLA-Ray column. Changes apply on the next save.</p>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Field</th>${headerCells}</tr>
          <tr><th></th>${subHeader}</tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sm" id="sales-perms-seed">Reset defaults</button>
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="sales-perms-save">Save permissions</button>
      </div>`, true);

    document.getElementById("sales-perms-seed")?.addEventListener("click", () => {
      openConfirmModal({
        title: "Reset permissions",
        message: "Reset all column permissions to catalog defaults?",
        confirmLabel: "Reset",
        danger: true,
        onConfirm: async () => {
          await api("/sales/field-permissions/seed", { method: "POST", body: "{}" });
          closeModal();
          onDone();
        },
      });
    });

    document.getElementById("sales-perms-save")?.addEventListener("click", async () => {
      const byField = {};
      for (const input of document.querySelectorAll("[data-field][data-group]")) {
        const fieldKey = input.dataset.field;
        const kind = input.dataset.kind;
        const group = PERM_ROLE_GROUPS.find((g) => g.key === input.dataset.group);
        if (!group) continue;
        if (!byField[fieldKey]) {
          const p = permMap[fieldKey] || {};
          byField[fieldKey] = {
            viewRoles: [...(p.viewRoles || p.view_roles || [])],
            editRoles: [...(p.editRoles || p.edit_roles || [])],
          };
        }
        byField[fieldKey][kind === "view" ? "viewRoles" : "editRoles"] = toggleGroupRoles(
          byField[fieldKey][kind === "view" ? "viewRoles" : "editRoles"],
          group.roles,
          input.checked
        );
      }
      try {
        for (const [fieldKey, body] of Object.entries(byField)) {
          await api(`/sales/field-permissions/${encodeURIComponent(fieldKey)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        }
        closeModal();
        onDone();
      } catch (e) {
        alert(e.message);
      }
    });
  }

  return { renderSalesPage };
})();
