(function () {
  "use strict";

  // ─── Constants ───────────────────────────────────────────────────────────────

  const STATUS_LABELS = {
    pending:     "Pending",
    approved:    "Approved",
    rejected:    "Rejected",
    rescheduled: "Rescheduled",
  };

  const STATUS_BADGE = {
    pending:     "badge badge-warn",
    approved:    "badge badge-ok",
    rejected:    "badge badge-out",
    rescheduled: "badge badge-status",
  };

  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // ─── Participant helpers ──────────────────────────────────────────────────────

  function parseParticipant(p) {
    const s = String(p || "");
    if (s.startsWith("employee:")) return { type: "employee", value: s.slice(9) };
    if (s.startsWith("team:")) {
      const [u, t] = s.slice(5).split("|");
      return { type: "team", unit: u || "", team: t || "" };
    }
    if (s.startsWith("unit:")) return { type: "unit", value: s.slice(5) };
    return { type: "employee", value: s };
  }

  function participantLabel(p, empName) {
    const parsed = parseParticipant(p);
    if (parsed.type === "unit") return `🏢 Whole unit: ${parsed.value}`;
    if (parsed.type === "team") return `👥 Team: ${[parsed.unit, parsed.team].filter(Boolean).join(" › ")}`;
    return empName(parsed.value);
  }

  function buildParticipantOptions(role, leadTeams, employees, orgTeams) {
    const isHrAdmin = ["hr", "admin", "ceo"].includes(role);
    const isOp      = role === "op";
    const isTl      = role === "tl";
    const myUnit    = state.user?.unit || "";

    let visibleEmps = employees;
    if (isTl) {
      const myTeams = new Set((leadTeams || []).map((lt) => lt.team));
      visibleEmps = employees.filter((e) => myTeams.has(e.team));
    } else if (isOp && myUnit) {
      visibleEmps = employees.filter((e) => e.unit === myUnit);
    }

    let visibleTeams = orgTeams || [];
    if (isTl) {
      const allowed = new Set((leadTeams || []).map((lt) => `${lt.unit}|${lt.name}`));
      visibleTeams = visibleTeams.filter((t) => allowed.has(`${t.unit}|${t.name}`));
    } else if (isOp && myUnit) {
      visibleTeams = visibleTeams.filter((t) => t.unit === myUnit);
    }

    const units = (isOp || isHrAdmin)
      ? [...new Set((isOp ? [myUnit] : employees.map((e) => e.unit)).filter(Boolean))]
      : [];

    return {
      employees: visibleEmps.map((e) => ({
        value: `employee:${e.id}`,
        label: e.american_name || e.arabic_name || e.id,
        sub:   e.id,
      })),
      teams: visibleTeams.map((t) => ({
        value: `team:${t.unit}|${t.name}`,
        label: `${t.name}`,
        sub:   t.unit,
      })),
      units: units.map((u) => ({
        value: `unit:${u}`,
        label: u,
        sub:   "",
      })),
    };
  }

  // ─── Page renderer ────────────────────────────────────────────────────────────

  async function renderMeetingRequestsPage(root) {
    const canReview = state.user?.canReviewMeetingRequest === true;
    const canSubmit = state.user?.canSubmitMeetingRequest === true;
    const role      = state.user?.role || "";
    const leadTeams = state.user?.leadTeams || [];

    const statusFilter = new URLSearchParams(window.location.search).get("status") || "";
    const qs = statusFilter ? `?status=${statusFilter}` : "";

    const [data, empData, teamsData] = await Promise.all([
      api(`/meeting-requests${qs}`).catch(() => ({ requests: [] })),
      api("/employees").catch(() => ({ employees: [] })),
      api("/hrms/teams").catch(() => ({ teams: [] })),
    ]);
    const requests  = data.requests || [];
    const employees = empData.employees || [];
    const orgTeams  = teamsData.teams || [];

    const empMap = new Map(employees.map((e) => [e.id, e]));
    function empName(id) {
      const e = empMap.get(id);
      return e ? (e.american_name || e.arabic_name || e.id) : (id || "—");
    }

    const statusTabs = ["", "pending", "approved", "rejected", "rescheduled"]
      .map((s) => `<button class="rules-tab${s === statusFilter ? " active" : ""}" data-mr-status="${s}">${s ? STATUS_LABELS[s] : "All"}</button>`)
      .join("");

    root.innerHTML = `
      <style>
        .mr-tabs{display:flex;gap:.25rem;margin-bottom:1rem;flex-wrap:wrap}
        .mr-grid{display:grid;grid-template-columns:1fr;gap:1rem}
        @media(min-width:680px){.mr-grid{grid-template-columns:1fr 1fr}}
        @media(min-width:1100px){.mr-grid{grid-template-columns:1fr 1fr 1fr}}
        .mr-card{border:1px solid var(--border,#ddd);border-radius:8px;padding:1rem;display:flex;flex-direction:column;gap:.5rem}
        .mr-card-header{display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem}
        .mr-card-title{font-weight:700;font-size:1rem;margin:0}
        .mr-card-meta{font-size:.8rem;color:var(--text-muted,#888)}
        .mr-card-body{font-size:.9rem}
        .mr-card-actions{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:auto;padding-top:.5rem;border-top:1px solid var(--border,#eee)}
        .mr-participants{font-size:.85rem}
        .mr-participants ul{list-style:none;padding:0;margin:.3rem 0 0;display:flex;flex-direction:column;gap:.15rem}
        .mr-participants li{display:flex;align-items:center;gap:.35rem}
        .mr-pcount{font-size:.75rem;color:var(--text-muted,#888)}
      </style>
      <div class="page-header flex-between">
        <div>
          <h1>Meeting Requests</h1>
          <p class="muted" style="margin:0">Schedule meetings with your team, unit, or specific employees</p>
        </div>
        ${canSubmit ? '<button class="btn btn-primary" id="mr-new-btn">+ New Request</button>' : ""}
      </div>
      <div class="mr-tabs">${statusTabs}</div>
      ${requests.length === 0
        ? `<div class="card" style="text-align:center;padding:2rem"><p class="muted">No meeting requests${statusFilter ? ` with status "${STATUS_LABELS[statusFilter] || statusFilter}"` : ""}.</p></div>`
        : `<div class="mr-grid">${requests.map((r) => renderCard(r, { canReview, empName })).join("")}</div>`}
    `;

    root.querySelectorAll("[data-mr-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = btn.dataset.mrStatus;
        window.history.pushState({}, "", s ? `?page=meeting-requests&status=${s}` : "?page=meeting-requests");
        renderMeetingRequestsPage(root);
      });
    });

    root.querySelector("#mr-new-btn")?.addEventListener("click", () =>
      openNewMrModal(root, { role, leadTeams, employees, orgTeams, empName })
    );

    root.querySelectorAll("[data-mr-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Approve this meeting request?")) return;
        try {
          await api(`/meeting-requests/${btn.dataset.mrApprove}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "approved" }),
          });
          renderMeetingRequestsPage(root);
        } catch (e) { alert(e.message); }
      });
    });

    root.querySelectorAll("[data-mr-reject]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const notes = prompt("Rejection reason (optional):");
        try {
          await api(`/meeting-requests/${btn.dataset.mrReject}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "rejected", reviewNotes: notes || "" }),
          });
          renderMeetingRequestsPage(root);
        } catch (e) { alert(e.message); }
      });
    });
  }

  function renderCard(r, { canReview, empName }) {
    const dateStr = r.proposedDate
      ? new Date(r.proposedDate + "T" + (r.proposedTime || "00:00")).toLocaleString([], {
          weekday: "short", month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit",
        })
      : "—";

    const participants = r.participants || [];
    const shown  = participants.slice(0, 5);
    const extra  = participants.length - shown.length;
    const pItems = shown
      .map((p) => `<li>${esc(participantLabel(p, empName))}</li>`)
      .join("");

    const actions = canReview && r.status === "pending"
      ? `<button class="btn btn-sm btn-primary" data-mr-approve="${r.id}">Approve</button>
         <button class="btn btn-sm btn-danger"   data-mr-reject="${r.id}">Reject</button>`
      : "";

    return `<div class="mr-card">
      <div class="mr-card-header">
        <div class="mr-card-title">${esc(r.title)}</div>
        <span class="${STATUS_BADGE[r.status] || "badge"}">${STATUS_LABELS[r.status] || r.status}</span>
      </div>
      <div class="mr-card-meta">
        📅 ${esc(dateStr)} &middot; ⏱ ${r.durationMinutes || 30} min
      </div>
      <div class="mr-card-meta">
        By <strong>${esc(empName(r.requesterEmployeeId))}</strong>
      </div>
      ${r.description ? `<div class="mr-card-body">${esc(r.description)}</div>` : ""}
      ${participants.length ? `
        <div class="mr-participants">
          <strong>Participants</strong>
          <span class="mr-pcount">(${participants.length})</span>
          <ul>${pItems}${extra > 0 ? `<li class="muted">+${extra} more</li>` : ""}</ul>
        </div>` : ""}
      ${r.reviewNotes ? `<div class="mr-card-meta">📝 ${esc(r.reviewNotes)}</div>` : ""}
      ${actions ? `<div class="mr-card-actions">${actions}</div>` : ""}
    </div>`;
  }

  // ─── New meeting request modal ────────────────────────────────────────────────

  function openNewMrModal(root, { role, leadTeams, employees, orgTeams, empName }) {
    const myId  = state.user?.employeeId || "";
    const opts  = buildParticipantOptions(role, leadTeams, employees, orgTeams);
    const total = opts.employees.length + opts.teams.length + opts.units.length;

    // ── Styles injected once ──────────────────────────────────────────────────
    const styles = `
      <style id="mr-modal-styles">
        .mr-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
        @media(max-width:600px){.mr-modal-grid{grid-template-columns:1fr}}
        .mr-modal-full{grid-column:1/-1}
        .mr-picker-wrap{
          border:1px solid var(--border,#ddd);
          border-radius:6px;
          overflow:hidden;
          display:flex;
          flex-direction:column;
          height:340px;
        }
        .mr-picker-toolbar{
          display:flex;
          align-items:center;
          gap:.5rem;
          padding:.5rem .75rem;
          border-bottom:1px solid var(--border,#eee);
          background:var(--surface2,#f8f8f8);
        }
        .mr-picker-search{
          flex:1;
          padding:.35rem .6rem;
          font-size:.85rem;
          border:1px solid var(--border,#ddd);
          border-radius:4px;
        }
        .mr-picker-count{
          font-size:.8rem;
          color:var(--text-muted,#888);
          white-space:nowrap;
        }
        .mr-picker-body{
          overflow-y:auto;
          flex:1;
          padding:.25rem 0;
        }
        .mr-section-head{
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding:.4rem .75rem .2rem;
          font-size:.75rem;
          font-weight:700;
          text-transform:uppercase;
          color:var(--text-muted,#888);
          letter-spacing:.04em;
          user-select:none;
        }
        .mr-select-all{
          font-size:.72rem;
          color:var(--primary,#2563eb);
          cursor:pointer;
          background:none;
          border:none;
          padding:0 .25rem;
          text-decoration:underline;
        }
        .mr-select-all:hover{opacity:.75}
        .mr-pick-item{
          display:flex;
          align-items:center;
          gap:.6rem;
          padding:.35rem .75rem;
          cursor:pointer;
          transition:background .1s;
        }
        .mr-pick-item:hover{background:var(--surface2,#f5f5f5)}
        .mr-pick-item input[type="checkbox"]{
          width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--primary,#2563eb);
        }
        .mr-pick-label{flex:1;font-size:.9rem;line-height:1.3}
        .mr-pick-sub{font-size:.75rem;color:var(--text-muted,#888)}
        .mr-pick-item.hidden{display:none}
        .mr-no-results{padding:.75rem;text-align:center;color:var(--text-muted,#888);font-size:.85rem}
      </style>`;

    // ── Build picker items for one section ───────────────────────────────────
    function pickerSection(title, items, groupClass) {
      if (!items.length) return "";
      const rows = items.map((it) => `
        <label class="mr-pick-item" data-pick-group="${groupClass}">
          <input type="checkbox" name="participant" value="${esc(it.value)}" />
          <span class="mr-pick-label">
            ${esc(it.label)}
            ${it.sub ? `<span class="mr-pick-sub">${esc(it.sub)}</span>` : ""}
          </span>
        </label>`).join("");
      return `
        <div class="mr-section-head">
          <span>${title} (${items.length})</span>
          <button type="button" class="mr-select-all" data-select-all="${groupClass}">Select all</button>
        </div>
        ${rows}`;
    }

    const pickerContent = [
      pickerSection("Employees", opts.employees, "emp"),
      pickerSection("Teams",     opts.teams,     "team"),
      pickerSection("Units",     opts.units,     "unit"),
    ].join("") || `<div class="mr-no-results">No participants available for your role.</div>`;

    const html = `
      ${styles}
      <div class="modal-header">
        <h2>New Meeting Request</h2>
        <button class="btn btn-sm" data-close>✕</button>
      </div>
      <div class="modal-body" style="overflow-y:auto;max-height:72vh;padding:1rem 1.25rem">
        <div class="mr-modal-grid">
          <label class="field mr-modal-full">
            <span>Title <span style="color:var(--danger,#c00)">*</span></span>
            <input id="mr-title" name="title" required placeholder="e.g. Weekly team check-in" />
          </label>
          <label class="field mr-modal-full">
            <span>Description <span class="muted">(optional)</span></span>
            <textarea id="mr-desc" name="description" rows="2" placeholder="Agenda or context…"></textarea>
          </label>
          <label class="field">
            <span>Date <span style="color:var(--danger,#c00)">*</span></span>
            <input id="mr-date" name="proposedDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required />
          </label>
          <label class="field">
            <span>Time <span style="color:var(--danger,#c00)">*</span></span>
            <input id="mr-time" name="proposedTime" type="time" value="10:00" required />
          </label>
          <label class="field">
            <span>Duration (minutes)</span>
            <input id="mr-duration" name="durationMinutes" type="number" value="30" min="5" max="480" />
          </label>
          <div class="field mr-modal-full">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
              <span style="font-weight:600">
                Participants
                <span class="muted" style="font-weight:400;font-size:.85rem"> — choose employees, teams, or units</span>
              </span>
              <span id="mr-sel-count" class="mr-picker-count"></span>
            </div>
            <div class="mr-picker-wrap">
              <div class="mr-picker-toolbar">
                <input class="mr-picker-search" id="mr-search" type="text" placeholder="Search by name, team, or unit…" autocomplete="off" />
                <button type="button" class="btn btn-sm" id="mr-clear-all">Clear all</button>
              </div>
              <div class="mr-picker-body" id="mr-picker-body">
                ${pickerContent}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="mr-submit-btn">Submit request</button>
      </div>`;

    window.openModal(html);

    const pickerBody   = document.getElementById("mr-picker-body");
    const searchInput  = document.getElementById("mr-search");
    const selCountEl   = document.getElementById("mr-sel-count");

    // ── Count selected ────────────────────────────────────────────────────────
    function updateCount() {
      const n = pickerBody.querySelectorAll('input[name="participant"]:checked').length;
      if (selCountEl) selCountEl.textContent = n ? `${n} selected` : `${total} available`;
    }
    updateCount();
    pickerBody.addEventListener("change", updateCount);

    // ── Live search ───────────────────────────────────────────────────────────
    searchInput?.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase().trim();
      let anyVisible = false;
      pickerBody.querySelectorAll(".mr-pick-item").forEach((el) => {
        const text = el.textContent.toLowerCase();
        const show = !q || text.includes(q);
        el.classList.toggle("hidden", !show);
        if (show) anyVisible = true;
      });
      // Show/hide section headers based on whether any items in group are visible
      pickerBody.querySelectorAll(".mr-section-head").forEach((head) => {
        const grp = head.querySelector("[data-select-all]")?.dataset.selectAll;
        if (!grp) return;
        const hasVisible = [...pickerBody.querySelectorAll(`[data-pick-group="${grp}"]`)]
          .some((el) => !el.classList.contains("hidden"));
        head.style.display = hasVisible ? "" : "none";
      });
      // No results message
      let noRes = pickerBody.querySelector(".mr-no-results-dyn");
      if (!anyVisible && q) {
        if (!noRes) {
          noRes = document.createElement("div");
          noRes.className = "mr-no-results mr-no-results-dyn";
          pickerBody.appendChild(noRes);
        }
        noRes.textContent = `No results for "${searchInput.value}"`;
      } else if (noRes) {
        noRes.remove();
      }
    });

    // ── Select all per group ──────────────────────────────────────────────────
    pickerBody.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-select-all]");
      if (!btn) return;
      const grp    = btn.dataset.selectAll;
      const items  = pickerBody.querySelectorAll(`[data-pick-group="${grp}"] input[type="checkbox"]`);
      const allChk = [...items].every((cb) => cb.checked);
      items.forEach((cb) => { cb.checked = !allChk; });
      // Update button label
      btn.textContent = allChk ? "Select all" : "Clear";
      updateCount();
    });

    // ── Clear all ─────────────────────────────────────────────────────────────
    document.getElementById("mr-clear-all")?.addEventListener("click", () => {
      pickerBody.querySelectorAll('input[name="participant"]').forEach((cb) => { cb.checked = false; });
      pickerBody.querySelectorAll("[data-select-all]").forEach((b) => { b.textContent = "Select all"; });
      updateCount();
    });

    // ── Submit ────────────────────────────────────────────────────────────────
    document.getElementById("mr-submit-btn").onclick = async () => {
      const title    = document.getElementById("mr-title")?.value.trim();
      const desc     = document.getElementById("mr-desc")?.value.trim();
      const date     = document.getElementById("mr-date")?.value;
      const time     = document.getElementById("mr-time")?.value;
      const duration = Number(document.getElementById("mr-duration")?.value) || 30;

      const participants = [...pickerBody.querySelectorAll('input[name="participant"]:checked')]
        .map((el) => el.value);

      if (!title)            return alert("Title is required.");
      if (!date || !time)    return alert("Date and time are required.");
      if (!myId)             return alert("Your employee ID is not set. Contact an admin.");
      if (!participants.length) return alert("Please select at least one participant, team, or unit.");

      const body = {
        title,
        description:         desc || "",
        proposedDate:        date,
        proposedTime:        time,
        durationMinutes:     duration,
        requesterEmployeeId: myId,
        requesterRole:       role,
        participants,
      };

      try {
        await api("/meeting-requests", { method: "POST", body: JSON.stringify(body) });
        window.closeModal();
        renderMeetingRequestsPage(root);
      } catch (e) { alert(e.message); }
    };
  }

  window.MeetingRequestsModule = { renderMeetingRequestsPage };
})();
