window.AnalyticsModule = (function () {
  let escapeHtml = (s) => String(s || "");

  function fmt(n) {
    if (n == null) return "—";
    return Number(n).toLocaleString("en-EG");
  }

  function buildApiQuery(state, params = {}) {
    const q = new URLSearchParams();
    if (state?.month) q.set("month", state.month);
    if (state?.companyContext === "hs2") q.set("company", "hs2");
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") q.set(k, String(v));
    }
    return q.toString() ? `?${q.toString()}` : "";
  }

  function simpleBar(label, val, max, colorVar = "var(--chart-fill)") {
    const pct = max > 0 ? Math.round((val / max) * 100) : 0;
    return `<div class="bar-row">
      <div class="bar-label">${escapeHtml(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colorVar}"></div></div>
      <div class="bar-value">${fmt(val)}</div>
    </div>`;
  }

  function statusBar(label, passed, pending, postdated, denied) {
    const total = (passed || 0) + (pending || 0) + (postdated || 0) + (denied || 0);
    if (total === 0) return "";
    const pPct = total > 0 ? Math.round((passed / total) * 100) : 0;
    const penPct = total > 0 ? Math.round((pending / total) * 100) : 0;
    const postPct = total > 0 ? Math.round((postdated / total) * 100) : 0;
    const dPct = total > 0 ? Math.round((denied / total) * 100) : 0;
    return `<div class="bar-row" style="flex-direction:column;align-items:stretch">
      <div style="font-size:.85rem;margin-bottom:.2rem">${escapeHtml(label)} <span class="muted">(${total})</span></div>
      <div class="bar-track" style="display:flex;height:.75rem">
        <div class="bar-fill" style="width:${pPct}%;background:var(--chart-passed)" title="Passed: ${passed}"></div>
        <div class="bar-fill" style="width:${penPct}%;background:var(--chart-pending)" title="Pending: ${pending}"></div>
        <div class="bar-fill" style="width:${postPct}%;background:var(--chart-postdated)" title="Postdated: ${postdated}"></div>
        <div class="bar-fill" style="width:${dPct}%;background:var(--chart-denied)" title="Dropped: ${denied}"></div>
      </div>
      <div style="display:flex;gap:.5rem;font-size:.75rem;margin-top:.2rem;flex-wrap:wrap">
        <span style="color:var(--chart-passed)">Passed ${passed}</span>
        <span style="color:var(--chart-pending)">Pending ${pending}</span>
        <span style="color:var(--chart-postdated)">Postdated ${postdated}</span>
        <span style="color:var(--chart-denied)">Dropped ${denied}</span>
      </div>
    </div>`;
  }

  function widgetScope(label) {
    return `<span class="widget-scope">${escapeHtml(label)}</span>`;
  }

  function phasePipeline(phases) {
    const entries = Object.entries(phases || {});
    if (!entries.length) return '<p class="muted">No active training phases</p>';
    const max = Math.max(...entries.map(([, v]) => v), 1);
    return `<div class="phase-pipeline">${entries.map(([phase, count]) =>
      simpleBar(`Phase ${phase}`, count, max, "var(--primary)")
    ).join("")}</div>`;
  }

  async function renderAnalyticsPage(root, api, state, helpers) {
    escapeHtml = helpers.escapeHtml || escapeHtml;
    const month = state.month;
    const data = await api(`/reports/analytics${buildApiQuery(state)}`);
    const req = data.requests || {};
    const fin = data.financials || {};
    const att = data.attendance || {};
    const train = data.training || {};
    const sales = data.sales || {};
    const equip = data.equipment || {};
    const audit = data.hrAudit || {};
    const companyLabel = data.company === "hs2" ? "HS-2" : "Hangup";

    const leaveRows = Object.entries(req.leave?.byStatus || {}).map(([s, c]) =>
      simpleBar(s, c, Math.max(req.leave?.total || 1, 1), "var(--chart-fill)")
    ).join("");
    const expenseCategoryRows = Object.entries(fin.expensesByCategory || {}).map(([cat, amt]) =>
      simpleBar(cat.replace(/_/g, " "), amt, Math.max(...Object.values(fin.expensesByCategory || { x: 1 }), 1), "var(--warn)")
    ).join("");
    const paidByRows = Object.entries(fin.expensesByPaidBy || {})
      .filter(([, amt]) => Number(amt) > 0)
      .map(([label, amt]) =>
        simpleBar(
          label,
          amt,
          Math.max(...Object.values(fin.expensesByPaidBy || { x: 1 }), 1),
          label === "Main Fund" ? "var(--chart-fill)" : "var(--chart-passed)"
        )
      )
      .join("");
    const salesByTeamRows = (sales.byTeam || []).map((s) =>
      simpleBar(s.team, s.avgPerAgent, Math.max(...(sales.byTeam || []).map((x) => x.avgPerAgent), 1), "var(--chart-passed)")
    ).join("");
    const closersRows = (sales.closersByUnit || []).map((s) =>
      simpleBar(s.unit, s.average, Math.max(...(sales.closersByUnit || []).map((x) => x.average), 1), "var(--chart-fill)")
    ).join("");
    const agentsRows = (sales.agentsByTeam || []).map((s) =>
      simpleBar(s.team, s.average, Math.max(...(sales.agentsByTeam || []).map((x) => x.average), 1), "var(--chart-passed)")
    ).join("");
    const avgByTeamRows = (sales.averagesByTeam || []).map((s) =>
      simpleBar(`${s.team} (${s.agentCount} agents)`, s.avgPerAgent, Math.max(...(sales.averagesByTeam || []).map((x) => x.avgPerAgent), 1), "var(--warn)")
    ).join("");
    const avgByTeamPerDayRows = (sales.averagesByTeamPerDay || []).map((s) =>
      simpleBar(`${s.team} (${s.agentCount} agents)`, s.avgPerAgentPerDay, Math.max(...(sales.averagesByTeamPerDay || []).map((x) => x.avgPerAgentPerDay), 1), "var(--warn)")
    ).join("");
    const equipRows = Object.entries(equip).map(([k, v]) =>
      simpleBar(k, v, Math.max(...Object.values(equip), 1), "var(--warn)")
    ).join("");
    const auditRows = Object.keys(audit).length
      ? `<table><thead><tr><th>User</th><th>Edits</th></tr></thead><tbody>${Object.entries(audit).map(([u, c]) => `<tr><td>${escapeHtml(u)}</td><td>${fmt(c)}</td></tr>`).join("")}</tbody></table>`
      : '<p class="muted">No audit entries this month</p>';
    const bonusesByTeamRows = (fin.bonuses || []).map((b) =>
      simpleBar(b.team, b.total, Math.max(...(fin.bonuses || []).map((x) => x.total), 1), "var(--chart-passed)")
    ).join("");
    const deductionsByTeamRows = (fin.deductions || []).map((d) =>
      simpleBar(d.team, d.total, Math.max(...(fin.deductions || []).map((x) => x.total), 1), "var(--chart-denied)")
    ).join("");
    const salesStatusRows = (sales.statusByTeam || []).map((s) =>
      statusBar(s.team, s.passed, s.pending, s.postdated, s.denied)
    ).join("");

    root.innerHTML = `
      <div class="page-header"><div><h1>Reporting & Analytics</h1><p class="muted">${month} ${widgetScope(companyLabel)}</p></div></div>
      <div class="grid-4" style="margin-bottom:1rem">
        <div class="card card-stat"><strong>${fmt(req.leave?.total || 0)}</strong><span class="muted">Leave requests</span></div>
        <div class="card card-stat"><strong>${fmt(req.it?.total || 0)}</strong><span class="muted">IT requests (${req.it?.ratio || 0}% resolved)</span></div>
        <div class="card card-stat"><strong>${fmt(att.overall || att.average || 0)}%</strong><span class="muted">Avg attendance ${widgetScope(data.agentsMonth || month)}</span></div>
        <div class="card card-stat"><strong>${fmt(fin.companyCosts || 0)}</strong><span class="muted">Company costs (EGP)</span></div>
      </div>
      <div class="grid-2" style="margin-bottom:1rem">
        <div class="card">
          <h3>Leave requests by status ${widgetScope(companyLabel)}</h3>
          ${leaveRows || '<p class="muted">No leave data</p>'}
        </div>
        <div class="card">
          <h3>Financials — Company costs ${widgetScope(companyLabel)}</h3>
          <div class="payslip-row"><span>Company costs (paid)</span><strong>${fmt(fin.companyCosts || 0)} EGP</strong></div>
          <div class="payslip-row"><span>Paid receipts</span><span>${fmt(fin.expenseTotal || 0)} EGP (${fmt(fin.paidCount || 0)})</span></div>
          <div class="payslip-row"><span>Pending receipts</span><span>${fmt(fin.pendingTotal || 0)} EGP (${fmt(fin.pendingCount || 0)})</span></div>
          <div class="payslip-row"><span>Monthly bills</span><span>${fmt(fin.billsTotal || 0)} EGP</span></div>
          <div style="margin-top:.75rem">
            <strong class="muted" style="font-size:.85rem">Paid by</strong>
            ${paidByRows || '<p class="muted">No paid costs</p>'}
          </div>
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:1rem">
        <div class="card">
          <h3>Expenses by category (paid)</h3>
          ${expenseCategoryRows || '<p class="muted">No expense data</p>'}
        </div>
        <div class="card">
          <h3>Bonuses by team ${widgetScope(month)}</h3>
          ${bonusesByTeamRows || '<p class="muted">No bonus data</p>'}
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:1rem">
        <div class="card">
          <h3>Deductions by team ${widgetScope(month)}</h3>
          ${deductionsByTeamRows || '<p class="muted">No deduction data</p>'}
        </div>
        <div class="card">
          <h3>Sales status by team ${widgetScope(data.salesMonth || month)}</h3>
          ${salesStatusRows || '<p class="muted">No sales data</p>'}
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:1rem">
        <div class="card">
          <h3>Equipment by type ${widgetScope(companyLabel)}</h3>
          ${equipRows || '<p class="muted">No equipment data</p>'}
        </div>
        <div class="card">
          <h3>Closers by unit ${widgetScope(data.salesMonth || month)}</h3>
          ${closersRows || '<p class="muted">No closer data</p>'}
          ${sales.topCloser ? `<p class="muted small">Top closer unit: ${escapeHtml(sales.topCloser.unit || "—")} (avg ${fmt(sales.topCloser.average)} EGP)</p>` : ""}
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:1rem">
        <div class="card">
          <h3>Agent sales by team (avg per agent)</h3>
          ${agentsRows || '<p class="muted">No agent sales data</p>'}
          ${sales.topAgent ? `<p class="muted small">Top agent team: ${escapeHtml(sales.topAgent.team || "—")} (avg ${fmt(sales.topAgent.average)} sales/agent)</p>` : ""}
        </div>
        <div class="card">
          <h3>Averages — sales per agent / month</h3>
          ${avgByTeamRows || '<p class="muted">No average data</p>'}
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:1rem">
        <div class="card">
          <h3>Averages — sales per agent / working day ${widgetScope(data.agentsMonth || month)}</h3>
          ${avgByTeamPerDayRows || '<p class="muted">No average data</p>'}
        </div>
        <div class="card">
          <h3>Training pipeline ${widgetScope(companyLabel)}</h3>
          <div class="payslip-row"><span>In training</span><span>${fmt(train.inTraining || 0)}</span></div>
          <div class="payslip-row"><span>Finished</span><span>${fmt(train.finished || 0)}</span></div>
          ${phasePipeline(train.phases)}
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:1rem">
        <div class="card">
          <h3>Attendance & Turnover ${widgetScope(data.agentsMonth || month)}</h3>
          <div class="payslip-row"><span>Average attendance</span><span>${fmt(att.overall || att.average || 0)}%</span></div>
          ${(att.byTeam || []).map((t) => `<div class="payslip-row"><span>${escapeHtml(t.team)}</span><span>${fmt(t.average)}% (${t.present}/${t.days})</span></div>`).join("")}
          <div class="payslip-row" style="margin-top:.5rem"><span>Turnover count</span><span>${fmt(att.turnover?.count || 0)}</span></div>
          <div class="payslip-row"><span>Turnover ratio</span><span>${fmt(att.turnover?.ratio || 0)}%</span></div>
          <div class="payslip-row"><span>New employees</span><span>${fmt(att.newEmployees?.count || 0)}</span></div>
        </div>
        <div class="card">
          <h3>HR Audit — edits this month</h3>
          ${auditRows}
        </div>
      </div>
    `;
  }

  return { renderAnalyticsPage };
})();
