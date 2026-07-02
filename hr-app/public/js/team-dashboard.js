/**
 * Team sales dashboards — daily / weekly roster tables (dialing agents only).
 */
window.TeamDashboardModule = (function () {
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

  function longDateLabel(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  function weekRangeLabel(monday) {
    const sunday = shiftDate(monday, 6);
    return `${longDateLabel(monday)} – ${longDateLabel(sunday)}`;
  }

  function cellVal(n) {
    return n == null || n === 0 ? "" : String(n);
  }

  function renderAgentTable(day, escapeHtml) {
    const rows = day.agentRows || [];
    const totals = day.totals || {};
    return `<div class="table-wrap team-dash-table">
      <table>
        <thead><tr>
          <th>Team</th><th>Agent name</th><th>Approved</th><th>PostDated</th><th>Dropped</th><th>Total Sent</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>
            <td>${r.team ? `<strong>${escapeHtml(r.team)}</strong>` : ""}</td>
            <td>${escapeHtml(r.agentName)}</td>
            <td>${cellVal(r.approved)}</td>
            <td>${cellVal(r.postdated)}</td>
            <td>${cellVal(r.dropped)}</td>
            <td>${r.totalSent ?? 0}</td>
          </tr>`).join("")}
          <tr class="team-dash-total-row">
            <td colspan="2"><strong>Total</strong></td>
            <td>${cellVal(totals.approved)}</td>
            <td>${cellVal(totals.postdated)}</td>
            <td>${cellVal(totals.dropped)}</td>
            <td><strong>${totals.totalSent ?? 0}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>`;
  }

  function renderTeamSummary(day, escapeHtml) {
    const summaries = day.teamSummaries || [];
    return `<div class="table-wrap team-dash-table" style="margin-top:1rem">
      <table>
        <thead><tr>
          <th>Team</th><th>Agents count</th><th>Approved</th><th>Total</th><th>Conversion</th><th>Day-Offs</th>
        </tr></thead>
        <tbody>${summaries.map((t) => `<tr>
          <td><strong>${escapeHtml(t.team)}</strong></td>
          <td>${t.agentsCount}</td>
          <td>${cellVal(t.approved)}</td>
          <td>${t.total ?? 0}</td>
          <td>${escapeHtml(t.conversion || "")}</td>
          <td>${t.dayOffs ? cellVal(t.dayOffs) : ""}</td>
        </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderDayBlock(day, escapeHtml) {
    if (!day?.date) return "";
    return `<section class="team-dash-day card">
      <h3 class="team-dash-date">${longDateLabel(day.date)}</h3>
      ${renderAgentTable(day, escapeHtml)}
      ${renderTeamSummary(day, escapeHtml)}
    </section>`;
  }

  async function renderTeamDashboardPage(root, api, state, helpers) {
    const { escapeHtml } = helpers;
    const period = state.teamDashPeriod || "day";
    const today = todayIso();
    state.teamDashPickDate = state.teamDashPickDate || today;
    state.teamDashWeekDate = state.teamDashWeekDate || mondayOf(today);

    let headerLabel;
    let q;
    if (period === "week") {
      q = new URLSearchParams({ period: "week", date: state.teamDashWeekDate });
      headerLabel = weekRangeLabel(state.teamDashWeekDate);
    } else {
      q = new URLSearchParams({ period: "day", date: state.teamDashPickDate });
      headerLabel = longDateLabel(state.teamDashPickDate);
    }
    if (state.companyContext === "hs2") q.set("company", "hs2");

    const data = await api(`/sales/team-dashboard?${q}`);

    const toolbar = period === "week"
      ? `<div class="toolbar">
          <button class="btn" id="td-prev-week">←</button>
          <strong>${headerLabel}</strong>
          <button class="btn" id="td-next-week">→</button>
          <input type="date" id="td-week-date" value="${state.teamDashWeekDate}" title="Pick any day — week starts Monday" />
          <select id="td-period">
            <option value="day">Daily</option>
            <option value="week" selected>Weekly</option>
          </select>
        </div>`
      : `<div class="toolbar">
          <button class="btn" id="td-prev-day">←</button>
          <strong>${headerLabel}</strong>
          <button class="btn" id="td-next-day">→</button>
          <input type="date" id="td-pick-date" value="${state.teamDashPickDate}" />
          <select id="td-period">
            <option value="day" selected>Daily</option>
            <option value="week">Weekly</option>
          </select>
        </div>`;

    const body = period === "week"
      ? (data.days || []).map((d) => renderDayBlock(d, escapeHtml)).join("")
      : renderDayBlock(data, escapeHtml);

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Team dashboards</h1>
          <p class="muted">${headerLabel} · Active dialing agents on roster (Day-OFF excluded from table)</p>
        </div>
      </div>
      ${toolbar}
      <div class="team-dash-stack">${body || '<p class="muted">No dashboard data for this period.</p>'}</div>`;

    const rerender = () => renderTeamDashboardPage(root, api, state, helpers);

    root.querySelector("#td-prev-day")?.addEventListener("click", () => {
      state.teamDashPickDate = shiftDate(state.teamDashPickDate, -1);
      rerender();
    });
    root.querySelector("#td-next-day")?.addEventListener("click", () => {
      state.teamDashPickDate = shiftDate(state.teamDashPickDate, 1);
      rerender();
    });
    root.querySelector("#td-pick-date")?.addEventListener("change", (e) => {
      state.teamDashPickDate = e.target.value;
      rerender();
    });
    root.querySelector("#td-prev-week")?.addEventListener("click", () => {
      state.teamDashWeekDate = shiftDate(state.teamDashWeekDate, -7);
      rerender();
    });
    root.querySelector("#td-next-week")?.addEventListener("click", () => {
      state.teamDashWeekDate = shiftDate(state.teamDashWeekDate, 7);
      rerender();
    });
    root.querySelector("#td-week-date")?.addEventListener("change", (e) => {
      state.teamDashWeekDate = mondayOf(e.target.value);
      rerender();
    });
    root.querySelector("#td-period")?.addEventListener("change", (e) => {
      state.teamDashPeriod = e.target.value;
      rerender();
    });
  }

  return { renderTeamDashboardPage };
})();
