(function () {
  "use strict";

  const STATUS_LABELS = {
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    rescheduled: "Rescheduled",
  };

  const STATUS_BADGE = {
    pending: "badge badge-warn",
    approved: "badge badge-ok",
    rejected: "badge badge-out",
    rescheduled: "badge badge-status",
  };

  function teamScopeOptions() {
    const leadTeams = Array.isArray(state.user?.leadTeams) ? state.user.leadTeams : [];
    return leadTeams.map((lt) => {
      const name = [lt.unit, lt.team].filter(Boolean).join(" / ");
      return {
        label: name || "My team",
        value: `team:${lt.unit || ""}|${lt.team || ""}`,
      };
    });
  }

  function formatParticipantLabel(participant, empName) {
    if (!participant) return "—";
    if (typeof participant === "string" && participant.startsWith("team:")) {
      const [, raw] = participant.split(":");
      const [unit, team] = (raw || "").split("|");
      const parts = [unit, team].filter(Boolean);
      return parts.length ? `Team scope: ${parts.join(" / ")}` : "Team scope";
    }
    return empName(participant);
  }

  async function renderMeetingRequestsPage(root) {
    const canReview = state.user?.canReviewMeetingRequest === true;
    const canSubmit = state.user?.canSubmitMeetingRequest === true;

    const statusFilter = new URLSearchParams(window.location.search).get("status") || "";
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    const data = await api(`/meeting-requests${qs}`).catch(() => ({ requests: [] }));
    const requests = data.requests || [];

    const employees = state.meta?.employees || [];

    function empName(id) {
      const e = employees.find((x) => x.id === id);
      return e ? (e.american_name || e.arabic_name || e.id) : id || "—";
    }

    const statusTabs = ["", "pending", "approved", "rejected", "rescheduled"].map((s) =>
      `<button class="rules-tab${s === statusFilter ? " active" : ""}" data-mr-status="${s}">${s ? STATUS_LABELS[s] : "All"}</button>`
    ).join("");

    const esc = window.escapeHtml || function (s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
    const teamScopes = teamScopeOptions();

    root.innerHTML = `
      <style>
        .mr-grid { display: grid; grid-template-columns: 1fr; gap: 1rem; }
        @media (min-width: 768px) { .mr-grid { grid-template-columns: 1fr 1fr; } }
        .mr-card { border: 1px solid var(--border, #ddd); border-radius: 6px; padding: .75rem; }
        .mr-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: .5rem; flex-wrap: wrap; margin-bottom: .5rem; }
        .mr-card-title { font-weight: 600; margin: 0; }
        .mr-card-meta { font-size: .8rem; color: var(--text-muted, #888); }
        .mr-card-body { margin: .5rem 0; font-size: .9rem; }
        .mr-card-actions { display: flex; gap: .35rem; flex-wrap: wrap; margin-top: .5rem; }
        .mr-team-checkboxes { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .35rem; }
        .mr-team-checkboxes label { display: inline-flex; align-items: center; gap: .25rem; font-size: .9rem; }
      </style>
      <div class="page-header flex-between">
        <h1>Meeting Requests</h1>
        ${canSubmit ? '<button class="btn btn-primary btn-sm" id="mr-new-btn">+ New Request</button>' : ""}
      </div>
      <div style="display:flex;gap:.25rem;margin-bottom:1rem;flex-wrap:wrap">${statusTabs}</div>
      ${requests.length === 0 ? '<p class="muted">No meeting requests found.</p>' : `
      <div class="mr-grid">${requests.map((r) => renderCard(r, { canReview, empName, esc })).join("")}</div>`}
    `;

    root.querySelectorAll("[data-mr-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = btn.dataset.mrStatus;
        const url = s ? `?page=meeting-requests&status=${s}` : "?page=meeting-requests";
        window.history.pushState({}, "", url);
        renderMeetingRequestsPage(root);
      });
    });

    root.querySelector("#mr-new-btn")?.addEventListener("click", () => openNewMrModal(root));
    root.querySelectorAll("[data-mr-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Approve this meeting request?")) return;
        try {
          await api(`/meeting-requests/${btn.dataset.mrApprove}`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) });
          await renderMeetingRequestsPage(root);
        } catch (e) { alert(e.message); }
      });
    });
    root.querySelectorAll("[data-mr-reject]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const notes = prompt("Rejection reason (optional):");
        try {
          await api(`/meeting-requests/${btn.dataset.mrReject}`, { method: "PATCH", body: JSON.stringify({ status: "rejected", reviewNotes: notes || "" }) });
          await renderMeetingRequestsPage(root);
        } catch (e) { alert(e.message); }
      });
    });
  }

  function renderCard(r, { canReview, empName, esc }) {
    const dateStr = r.proposedDate ? new Date(r.proposedDate + "T" + (r.proposedTime || "00:00")).toLocaleString() : "—";
    const participants = (r.participants || []).map((p) => formatParticipantLabel(p, empName)).join(", ") || "None";

    let actions = "";
    if (canReview && r.status === "pending") {
      actions = `<button class="btn btn-sm btn-primary" data-mr-approve="${r.id}">Approve</button>
        <button class="btn btn-sm btn-danger" data-mr-reject="${r.id}">Reject</button>`;
    }

    return `<div class="mr-card">
      <div class="mr-card-header">
        <div>
          <div class="mr-card-title">${esc(r.title)}</div>
          <div class="mr-card-meta">By ${esc(empName(r.requesterEmployeeId))} · ${r.durationMinutes} min</div>
        </div>
        <span class="${STATUS_BADGE[r.status] || "badge"}">${STATUS_LABELS[r.status] || r.status}</span>
      </div>
      ${r.description ? `<div class="mr-card-body">${esc(r.description)}</div>` : ""}
      <div class="mr-card-meta">
        Proposed: ${esc(dateStr)}<br>
        Participants: ${esc(participants)}
        ${r.reviewNotes ? `<br>Review: ${esc(r.reviewNotes)}` : ""}
      </div>
      ${actions ? `<div class="mr-card-actions">${actions}</div>` : ""}
    </div>`;
  }

  function openNewMrModal(root) {
    const esc = window.escapeHtml || function (s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
    const myId = state.user?.employeeId || "";
    const myRole = state.user?.role || "";

    const teamScopes = teamScopeOptions();
    const teamScopeHtml = teamScopes.length ? `<div class="field" style="grid-column:1/-1"><span>Team scope</span><div class="mr-team-checkboxes">${teamScopes.map((t) => `<label><input type="checkbox" name="teamScope" value="${esc(t.value)}" /> ${esc(t.label)}</label>`).join("")}</div></div>` : "";

    const html = `<div class="modal-header"><h2>New Meeting Request</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="mr-new-form" class="modal-body field-grid">
        <label class="field"><span>Title</span><input name="title" required /></label>
        <label class="field"><span>Description (optional)</span><textarea name="description" rows="2"></textarea></label>
        <label class="field"><span>Date</span><input name="proposedDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
        <label class="field"><span>Time</span><input name="proposedTime" type="time" value="10:00" required /></label>
        <label class="field"><span>Duration (minutes)</span><input name="durationMinutes" type="number" value="30" min="5" /></label>
        <label class="field"><span>Employee ID</span><input name="requesterEmployeeId" value="${esc(myId)}" required /></label>
        ${teamScopeHtml}
        <input name="requesterRole" type="hidden" value="${esc(myRole)}" />
      </form>
      <div class="modal-footer">
        <button class="btn" data-close type="button">Cancel</button>
        <button class="btn btn-primary" id="mr-submit-btn" type="submit">Submit</button>
      </div>`;

    window.openModal(html);
    const form = document.getElementById("mr-new-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const selectedTeamScopes = Array.from(form.querySelectorAll('input[name="teamScope"]:checked')).map((el) => el.value);
      const body = {
        title: String(fd.get("title") || "").trim(),
        description: String(fd.get("description") || "").trim(),
        proposedDate: fd.get("proposedDate"),
        proposedTime: fd.get("proposedTime"),
        durationMinutes: Number(fd.get("durationMinutes")) || 30,
        requesterEmployeeId: String(fd.get("requesterEmployeeId") || "").trim(),
        requesterRole: String(fd.get("requesterRole") || ""),
        participants: selectedTeamScopes,
      };
      if (!body.title || !body.proposedDate || !body.proposedTime || !body.requesterEmployeeId) {
        return alert("Title, date, time, and employee ID are required");
      }
      if (teamScopes.length && !selectedTeamScopes.length) {
        return alert("Please select at least one team scope for this request.");
      }
      try {
        await api("/meeting-requests", { method: "POST", body: JSON.stringify(body) });
        window.closeModal();
        renderMeetingRequestsPage(root);
      } catch (e) { alert(e.message); }
    };
    document.getElementById("mr-submit-btn").onclick = (e) => {
      e.preventDefault();
      form.requestSubmit();
    };
  }

  window.MeetingRequestsModule = { renderMeetingRequestsPage };
})();
