/**
 * Unified Requests — annual, unpaid, medical, same-day off.
 * Supports half-day (0.5) and quarter-day (0.25) fractions.
 * Annual leave is hidden when the employee has no employment_date or < 180 days.
 */
window.RequestsModule = (function () {
  const KIND_LABELS = {
    annual:   "Annual leave (paid)",
    unpaid:   "Unpaid day off",
    medical:  "Medical / sick",
    same_day: "Same-day off",
    pause:    "Pause request (Mon–Fri week)",
  };

  const FRACTION_LABELS = {
    "1":    "Full day",
    "0.5":  "Half day",
    "0.25": "Quarter day",
  };

  function canApprove(data) {
    return data?.canApprove === true;
  }

  function isHrRole() {
    return ["hr", "admin", "ceo"].includes(state.user?.role);
  }

  function canSubmitForOthers() {
    return isHrRole() || ["tl", "op"].includes(state.user?.role);
  }

  /**
   * Returns true if this employee is eligible for annual leave.
   * No employment_date → false (hide annual option).
   * < 180 days → false.
   */
  function annualEligible(emp) {
    if (!emp || !emp.employment_date) return false;
    const days = (Date.now() - new Date(emp.employment_date).getTime()) / (1000 * 60 * 60 * 24);
    return days >= 180;
  }

  function kindBadge(r) {
    const kind = r.requestKind || r.leaveType || "annual";
    const late = r.lateSubmission  ? ' <span class="badge badge-warn">Late</span>' : "";
    const tl   = r.requestedBy && r.requestedBy !== r.employeeId
      ? ' <span class="badge badge-warn">TL/OP</span>' : "";
    const paid = r.paidLeave ? ' <span class="badge badge-ok">Paid</span>' : "";
    const frac = Number(r.dayFraction || 1);
    const fracBadge = frac < 1
      ? ` <span class="badge badge-status">${FRACTION_LABELS[String(frac)] || frac + "d"}</span>`
      : "";
    return `${KIND_LABELS[kind] || kind}${paid}${fracBadge}${late}${tl}`;
  }

  async function renderRequestsPage(root, api, state, helpers) {
    const { escapeHtml, openModal, closeModal, employeeSelectOptions } = helpers;
    const empQ = typeof employeesQuery === "function" ? employeesQuery() : "";
    const [data, empData] = await Promise.all([
      api("/hrms/leave"),
      api(`/employees${empQ}`).catch(() => ({ employees: [] })),
    ]);
    let employees = empData.employees || [];
    let requests  = data.requests  || [];
    const selfId  = state.user?.employeeId || state.user?.username || "";

    if (!canSubmitForOthers() && selfId) {
      requests  = requests.filter((r) => String(r.employeeId).toLowerCase() === String(selfId).toLowerCase());
      employees = employees.filter((e) => String(e.id).toLowerCase() === String(selfId).toLowerCase());
    } else if (["tl", "op"].includes(state.user?.role) && state.user?.team) {
      const teamIds = new Set(employees.filter((e) => e.team === state.user.team).map((e) => e.id));
      if (!isHrRole()) {
        requests = requests.filter((r) => teamIds.has(r.employeeId) || r.employeeId === selfId);
      }
    }

    const empName = (id) => {
      const e = employees.find((x) => x.id === id);
      return e ? escapeHtml(e.american_name || e.id) : escapeHtml(id);
    };

    root.innerHTML = `
      <div class="page-header flex-between">
        <div>
          <h1>Requests</h1>
          <p class="muted">Annual, unpaid, medical, and same-day off &middot; Approvers: Mark, Raymond, Phoebe</p>
        </div>
        <button class="btn btn-primary" id="new-request-btn">+ New request</button>
      </div>
      <div class="table-wrap card"><table>
        <thead><tr>
          <th>Employee</th><th>Dates</th><th>Type</th><th>Status</th><th>Notes</th><th></th>
        </tr></thead>
        <tbody>${requests.length ? requests.map((r) => {
          const isMedical = ["medical", "exam", "same_day"].includes(r.requestKind || r.leaveType);
          return `<tr>
          <td>${empName(r.employeeId)}<br><span class="muted">${escapeHtml(r.employeeId)}</span></td>
          <td>${r.startDate}${r.startDate !== r.endDate ? " – " + r.endDate : ""}
            ${Number(r.dayFraction || 1) < 1
              ? `<br><span class="muted">${FRACTION_LABELS[String(r.dayFraction)] || ""}</span>`
              : ""}
          </td>
          <td>${kindBadge(r)}</td>
          <td><span class="badge">${escapeHtml(r.status)}</span></td>
          <td>${escapeHtml(r.notes || "")}</td>
          <td class="btn-row">
            ${isMedical ? `<button class="btn btn-sm" data-leave-docs="${r.id}" title="Upload / view sick note or exam schedule">📎 Docs</button>` : ""}
            ${canApprove(data) && r.status === "pending" ? `
              <button class="btn btn-sm btn-primary" data-approve="${r.id}">Approve</button>
              <button class="btn btn-sm" data-reject="${r.id}">Reject</button>` : ""}
            ${canApprove(data) ? `
              <button class="btn btn-sm" data-edit="${r.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-delete="${r.id}">Delete</button>` : ""}
          </td>
        </tr>`;
        }).join("") : '<tr><td colspan="6" class="muted">No requests</td></tr>'}
        </tbody>
      </table></div>`;

    const refresh = () => renderRequestsPage(root, api, state, helpers);

    root.querySelector("#new-request-btn").onclick = () =>
      openRequestModal({ api, employees, selfId, openModal, closeModal, employeeSelectOptions, escapeHtml, onDone: refresh });

    root.querySelectorAll("[data-approve]").forEach((b) => {
      b.onclick = async () => {
        await api(`/hrms/leave/${b.dataset.approve}`, { method: "PUT", body: JSON.stringify({ status: "approved" }) });
        refresh();
      };
    });
    root.querySelectorAll("[data-reject]").forEach((b) => {
      b.onclick = async () => {
        await api(`/hrms/leave/${b.dataset.reject}`, { method: "PUT", body: JSON.stringify({ status: "rejected" }) });
        refresh();
      };
    });
    root.querySelectorAll("[data-delete]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("Delete this request? Approved attendance will be cleared.")) return;
        await api(`/hrms/leave/${b.dataset.delete}`, { method: "DELETE" });
        refresh();
      };
    });
    root.querySelectorAll("[data-edit]").forEach((b) => {
      b.onclick = () => {
        const r = requests.find((x) => String(x.id) === b.dataset.edit);
        if (r) openRequestModal({ api, employees, selfId, request: r, openModal, closeModal, employeeSelectOptions, escapeHtml, onDone: refresh });
      };
    });

    // Medical / exam — doc upload modal
    root.querySelectorAll("[data-leave-docs]").forEach((b) => {
      b.onclick = () => {
        const r = requests.find((x) => String(x.id) === b.dataset.leaveDocs);
        if (r) openLeaveDocsModal({ leaveId: r.id, employeeId: r.employeeId, requestKind: r.requestKind || r.leaveType, api, openModal, closeModal, escapeHtml });
      };
    });
  }

  function openRequestModal({ api, employees, selfId, request, openModal, closeModal, employeeSelectOptions, escapeHtml, onDone }) {
    const isEdit    = !!request;
    const forOthers = canSubmitForOthers();
    const agentList = forOthers ? employees : employees.filter((e) => e.id === selfId);
    const defaultEmpId = request?.employeeId || selfId || (agentList[0]?.id || "");

    // Determine annual eligibility for the default employee (may change on select)
    function getEmpById(id) {
      return agentList.find((e) => String(e.id).toLowerCase() === String(id || "").toLowerCase()) || null;
    }
    const defaultEmp   = getEmpById(defaultEmpId);
    const hrRole       = isHrRole();
    // HR/admin/ceo can always choose annual; others need 180+ days and an employment_date
    const canAnnual    = hrRole || annualEligible(defaultEmp);
    const daysEmployed = defaultEmp?.employment_date
      ? Math.floor((Date.now() - new Date(defaultEmp.employment_date).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const annualOpt = canAnnual
      ? `<option value="annual" ${(request?.requestKind || request?.leaveType) === "annual" ? "selected" : ""}>Annual leave (paid)</option>`
      : "";
    const annualNote = !hrRole && daysEmployed !== null && daysEmployed < 180
      ? `<p class="muted" style="grid-column:1/-1;color:var(--warn,#a05000)">Annual leave requires 180+ days of employment (${daysEmployed} day${daysEmployed !== 1 ? "s" : ""} so far).</p>`
      : (!hrRole && daysEmployed === null
        ? `<p class="muted" style="grid-column:1/-1;color:var(--warn,#a05000)">Annual leave is unavailable — no employment date on record.</p>`
        : "");

    const curFrac = String(request?.dayFraction ?? 1);
    const isSingleDay = request ? (request.startDate === request.endDate) : true;

    openModal(`
      <div class="modal-header">
        <h2>${isEdit ? "Edit request" : "New request"}</h2>
        <button class="btn btn-sm" data-close>✕</button>
      </div>
      <form id="request-form" class="modal-body field-grid modal-body-scroll">
        <label class="field"><span>Employee</span>
          <select name="employeeId" id="req-emp" required ${!forOthers ? "disabled" : ""}>
            ${employeeSelectOptions(agentList, defaultEmpId)}
          </select>
        </label>
        ${!forOthers ? `<input type="hidden" name="employeeId" value="${escapeHtml(defaultEmpId)}" />` : ""}
        ${annualNote}
        <label class="field"><span>Request type</span>
          <select name="requestKind" id="req-kind">
            ${annualOpt}
            <option value="unpaid"   ${(request?.requestKind || request?.leaveType) === "unpaid"   ? "selected" : ""}>Unpaid day off</option>
            <option value="medical"  ${(request?.requestKind || request?.leaveType) === "medical"  ? "selected" : ""}>Medical / sick</option>
            <option value="same_day" ${(request?.requestKind || request?.leaveType) === "same_day" ? "selected" : ""}>Same-day off</option>
            <option value="pause"    ${(request?.requestKind || request?.leaveType) === "pause"    ? "selected" : ""}>Pause request (Mon–Fri week off)</option>
          </select>
        </label>
        <label class="field" id="req-start-wrap"><span>Start date</span>
          <input name="startDate" type="date" required value="${request?.startDate || ""}" id="req-start" />
        </label>
        <label class="field" id="req-end-wrap"><span>End date</span>
          <input name="endDate" type="date" required value="${request?.endDate || ""}" id="req-end" />
        </label>
        <label class="field" id="req-fraction-wrap">
          <span>Duration</span>
          <select name="dayFraction" id="req-fraction">
            <option value="1"    ${curFrac === "1"    ? "selected" : ""}>Full day</option>
            <option value="0.5"  ${curFrac === "0.5"  ? "selected" : ""}>Half day</option>
            <option value="0.25" ${curFrac === "0.25" ? "selected" : ""}>Quarter day (2 hours)</option>
          </select>
        </label>
        <label class="field" style="grid-column:1/-1">
          <span>Notes</span>
          <textarea name="notes">${escapeHtml(request?.notes || "")}</textarea>
        </label>
        <p class="muted" style="grid-column:1/-1">
          Same-day requests after 12:00 are allowed but flagged as late. Workday starts 3 PM.
          Half-day and quarter-day options apply to single-day requests only.
        </p>
      </form>
      <div class="modal-footer">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="submit-request">${isEdit ? "Save" : "Submit"}</button>
      </div>`, true);

    // Helper: compute Mon–Fri week bounds for a given date (client-side preview)
    function workWeekBoundsLocal(dateStr) {
      if (!dateStr) return null;
      const d = new Date(`${dateStr}T12:00:00`);
      const day = d.getDay();
      const diffToMon = day === 0 ? -6 : 1 - day;
      const mon = new Date(d); mon.setDate(d.getDate() + diffToMon);
      const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
      const fmt = (x) =>
        `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
      return { monday: fmt(mon), friday: fmt(fri) };
    }

    // Show/hide end date & fraction; show week preview for pause
    function updatePauseUI() {
      const kind      = document.getElementById("req-kind")?.value;
      const endWrap   = document.getElementById("req-end-wrap");
      const fracWrap  = document.getElementById("req-fraction-wrap");
      const previewEl = document.getElementById("req-pause-preview");
      const isPause   = kind === "pause";

      if (endWrap)  endWrap.style.display   = isPause ? "none" : "";
      if (fracWrap) fracWrap.style.display  = isPause ? "none" : "";

      if (isPause && previewEl) {
        const start = document.getElementById("req-start")?.value;
        if (start) {
          const wk = workWeekBoundsLocal(start);
          previewEl.textContent = wk
            ? `Week off: ${wk.monday} – ${wk.friday} (Mon–Fri, 5 days)`
            : "";
          previewEl.style.display = "";
        } else {
          previewEl.textContent = "Pick any day in the week you want to pause.";
          previewEl.style.display = "";
        }
        // Auto-set end to Friday of that week
        const endEl = document.getElementById("req-end");
        if (endEl && start) {
          const wk = workWeekBoundsLocal(start);
          if (wk) endEl.value = wk.friday;
        }
      } else if (previewEl) {
        previewEl.style.display = "none";
      }
    }

    // Inject pause preview element after fraction wrap
    const fracWrapEl = document.getElementById("req-fraction-wrap");
    if (fracWrapEl && !document.getElementById("req-pause-preview")) {
      const preview = document.createElement("p");
      preview.id = "req-pause-preview";
      preview.style.cssText = "grid-column:1/-1;color:var(--info,#0066cc);font-size:.87rem;display:none;margin:0";
      fracWrapEl.after(preview);
    }

    // Hide fraction picker when multi-day range is selected (non-pause)
    function updateFractionVisibility() {
      const kind  = document.getElementById("req-kind")?.value;
      const start = document.getElementById("req-start")?.value;
      const end   = document.getElementById("req-end")?.value;
      const wrap  = document.getElementById("req-fraction-wrap");
      if (!wrap) return;
      if (kind === "pause") return; // already hidden by updatePauseUI
      wrap.style.display = (start && end && start !== end) ? "none" : "";
      if (start && end && start !== end) {
        const sel = document.getElementById("req-fraction");
        if (sel) sel.value = "1";
      }
    }
    document.getElementById("req-kind")?.addEventListener("change", () => {
      updatePauseUI();
      updateFractionVisibility();
    });
    document.getElementById("req-start")?.addEventListener("change", () => {
      const startEl = document.getElementById("req-start");
      const endEl   = document.getElementById("req-end");
      const kind    = document.getElementById("req-kind")?.value;
      if (endEl && !endEl.value && kind !== "pause") endEl.value = startEl.value;
      updatePauseUI();
      updateFractionVisibility();
    });
    document.getElementById("req-end")?.addEventListener("change", updateFractionVisibility);
    updatePauseUI();
    updateFractionVisibility();

    document.getElementById("submit-request").onclick = async () => {
      const fd = new FormData(document.getElementById("request-form"));
      const body = Object.fromEntries(fd.entries());
      if (!forOthers) body.employeeId = defaultEmpId;
      body.leaveType    = body.requestKind;
      body.dayFraction  = Number(body.dayFraction || 1);
      body.halfDay      = body.dayFraction === 0.5;
      body.quarterDay   = body.dayFraction === 0.25;
      // For pause: the server computes the canonical Mon–Fri dates;
      // we still send startDate so the server knows which week.
      if (body.requestKind === "pause") {
        body.dayFraction = 1;
        body.halfDay     = false;
        body.quarterDay  = false;
      }
      try {
        if (isEdit) {
          await api(`/hrms/leave/${request.id}`, { method: "PUT",  body: JSON.stringify(body) });
        } else {
          await api("/hrms/leave",                { method: "POST", body: JSON.stringify(body) });
        }
        closeModal();
        onDone();
      } catch (e) {
        alert(e.message);
      }
    };
  }

  function openLeaveDocsModal({ leaveId, employeeId, requestKind, api, openModal, closeModal, escapeHtml }) {
    const docTypeLabel = requestKind === "exam" ? "Exam schedule" : "Sick note / Medical certificate";
    const docTypeValue = requestKind === "exam" ? "Exam Note" : "Medical Note";

    openModal(`
      <div class="modal-header">
        <h2>${escapeHtml(docTypeLabel)}</h2>
        <button class="btn btn-sm" data-close>✕</button>
      </div>
      <div class="modal-body" style="min-width:340px">
        <p class="muted" style="margin-bottom:.75rem">
          Upload a ${escapeHtml(docTypeLabel.toLowerCase())} for this request.
          The file is stored in the employee's documents (same as HR docs).
        </p>
        <div id="leave-docs-list" class="muted" style="margin-bottom:.75rem">Loading…</div>
        <hr style="margin:.75rem 0" />
        <div>
          <label class="field">
            <span>Upload ${escapeHtml(docTypeLabel)}</span>
            <input type="file" id="leave-doc-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" />
          </label>
          <label class="field" style="margin-top:.5rem">
            <span>Notes (optional)</span>
            <input type="text" id="leave-doc-notes" placeholder="e.g. Dr. Smith, issued 2026-07-08" />
          </label>
          <button class="btn btn-primary btn-sm" id="leave-doc-upload-btn" style="margin-top:.5rem">Upload</button>
          <span id="leave-doc-upload-status" style="font-size:.85rem;margin-left:.5rem"></span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-close>Close</button>
      </div>`);

    // Load existing docs
    async function loadDocs() {
      const el = document.getElementById("leave-docs-list");
      if (!el) return;
      try {
        const data = await api(`/hrms/leave/${leaveId}/documents`);
        const docs = data.documents || [];
        if (!docs.length) {
          el.textContent = "No documents uploaded yet.";
          return;
        }
        el.innerHTML = `<ul style="list-style:none;padding:0;margin:0">${docs.map((d) => `
          <li style="display:flex;align-items:center;gap:.5rem;padding:.3rem 0;border-bottom:1px solid var(--border,#eee)">
            <span style="flex:1">📄 ${escapeHtml(d.fileName)}
              ${d.notes ? `<span class="muted" style="font-size:.8rem"> — ${escapeHtml(d.notes)}</span>` : ""}
              <span class="muted" style="font-size:.75rem;display:block">${d.uploadedBy ? "By " + escapeHtml(d.uploadedBy) + " · " : ""}${d.createdAt ? new Date(d.createdAt).toLocaleDateString() : ""}</span>
            </span>
            ${d.driveFileId
              ? `<a href="/api/documents/${encodeURIComponent(employeeId)}/${encodeURIComponent(d.driveFileId)}/file" target="_blank" class="btn btn-sm">View</a>`
              : ""}
          </li>`).join("")}</ul>`;
      } catch (e) {
        const el2 = document.getElementById("leave-docs-list");
        if (el2) el2.textContent = e.message || "Could not load documents";
      }
    }
    loadDocs();

    document.getElementById("leave-doc-upload-btn").onclick = async () => {
      const fileInput = document.getElementById("leave-doc-file");
      const notes     = document.getElementById("leave-doc-notes")?.value?.trim() || "";
      const statusEl  = document.getElementById("leave-doc-upload-status");
      const file = fileInput?.files?.[0];
      if (!file) { if (statusEl) statusEl.textContent = "Select a file first."; return; }

      const btn = document.getElementById("leave-doc-upload-btn");
      btn.disabled = true;
      btn.textContent = "Uploading…";
      if (statusEl) statusEl.textContent = "";

      try {
        // Read file as base64
        const contentBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        await api(`/hrms/leave/${leaveId}/documents`, {
          method: "POST",
          body: JSON.stringify({
            fileName: file.name,
            contentBase64,
            docType: docTypeValue,
            notes,
          }),
        });

        if (statusEl) statusEl.textContent = "✓ Uploaded";
        fileInput.value = "";
        document.getElementById("leave-doc-notes").value = "";
        loadDocs();
      } catch (e) {
        if (statusEl) statusEl.textContent = "Error: " + (e.message || "Upload failed");
      } finally {
        btn.disabled = false;
        btn.textContent = "Upload";
      }
    };
  }

  return { renderRequestsPage };
})();
