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
    const byTeam = new Map();
    for (const r of rows) {
      const key = r.teamKey || r.team || "—";
      if (!byTeam.has(key)) byTeam.set(key, []);
      byTeam.get(key).push(r);
    }
    const teamBlocks = [...byTeam.entries()]
      .map(([team, teamRows]) => {
        let tApproved = 0;
        let tPost = 0;
        let tDrop = 0;
        let tTotal = 0;
        const body = teamRows
          .map((r) => {
            tApproved += r.approved || 0;
            tPost += r.postdated || 0;
            tDrop += r.dropped || 0;
            tTotal += r.totalSent || 0;
            return `<tr class="${r.dayOff ? "muted" : ""}">
              <td>${escapeHtml(r.agentName)}</td>
              <td>${cellVal(r.approved)}</td>
              <td>${cellVal(r.postdated)}</td>
              <td>${cellVal(r.dropped)}</td>
              <td>${r.totalSent ?? 0}</td>
            </tr>`;
          })
          .join("");
        return `<div class="table-wrap team-dash-table" style="margin-bottom:1rem">
          <h4 style="margin:0 0 .5rem">${escapeHtml(team)}</h4>
          <table>
            <thead><tr><th>Agent name</th><th>Approved</th><th>PostDated</th><th>Dropped</th><th>Total Sent</th></tr></thead>
            <tbody>${body}
              <tr class="team-dash-total-row"><td><strong>Team total</strong></td>
                <td>${cellVal(tApproved)}</td><td>${cellVal(tPost)}</td><td>${cellVal(tDrop)}</td><td><strong>${tTotal}</strong></td></tr>
            </tbody>
          </table>
        </div>`;
      })
      .join("");
    return `${teamBlocks}<div class="table-wrap team-dash-table"><table><tbody>
      <tr class="team-dash-total-row"><td colspan="5"><strong>Grand total</strong> — Approved ${cellVal(totals.approved)} · Total ${totals.totalSent ?? 0}</td></tr>
    </tbody></table></div>`;
  }

  function renderTeamSummary(day, escapeHtml) {
    const summaries = day.teamSummaries || [];
    return `<div class="table-wrap team-dash-table" style="margin-top:1rem">
      <table>
        <thead><tr>
          <th>Team</th><th>Active agents</th><th>Approved</th><th>Total</th><th>Conversion</th><th title="Approved ÷ active agents">Target %</th><th>Day-Offs</th>
        </tr></thead>
        <tbody>${summaries.map((t) => `<tr>
          <td><strong>${escapeHtml(t.team)}</strong></td>
          <td>${t.activeAgentsCount ?? t.agentsCount}</td>
          <td>${cellVal(t.approved)}</td>
          <td>${t.total ?? 0}</td>
          <td>${escapeHtml(t.conversion || "")}</td>
          <td>${escapeHtml(t.targetPercentage || "")}</td>
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
    const openModal = helpers.openModal;
    const closeModal = helpers.closeModal;
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

    const canShare = state.user?.canGrantSalesVisibility === true;
    const shareBtn = canShare ? `<button class="btn" id="td-share-24h" style="margin-left:auto">Share 24h</button>` : "";

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
          ${shareBtn}
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
          ${shareBtn}
        </div>`;

    const body = period === "week"
      ? (data.days || []).map((d) => renderDayBlock(d, escapeHtml)).join("")
      : renderDayBlock(data, escapeHtml);

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Team dashboards</h1>
          <p class="muted">${headerLabel} · Separate tables per team · Day-OFF shown as (DAY-OFF)</p>
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

    root.querySelector("#td-share-24h")?.addEventListener("click", async () => {
      const unit = state.user?.unit || "";
      const employees = await api("/employees").catch(() => ({ employees: [] }));
      const empList = employees.employees || [];
      const teams = [...new Set(empList.map((e) => e.team).filter(Boolean))].sort();
      const agents = empList
        .filter((e) => String(e.status || "").toLowerCase() !== "out")
        .sort((a, b) => (a.american_name || "").localeCompare(b.american_name || ""));
      const teamOpts = teams.map((t) => `<option value="team:${escapeHtml(t)}">Team: ${escapeHtml(t)}</option>`).join("");
      const agentOpts = agents.map((a) => `<option value="agent:${escapeHtml(a.id)}">${escapeHtml(a.american_name || a.arabic_name || a.id)} (${escapeHtml(a.id)})</option>`).join("");
      openModal(`
        <div class="modal-header"><h2>Share visibility for 24h</h2><button class="btn btn-sm" data-close>✕</button></div>
        <div class="modal-body field-grid">
          <label class="field"><span>Grantee</span>
            <select id="td-share-grantee">
              <option value="">— Select team or agent —</option>
              <optgroup label="Teams">${teamOpts}</optgroup>
              <optgroup label="Agents">${agentOpts}</optgroup>
            </select>
          </label>
          <label class="field"><span>Scope</span>
            <select id="td-share-scope">
              <option value="unit">Unit (${escapeHtml(unit || "current")})</option>
              <option value="company">Company-wide</option>
            </select>
          </label>
          <div style="grid-column:1/-1;display:flex;gap:.75rem;margin-top:.5rem">
            <button class="btn btn-primary" id="td-share-confirm">Grant 24h access</button>
            <button class="btn" data-close>Cancel</button>
          </div>
          <p class="muted" style="grid-column:1/-1">The grantee will see this unit's sales data for 24 hours.</p>
        </div>`);
      document.getElementById("td-share-confirm").onclick = async () => {
        const raw = document.getElementById("td-share-grantee")?.value || "";
        if (!raw) return alert("Select a team or agent.");
        let granteeUsername = raw;
        let scopeType = document.getElementById("td-share-scope")?.value || "unit";
        if (raw.startsWith("team:")) {
          granteeUsername = raw.slice(5);
          scopeType = "team";
        } else if (raw.startsWith("agent:")) {
          granteeUsername = raw.slice(6);
          scopeType = scopeType === "company" ? "company" : "unit";
        }
        try {
          await api("/sales/visibility-grants", {
            method: "POST",
            body: JSON.stringify({
              granteeUsername,
              scopeType,
              scopeValue: scopeType === "team" ? granteeUsername : (scopeType === "unit" ? unit : ""),
              temporaryHours: 24,
            }),
          });
          closeModal();
          alert(`Shared unit view with "${granteeUsername}" for 24 hours.`);
        } catch (e) {
          alert(e.message);
        }
      };
    });
  }

  return { renderTeamDashboardPage };
})();
