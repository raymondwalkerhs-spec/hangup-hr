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

  function periodToolbar(period, state, monthToolbar, monthLabel) {
    const extra = `<select id="sales-period">
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
      </div>
      ${periodToolbar(period, state, monthToolbar, monthLabel).replace(
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
    root.querySelectorAll(".card-stat-click").forEach((card) => {
      card.addEventListener("click", () => {
        state.salesStatusFilter = card.dataset.filter || "";
        rerender();
      });
    });
    root.querySelector("#add-sale-btn")?.addEventListener("click", () =>
      openSaleModal(api, employees, helpers, null, rerender)
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
      btn.onclick = async () => {
        const feedback = prompt("Denial reason (optional):") || "";
        await api(`/sales/${btn.dataset.deny}`, { method: "PATCH", body: JSON.stringify({ action: "deny", feedback }) });
        rerender();
      };
    });
    root.querySelectorAll("[data-callback]").forEach((btn) => {
      btn.onclick = async () => {
        const feedback = prompt("Callback feedback:") || "";
        if (!feedback) return;
        const visible = confirm("Allow agent to see this callback feedback?");
        await api(`/sales/${btn.dataset.callback}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "callback", feedback, callbackVisibleToAgent: visible }),
        });
        rerender();
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

  function openSaleModal(api, employees, helpers, sale, onDone) {
    const { escapeHtml, closeModal, openModal } = helpers;
    const isEdit = !!sale;
    const agentOpts = employees
      .filter((e) => !/^(TL|CL|OP|HR)/i.test(e.id) || e.id === sale?.agentId)
      .map((e) => `<option value="${e.id}" ${sale?.agentId === e.id ? "selected" : ""}>${e.id} — ${escapeHtml(e.american_name || e.id)}</option>`)
      .join("");
    const statusOpts = ["passed", "pending", "postdated", "denied", "callback"]
      .map((st) => `<option value="${st}" ${sale?.status === st ? "selected" : ""}>${st}</option>`)
      .join("");
    openModal(`
      <div class="modal-header"><h2>${isEdit ? "Edit sale" : "Add sale"}</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="sale-form" class="form-grid modal-body-scroll">
        <label class="field"><span>Phone</span><input name="phoneNumber" required value="${escapeHtml(sale?.phoneNumber || "")}" /></label>
        <label class="field"><span>Full name</span><input name="fullName" required value="${escapeHtml(sale?.fullName || "")}" /></label>
        <label class="field"><span>Device</span><select name="device" required>
          <option value="bracelet" ${sale?.device === "bracelet" ? "selected" : ""}>Bracelet</option>
          <option value="necklace" ${sale?.device === "necklace" ? "selected" : ""}>Necklace</option>
          <option value="smartwatch" ${sale?.device === "smartwatch" ? "selected" : ""}>Smartwatch</option>
        </select></label>
        <label class="field"><span>Agent</span><select name="agentId" required>${agentOpts}</select></label>
        <label class="field"><span>Closer</span><select name="closerId">${closerSelectOptions(employees, escapeHtml, sale?.closerId || "")}</select></label>
        <label class="field"><span>Price (optional)</span><input name="price" type="number" step="0.01" value="${sale?.price != null ? sale.price : ""}" /></label>
        <label class="field"><span>Client (optional)</span><input name="client" value="${escapeHtml(sale?.client || "")}" /></label>
        <label class="field"><span>Submission date</span><input name="submissionDate" type="date" value="${sale?.submissionDate || new Date().toISOString().slice(0, 10)}" /></label>
        <label class="field"><span>Effective date</span><input name="effectiveDate" type="date" value="${sale?.effectiveDate || new Date().toISOString().slice(0, 10)}" /></label>
        ${canEdit() ? `<label class="field"><span>Status</span><select name="status">${statusOpts}</select></label>
        <label class="field" style="grid-column:1/-1"><span>Feedback</span><input name="feedback" value="${escapeHtml(sale?.feedback || "")}" /></label>` : ""}
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button></div>
      </form>
    `, true);
    document.getElementById("sale-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      if (body.price) body.price = Number(body.price);
      try {
        if (isEdit) {
          body.edit = true;
          await api(`/sales/${sale.id}`, { method: "PATCH", body: JSON.stringify(body) });
        } else {
          await api("/sales", { method: "POST", body: JSON.stringify(body) });
        }
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  return { renderSalesPage };
})();
