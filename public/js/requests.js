/**
 * Unified Requests — annual, unpaid, medical, same-day off.
 */
window.RequestsModule = (function () {
  const KIND_LABELS = {
    annual: "Annual leave (paid)",
    unpaid: "Unpaid day off",
    medical: "Medical / sick",
    same_day: "Same-day off",
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

  function kindBadge(r) {
    const kind = r.requestKind || r.leaveType || "annual";
    const late = r.lateSubmission ? ' <span class="badge badge-warn">Late</span>' : "";
    const tl = r.requestedBy && r.requestedBy !== r.employeeId ? ' <span class="badge badge-warn">TL/OP</span>' : "";
    const paid = r.paidLeave ? ' <span class="badge badge-ok">Paid</span>' : "";
    return `${KIND_LABELS[kind] || kind}${paid}${late}${tl}`;
  }

  async function renderRequestsPage(root, api, state, helpers) {
    const { escapeHtml, openModal, closeModal, employeeSelectOptions } = helpers;
    const empQ = typeof employeesQuery === "function" ? employeesQuery() : "";
    const [data, empData] = await Promise.all([
      api("/hrms/leave"),
      api(`/employees${empQ}`).catch(() => ({ employees: [] })),
    ]);
    let employees = empData.employees || [];
    let requests = data.requests || [];
    const selfId = state.user?.employeeId || state.user?.username || "";

    if (!canSubmitForOthers() && selfId) {
      requests = requests.filter((r) => String(r.employeeId).toLowerCase() === String(selfId).toLowerCase());
      employees = employees.filter((e) => String(e.id).toLowerCase() === String(selfId).toLowerCase());
    } else if (["tl", "op"].includes(state.user?.role) && state.user?.team) {
      const teamIds = new Set(
        employees.filter((e) => e.team === state.user.team).map((e) => e.id)
      );
      if (!isHrRole()) requests = requests.filter((r) => teamIds.has(r.employeeId) || r.employeeId === selfId);
    }

    const empName = (id) => {
      const e = employees.find((x) => x.id === id);
      return e ? escapeHtml(e.american_name || e.id) : escapeHtml(id);
    };

    root.innerHTML = `
      <div class="page-header flex-between">
        <div>
          <h1>Requests</h1>
          <p class="muted">Annual, unpaid, medical, and same-day off · Approvers: Mark, Raymond, Phoebe</p>
        </div>
        <button class="btn btn-primary" id="new-request-btn">+ New request</button>
      </div>
      <div class="table-wrap card"><table>
        <thead><tr>
          <th>Employee</th><th>Dates</th><th>Type</th><th>Status</th><th>Notes</th><th></th>
        </tr></thead>
        <tbody>${requests.length ? requests.map((r) => `<tr>
          <td>${empName(r.employeeId)}<br><span class="muted">${escapeHtml(r.employeeId)}</span></td>
          <td>${r.startDate} – ${r.endDate}</td>
          <td>${kindBadge(r)}</td>
          <td><span class="badge">${escapeHtml(r.status)}</span></td>
          <td>${escapeHtml(r.notes || "")}</td>
          <td class="btn-row">
            ${canApprove(data) && r.status === "pending" ? `
              <button class="btn btn-sm btn-primary" data-approve="${r.id}">Approve</button>
              <button class="btn btn-sm" data-reject="${r.id}">Reject</button>` : ""}
            ${canApprove(data) ? `
              <button class="btn btn-sm" data-edit="${r.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-delete="${r.id}">Delete</button>` : ""}
          </td>
        </tr>`).join("") : '<tr><td colspan="6" class="muted">No requests</td></tr>'}
        </tbody>
      </table></div>`;

    const refresh = () => renderRequestsPage(root, api, state, helpers);

    root.querySelector("#new-request-btn").onclick = () => openRequestModal({
      api, employees, selfId, openModal, closeModal, employeeSelectOptions, escapeHtml, onDone: refresh,
    });

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
        if (r) openRequestModal({
          api, employees, selfId, request: r, openModal, closeModal, employeeSelectOptions, escapeHtml, onDone: refresh,
        });
      };
    });
  }

  function openRequestModal({ api, employees, selfId, request, openModal, closeModal, employeeSelectOptions, escapeHtml, onDone }) {
    const isEdit = !!request;
    const forOthers = canSubmitForOthers();
    const agentList = forOthers ? employees : employees.filter((e) => e.id === selfId);
    const defaultEmp = request?.employeeId || selfId || (agentList[0]?.id || "");
    openModal(`
      <div class="modal-header"><h2>${isEdit ? "Edit request" : "New request"}</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="request-form" class="modal-body field-grid modal-body-scroll">
        <label class="field"><span>Employee</span>
          <select name="employeeId" required ${!forOthers ? "disabled" : ""}>
            ${employeeSelectOptions(agentList, defaultEmp)}
          </select></label>
        ${!forOthers ? `<input type="hidden" name="employeeId" value="${escapeHtml(defaultEmp)}" />` : ""}
        <label class="field"><span>Request type</span>
          <select name="requestKind" id="req-kind">
            <option value="annual" ${request?.requestKind === "annual" ? "selected" : ""}>Annual leave (paid)</option>
            <option value="unpaid" ${request?.requestKind === "unpaid" ? "selected" : ""}>Unpaid day off</option>
            <option value="medical" ${request?.requestKind === "medical" ? "selected" : ""}>Medical / sick</option>
            <option value="same_day" ${request?.requestKind === "same_day" ? "selected" : ""}>Same-day off</option>
          </select></label>
        <label class="field"><span>Start</span><input name="startDate" type="date" required value="${request?.startDate || ""}" /></label>
        <label class="field"><span>End</span><input name="endDate" type="date" required value="${request?.endDate || ""}" /></label>
        <label class="field" style="grid-column:1/-1"><span>Notes</span><textarea name="notes">${escapeHtml(request?.notes || "")}</textarea></label>
        <p class="muted" style="grid-column:1/-1">Same-day requests after 12:00 are allowed but flagged as late. Workday starts 3 PM.</p>
      </form>
      <div class="modal-footer"><button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="submit-request">${isEdit ? "Save" : "Submit"}</button></div>`, true);

    document.getElementById("submit-request").onclick = async () => {
      const fd = new FormData(document.getElementById("request-form"));
      const body = Object.fromEntries(fd.entries());
      if (!forOthers) body.employeeId = defaultEmp;
      body.leaveType = body.requestKind;
      try {
        if (isEdit) {
          await api(`/hrms/leave/${request.id}`, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/hrms/leave", { method: "POST", body: JSON.stringify(body) });
        }
        closeModal();
        onDone();
      } catch (e) {
        alert(e.message);
      }
    };
  }

  return { renderRequestsPage };
})();
