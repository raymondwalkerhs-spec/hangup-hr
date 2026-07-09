(function () {
  "use strict";

  const IT_CATEGORIES = {
    hardware: "Hardware",
    software: "Software",
    network: "Network / Connectivity",
    account: "Account / Access",
    equipment: "Equipment",
    other: "Other",
  };

  const URGENCY_LABELS = {
    low: "Low",
    normal: "Normal",
    high: "High",
    critical: "Critical",
  };

  const URGENCY_BADGE = {
    low: "badge",
    normal: "badge badge-status",
    high: "badge badge-warn",
    critical: "badge badge-out",
  };

  const STATUS_LABELS = {
    open: "Open",
    in_progress: "In Progress",
    resolved: "Resolved",
    closed: "Closed",
  };

  const STATUS_BADGE = {
    open: "badge badge-warn",
    in_progress: "badge badge-ok",
    resolved: "badge badge-status",
    closed: "badge badge-out",
  };

  const esc = (s) =>
    String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  async function renderItRequestsPage(root) {
    const canAssign   = state.user?.canAssignItRequest   === true;
    const canApprove  = state.user?.canApproveItRequest  === true;
    const canResolve  = state.user?.canResolveItRequest  === true;
    const canSubmit   = state.user?.canSubmitItRequest   === true;
    const canDelete   = state.user?.canDeleteItRequest   === true;
    const myEmpId     = state.user?.employeeId || "";

    const statusFilter = new URLSearchParams(window.location.search).get("status") || "";
    const qs = statusFilter ? `?status=${statusFilter}` : "";

    // Fetch IT users for assign/reassign (no unit filter — all active IT staff)
    const [data, itUsersData] = await Promise.all([
      api(`/it-requests${qs}`).catch(() => ({ requests: [] })),
      canAssign ? api("/it-requests/it-users").catch(() => ({ itUsers: [] })) : Promise.resolve({ itUsers: [] }),
    ]);
    const requests = data.requests || [];
    const itUsers  = itUsersData.itUsers || [];

    // Load employees for display (american name, team)
    let employees = [];
    try { const empResp = await api('/employees').catch(() => ({})); employees = empResp.employees || []; } catch (e) { employees = []; }
    const empById = new Map((employees || []).map(e => [e.id, e]));

    const statusTabs = ["", "open", "in_progress", "resolved", "closed"]
      .map((s) => `<button class="rules-tab${s === statusFilter ? " active" : ""}" data-it-status="${s}">${s ? STATUS_LABELS[s] : "All"}</button>`)
      .join("");

    root.innerHTML = `
      <style>
        .it-requests-tabs{display:flex;gap:.25rem;margin-bottom:1rem;flex-wrap:wrap}
        .it-grid{display:grid;grid-template-columns:1fr;gap:1rem}
        @media(min-width:768px){.it-grid{grid-template-columns:1fr 1fr}}
        .it-card{border:1px solid var(--border,#ddd);border-radius:6px;padding:.75rem}
        .it-card-header{display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem}
        .it-card-title{font-weight:600;margin:0}
        .it-card-meta{font-size:.8rem;color:var(--text-muted,#888)}
        .it-card-body{margin:.5rem 0;font-size:.9rem}
        .it-card-actions{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.5rem;align-items:center}
        .it-denial-reason{font-size:.85rem;color:var(--danger,#c00);margin-top:.25rem}
        .it-badge-routing{display:flex;gap:.25rem;flex-wrap:wrap;margin-top:.25rem}
      </style>
      <div class="page-header flex-between">
        <h1>IT Requests</h1>
        ${canSubmit ? '<button class="btn btn-primary btn-sm" id="it-new-request-btn">+ New Request</button>' : ""}
      </div>
      <div class="it-requests-tabs">${statusTabs}</div>
      ${requests.length === 0
        ? '<p class="muted">No IT requests found.</p>'
        : `<div class="it-grid">${requests.map((r) => renderItCard(r, { canAssign, canApprove, canResolve, canDelete, myEmpId, itUsers, empById })).join("")}</div>`}
    `;

    root.querySelectorAll("[data-it-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = btn.dataset.itStatus;
        window.history.pushState({}, "", s ? `?page=it-requests&status=${s}` : "?page=it-requests");
        renderItRequestsPage(root);
      });
    });

    root.querySelector("#it-new-request-btn")?.addEventListener("click", () =>
      openNewItRequestModal(root, myEmpId)
    );

    // Assign / Reassign — modal-based (both open the same picker)
    root.querySelectorAll("[data-it-assign]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id          = btn.dataset.itAssign;
        const currentUser = btn.dataset.itCurrentAssign || "";
        openAssignModal(id, currentUser, itUsers, () => renderItRequestsPage(root));
      });
    });

      // Edit ticket
      root.querySelectorAll('[data-it-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.itEdit;
          openEditModal(id, () => renderItRequestsPage(root));
        });
      });

      // Delete ticket
      root.querySelectorAll('[data-it-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Permanently delete this ticket?')) return;
          try {
            await api(`/it-requests/${btn.dataset.itDelete}`, { method: 'DELETE' });
            renderItRequestsPage(root);
          } catch (e) { alert(e.message || e); }
        });
      });

    // Approve
    root.querySelectorAll("[data-it-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Approve this IT request and mark it In Progress?")) return;
        try {
          await api(`/it-requests/${btn.dataset.itApprove}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "approve" }),
          });
          renderItRequestsPage(root);
        } catch (e) { alert(e.message); }
      });
    });

    // Deny
    root.querySelectorAll("[data-it-deny]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const reason = prompt("Reason for denying this request (optional):");
        try {
          await api(`/it-requests/${btn.dataset.itDeny}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "deny", denialReason: reason || "" }),
          });
          renderItRequestsPage(root);
        } catch (e) { alert(e.message); }
      });
    });

    // Resolve (open modal with quick options)
    root.querySelectorAll("[data-it-resolve]").forEach((btn) => {
      btn.addEventListener("click", () => openResolveModal(btn.dataset.itResolve, () => renderItRequestsPage(root)));
    });

    // Grab (claim) unassigned tickets
    root.querySelectorAll("[data-it-grab]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm('Grab this ticket and assign to yourself?')) return;
        try {
          await api(`/it-requests/${btn.dataset.itGrab}`, {
            method: "PATCH",
            body: JSON.stringify({ assignedTo: state.user?.username || '' }),
          });
          renderItRequestsPage(root);
        } catch (e) { alert(e.message || e); }
      });
    });

    // Reopen
    root.querySelectorAll("[data-it-reopen]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/it-requests/${btn.dataset.itReopen}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "open" }),
          });
          renderItRequestsPage(root);
        } catch (e) { alert(e.message); }
      });
    });

    // removed mark-as-IT action (handled via Users admin page)
  }

  function renderItCard(r, { canAssign, canApprove, canResolve, canDelete, myEmpId, itUsers, empById }) {
    const isOpen       = r.status === "open";
    const isInProgress = r.status === "in_progress";
    const isDone       = r.status === "resolved" || r.status === "closed";

    const actions = [];

    if (canApprove && isOpen) {
      actions.push(`<button class="btn btn-sm btn-primary" data-it-approve="${r.id}">Approve</button>`);
      actions.push(`<button class="btn btn-sm btn-danger"  data-it-deny="${r.id}">Deny</button>`);
    }

    if (canAssign && (isOpen || isInProgress)) {
      // Button opens assign modal — more reliable than an inline select-on-change
      const assignLabel = r.assignedTo ? `Reassign (${esc(r.assignedTo)})` : "Assign";
      actions.push(`<button class="btn btn-sm" data-it-assign="${r.id}" data-it-current-assign="${esc(r.assignedTo || "")}">${assignLabel}</button>`);
    }

    if (canResolve && (isOpen || isInProgress)) {
      actions.push(`<button class="btn btn-sm" data-it-resolve="${r.id}">Resolve</button>`);
    }

    // Grab button for IT users when unassigned
    if (canAssign && !r.assignedTo) {
      actions.push(`<button class="btn btn-sm" data-it-grab="${r.id}">Grab</button>`);
    }

    if (isDone) {
      actions.push(`<button class="btn btn-sm" data-it-reopen="${r.id}">Reopen</button>`);
    }

    // Edit button: owner or assigners
    if (canAssign || myEmpId === r.employeeId) {
      actions.push(`<button class="btn btn-sm" data-it-edit="${r.id}">Edit</button>`);
    }

    // Delete button: Admin / CEO / IT-flagged users only (Access Control: deleteItRequest)
    if (canDelete) {
      actions.push(`<button class="btn btn-sm btn-danger" data-it-delete="${r.id}">Delete</button>`);
    }

    const routingBadges = [];
    if (r.approvedBy)   routingBadges.push(`<span class="badge badge-ok">Approved by ${esc(r.approvedBy)}</span>`);
    if (r.deniedBy)     routingBadges.push(`<span class="badge badge-out">Denied by ${esc(r.deniedBy)}</span>`);
    if (r.reassignedBy) routingBadges.push(`<span class="badge badge-status">Reassigned by ${esc(r.reassignedBy)}</span>`);

    return `<div class="it-card">
      <div class="it-card-header">
        <div>
          <div class="it-card-title">${esc(r.title)}</div>
          <div class="it-card-meta">
            #${(r.id || "").slice(0, 8)} &middot; ${esc(IT_CATEGORIES[r.category] || r.category)}
            &middot; <span class="${URGENCY_BADGE[r.urgency] || "badge"}">${esc(URGENCY_LABELS[r.urgency] || r.urgency)}</span>
            ${r.unit ? `&middot; ${esc(r.unit)}` : ""}
          </div>
        </div>
        <span class="${STATUS_BADGE[r.status] || "badge"}">${STATUS_LABELS[r.status] || r.status}</span>
      </div>
      ${r.description ? `<div class="it-card-body">${esc(r.description)}</div>` : ""}
      <div class="it-card-meta">
        From: <strong>${esc((empById && empById.get(r.employeeId)) ? (empById.get(r.employeeId).american_name || empById.get(r.employeeId).arabic_name || empById.get(r.employeeId).id) : r.employeeId)}</strong>
        ${ (empById && empById.get(r.employeeId) && empById.get(r.employeeId).team) ? ` &middot; Team: ${esc(empById.get(r.employeeId).team)}` : '' } &middot;
        Assigned: ${r.assignedTo ? `<strong>${esc(r.assignedTo)}</strong>` : '<em>Unassigned</em>'}
      </div>
      <div class="it-card-meta" style="margin-top:.2rem">
        ${(() => {
          const fmt = (ts) => {
            if (!ts) return null;
            const d = new Date(ts);
            return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          };
          const opened = fmt(r.createdAt);
          const resolved = fmt(r.resolvedAt);
          let elapsed = '';
          if (r.createdAt && r.resolvedAt) {
            const mins = Math.round((new Date(r.resolvedAt) - new Date(r.createdAt)) / 60000);
            if (mins < 60) elapsed = `<span class="badge badge-ok" title="Time to resolve">${mins}m</span>`;
            else elapsed = `<span class="badge badge-ok" title="Time to resolve">${Math.floor(mins/60)}h ${mins%60}m</span>`;
          }
          const parts = [];
          if (opened) parts.push(`Opened: ${opened}`);
          if (resolved) parts.push(`Resolved: ${resolved}`);
          if (elapsed) parts.push(elapsed);
          return parts.join(' &middot; ');
        })()}
      </div>
      ${routingBadges.length ? `<div class="it-badge-routing">${routingBadges.join("")}</div>` : ""}
      ${r.denialReason ? `<div class="it-denial-reason">Denial reason: ${esc(r.denialReason)}</div>` : ""}
      ${r.resolutionNotes ? `<div class="it-card-body" style="color:var(--text-muted,#888);font-size:.85rem">Resolution: ${esc(r.resolutionNotes)}</div>` : ""}
      ${actions.length ? `<div class="it-card-actions">${actions.join("")}</div>` : ""}
      ${!r.assignedTo && !r.employeeId ? '' : ''}
      ${/* Add mark-as-IT button for assigners if requester isn't IT */''}
      
    </div>`;
  }

  function openAssignModal(requestId, currentAssignee, itUsers, onDone) {
    if (!itUsers || itUsers.length === 0) {
      return alert("No active IT staff found. Make sure at least one user has the IT role.");
    }
    const opts = itUsers
      .map((u) => `<option value="${esc(u.username)}" ${currentAssignee === u.username ? "selected" : ""}>
        ${esc(u.displayName || u.username)}${u.unit ? " — " + esc(u.unit) : ""}
      </option>`)
      .join("");

    const isReassign = Boolean(currentAssignee);
    const html = `
      <div class="modal-header">
        <h2>${isReassign ? "Reassign" : "Assign"} IT Request</h2>
        <button class="btn btn-sm" data-close>✕</button>
      </div>
      <div class="modal-body">
        ${isReassign ? `<p class="muted" style="margin-bottom:.75rem">Currently assigned to <strong>${esc(currentAssignee)}</strong>. Select a new assignee:</p>` : ""}
        <label class="field">
          <span>Assign to</span>
          <select id="it-assign-sel" style="width:100%">
            <option value="">— Select IT staff member —</option>
            ${opts}
          </select>
        </label>
        <label class="field" style="margin-top:.75rem">
          <span>Notes (optional)</span>
          <textarea id="it-assign-notes" rows="2" placeholder="Reason for assignment or additional context…" style="width:100%"></textarea>
        </label>
      </div>
      <div class="modal-footer">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="it-assign-confirm">${isReassign ? "Reassign" : "Assign"}</button>
      </div>`;

    window.openModal(html);

    document.getElementById("it-assign-confirm").onclick = async () => {
      const assignedTo = document.getElementById("it-assign-sel").value;
      if (!assignedTo) return alert("Please select an IT staff member");
      const notesEl = document.getElementById("it-assign-notes");
      const notes = notesEl ? notesEl.value.trim() : "";
      try {
        await api(`/it-requests/${requestId}`, {
          method: "PATCH",
          body: JSON.stringify({
            action: isReassign ? "reassign" : undefined,
            assignedTo,
            ...(notes ? { resolutionNotes: notes } : {}),
          }),
        });
        window.closeModal();
        onDone();
      } catch (e) { alert(e.message); }
    };
  }

  function openResolveModal(requestId, onDone) {
    const quick = [
      'Fixed',
      'Pending',
      'Switched PC',
      'Switched Headset',
      'Switched Mouse',
      'Repositioned Agent',
      'Other',
    ];
    const opts = quick.map((q) => `<option value="${q}">${q}</option>`).join("");
    const html = `
      <div class="modal-header"><h2>Resolve IT Request</h2><button class="btn btn-sm" data-close>✕</button></div>
      <div class="modal-body">
        <label class="field"><span>Resolution</span><select id="it-resolve-type">${opts}</select></label>
        <label class="field"><span>Public notes (visible to requester)</span><textarea id="it-resolve-notes" rows="3" style="width:100%" placeholder="Notes shown to requester"></textarea></label>
        <label class="field"><span>Secret notes (admin / IT only)</span><textarea id="it-resolve-secret" rows="2" style="width:100%" placeholder="Cost, hardware replaced, internal notes"></textarea></label>
        <label class="field"><span>Cost (optional)</span><input id="it-resolve-cost" type="text" placeholder="e.g. 120" /></label>
      </div>
      <div class="modal-footer">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="it-resolve-confirm">Close Ticket</button>
      </div>`;

    window.openModal(html);

    document.getElementById('it-resolve-confirm').onclick = async () => {
      const type = document.getElementById('it-resolve-type').value;
      const notes = document.getElementById('it-resolve-notes').value.trim();
      const secret = document.getElementById('it-resolve-secret').value.trim();
      const cost = document.getElementById('it-resolve-cost').value.trim();
      // Pending keeps ticket active (in_progress)
      const status = type === 'Pending' ? 'in_progress' : 'resolved';
      // Build secret payload into notesHiddenFromRequester
      let secretPayload = secret || '';
      if (cost) secretPayload = `${secretPayload}${secretPayload ? '\n' : ''}COST:${cost}`;
      try {
        await api(`/it-requests/${requestId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status, resolutionNotes: `${type}${notes ? ': ' + notes : ''}`, notesHiddenFromRequester: secretPayload || undefined }),
        });
        window.closeModal();
        onDone();
      } catch (e) { alert(e.message || e); }
    };
  }

  function openEditModal(requestId, onDone) {
    api('/it-requests').then((d) => {
      const req = (d.requests || []).find(r => r.id === requestId);
      if (!req) return alert('Request not found');
      const html = `
        <div class="modal-header"><h2>Edit IT Request</h2><button class="btn btn-sm" data-close>✕</button></div>
        <div class="modal-body field-grid">
          <label class="field"><span>Title</span><input id="it-edit-title" value="${esc(req.title)}" /></label>
          <label class="field"><span>Category</span><select id="it-edit-category">${Object.entries(IT_CATEGORIES).map(([k,v])=>`<option value="${k}" ${k===req.category? 'selected':''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span>Urgency</span><select id="it-edit-urgency">${Object.entries(URGENCY_LABELS).map(([k,v])=>`<option value="${k}" ${k===req.urgency? 'selected':''}>${v}</option>`).join('')}</select></label>
        </div>
        <div class="modal-footer"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="it-edit-save">Save</button></div>`;
      window.openModal(html);
      document.getElementById('it-edit-save').onclick = async () => {
        const title = document.getElementById('it-edit-title').value.trim();
        const category = document.getElementById('it-edit-category').value;
        const urgency = document.getElementById('it-edit-urgency').value;
        try {
          await api(`/it-requests/${requestId}`, { method: 'PATCH', body: JSON.stringify({ title, category, urgency }) });
          window.closeModal();
          onDone();
        } catch (e) { alert(e.message || e); }
      };
    }).catch(() => alert('Failed to load request'));
  }

  function openReassignModal(requestId, itUsers, onDone) {
    // Legacy alias — delegates to the unified assign modal
    openAssignModal(requestId, "", itUsers, onDone);
  }

  function openNewItRequestModal(root, myEmpId) {
    const catOpts = Object.entries(IT_CATEGORIES)
      .map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    const urgOpts = Object.entries(URGENCY_LABELS)
      .map(([k, v]) => `<option value="${k}" ${k === "normal" ? "selected" : ""}>${v}</option>`).join("");

    const role      = state.user?.role || "";
    const isTlOp    = ["tl", "op"].includes(role);
    const leadTeams = state.user?.leadTeams || [];
    const myUnit    = state.user?.unit || "";

    // Build scoped agent list for TL/OP
    let agentPickerHtml = "";
    if (isTlOp) {
      // We'll load employees async after modal opens
      agentPickerHtml = `
        <label class="field" id="it-agent-field" style="grid-column:1/-1">
          <span>On behalf of <span class="muted">(optional — defaults to yourself)</span></span>
          <select name="forEmployeeId" id="it-agent-sel">
            <option value="${esc(myEmpId)}">— Myself (${esc(myEmpId)}) —</option>
          </select>
        </label>`;
    }

    const html = `
      <div class="modal-header"><h2>New IT Request</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="it-new-form" class="modal-body field-grid">
        <label class="field"><span>Category</span><select name="category">${catOpts}</select></label>
        <label class="field"><span>Issue</span><select name="issueType">
          <option value="">— Select common issue —</option>
          <option value="Headset issue">Headset issue</option>
          <option value="Noise cancellation not working">Noise cancellation not working</option>
          <option value="PC died">PC died</option>
          <option value="Dialer issue">Dialer issue</option>
          <option value="Can't hear customers">Can't hear customers</option>
          <option value="Portal app issue">Portal app issue</option>
          <option value="Other">Other</option>
        </select></label>
        <label class="field"><span>Urgency</span><select name="urgency">${urgOpts}</select></label>
        <label class="field" style="grid-column:1/-1"><span>Title</span><input name="title" required placeholder="Brief description of the issue" /></label>
        ${agentPickerHtml}
        <label class="field" style="grid-column:1/-1">
          <span>Description (optional)</span>
          <textarea name="description" rows="3" placeholder="Steps to reproduce, error messages, affected device…"></textarea>
        </label>
      </form>
      <div class="modal-footer">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="it-new-submit">Submit</button>
      </div>`;

    window.openModal(html);

    // Populate agent picker for TL/OP
    if (isTlOp) {
      api("/employees").then((empData) => {
        const employees = empData.employees || [];
        let visible = employees;
        if (role === "tl") {
          const myTeams = new Set(leadTeams.map((lt) => lt.team));
          visible = employees.filter((e) => myTeams.has(e.team));
        } else if (role === "op" && myUnit) {
          visible = employees.filter((e) => e.unit === myUnit);
        }
        const sel = document.getElementById("it-agent-sel");
        if (!sel) return;
        visible.forEach((e) => {
          if (e.id === myEmpId) return; // already the default option
          const opt = document.createElement("option");
          opt.value = e.id;
          opt.textContent = `${e.american_name || e.arabic_name || e.id} (${e.id})`;
          sel.appendChild(opt);
        });
      }).catch(() => {});
    }

    document.getElementById("it-new-submit").onclick = async () => {
      const form = document.getElementById("it-new-form");
      const fd = new FormData(form);
      const forEmpId = isTlOp
        ? (String(fd.get("forEmployeeId") || "").trim() || myEmpId)
        : myEmpId;
      const body = {
        employeeId: forEmpId,
        title: String(fd.get("title") || "").trim(),
        category: fd.get("category") || "other",
        urgency: fd.get("urgency") || "normal",
        description: (fd.get('issueType') ? fd.get('issueType') + '\n' : '') + String(fd.get("description") || "").trim(),
      };
      if (!body.employeeId || !body.title) return alert("Title is required");
      try {
        await api("/it-requests", { method: "POST", body: JSON.stringify(body) });
        window.closeModal();
        renderItRequestsPage(root);
      } catch (e) { alert(e.message); }
    };
  }

  window.ItRequestsModule = { renderItRequestsPage };
})();
