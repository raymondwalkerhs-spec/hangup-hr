window.TrainingModule = (function () {
  const DEFAULT_TRAINING_OPTIONS = ["waiting", "on hold", "started", "dropped", "postponed", "cancelled"];
  const METRIC_OPTIONS = [1, 2, 3, 4, 5];

  let pollTimer = null;
  let lastRowsHash = "";
  let meta = null;
  let allRows = [];
  let currentRole = null;
  let currentUsername = null;
  let trainerOptions = [];
  let useSupabase = false;

  function log(...args) {
    console.log("[TrainingModule]", ...args);
  }

  function isTrainer() {
    return ["op", "tl"].includes(currentRole || "");
  }

  function init(container) {
    log("init", container ? "container provided" : "rendering into #app");
    const root = container || document.getElementById("app");
    if (!root) {
      log("init failed: no root element");
      return;
    }
    loadMeta(root).then(() => {
      root.innerHTML = buildShell();
      bindEvents(root);
      startSync(root);
    });
  }

  async function loadMeta(root) {
    try {
      const res = await fetch("/api/interview/interviews/meta");
      if (!res.ok) throw new Error(`meta HTTP ${res.status}`);
      meta = await res.json();
      currentRole = meta.role || null;
      currentUsername = meta.username ? String(meta.username).trim().toLowerCase() : null;
      trainerOptions = Array.isArray(meta.trainerOptions) ? meta.trainerOptions : [];
      useSupabase = Boolean(meta.role && process.env.DATA_BACKEND === "supabase");
      log("meta loaded", meta.tab, meta.headers?.length || 0, "role=", currentRole, "supabase=", useSupabase, "trainers=", trainerOptions.length);
    } catch (e) {
      log("meta error", e.message);
    }
  }

  function trainingStatusOptions() {
    const fromMeta = meta?.trainingOptions;
    return Array.isArray(fromMeta) && fromMeta.length ? fromMeta : DEFAULT_TRAINING_OPTIONS;
  }

  function normalizeTrainingStatus(status) {
    const s = String(status || "").trim().toLowerCase();
    if (s === "no show no call") return "on hold";
    return String(status || "").trim();
  }

  function buildShell() {
    const trainerFilter = isTrainer() ? "" : `
      <select data-filter="trainer">
        <option value="">All Trainers</option>
        ${trainerOptions.map((t) => `<option value="${t.username}">${t.employeeId || t.username} (${t.name || t.username})</option>`).join("")}
      </select>
    `;
    return `
      <div class="training-shell">
        <div class="training-header">
          <h2>Training</h2>
          <div class="training-actions">
            <button class="btn btn-secondary" data-action="refresh">Refresh</button>
          </div>
        </div>
        <div class="training-toolbar">
          <input class="search" placeholder="Search candidates..." data-filter="search" />
          <select data-filter="trainingStatus">
            <option value="">All Status</option>
            ${trainingStatusOptions().map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>
          <input type="date" data-filter="trainingStartDate" placeholder="Training Date" />
          ${trainerFilter}
        </div>
        <div class="table-wrap">
          <table class="data-table training-main-table">
            <thead>
              <tr>
                <th>Candidate Name</th>
                <th>Training Status</th>
                <th>Training Start Date</th>
                <th>Trainer</th>
                <th>Batch</th>
                <th class="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="sync-status muted">Syncing...</div>
      </div>
    `;
  }

  function bindEvents(root) {
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "refresh") {
        log("manual refresh");
        refresh(root, true);
      }
      if (action === "edit") openEditModal(root, btn.dataset.id);
    });
    root.addEventListener("input", (e) => {
      const target = e.target;
      if (target.matches("[data-filter]")) applyFilters(root);
    });
    root.addEventListener("change", (e) => {
      const target = e.target;
      if (target.matches("[data-filter]")) applyFilters(root);
    });
  }

  async function startSync(root) {
    log("start sync");
    stopSync();
    await refresh(root, true);
    pollTimer = setInterval(() => refresh(root, false), 5000);
  }

  function stopSync() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    lastRowsHash = "";
  }

  async function refresh(root, isInitial) {
    const statusEl = root.querySelector(".sync-status");
    if (!isInitial && statusEl) statusEl.textContent = "Refreshing...";
    try {
      const trainerFilter = isTrainer() ? `&trainer=${encodeURIComponent(currentRole || "")}` : "";
      const dateFilter = root.querySelector('[data-filter="trainingStartDate"]')?.value || "";
      const dateParam = dateFilter ? `&trainingStartDate=${encodeURIComponent(dateFilter)}` : "";
      const res = await fetch(`/api/interview/interviews/training?${trainerFilter}${dateParam}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allRows = data.rows || [];
      const hash = JSON.stringify(allRows);
      if (hash !== lastRowsHash || isInitial) {
        lastRowsHash = hash;
        renderTable(root);
        log("rows updated", allRows.length);
      } else {
        log("no changes");
      }
      if (statusEl) statusEl.textContent = `Synced · ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      log("refresh error", err.message);
      if (statusEl) statusEl.textContent = "Sync error: " + err.message;
    }
  }

  function getEssentialRow(r) {
    const name = r?.Name || r?.name || "";
    const trainingStatus = r?.trainingStatus || r?.training_status || "";
    const trainingStartDate = r?.trainingStartDate || r?.training_start_date || "";
    const trainer = r?.trainer || "";
    const batchNumber = r?.batchNumber || r?.batch_number || "";
    return { name, trainingStatus, trainingStartDate, trainer, batchNumber };
  }

  function getFilteredRows(root) {
    const search = root.querySelector('[data-filter="search"]')?.value?.trim().toLowerCase() || "";
    const statusFilter = root.querySelector('[data-filter="trainingStatus"]')?.value || "";
    return allRows.filter((r) => {
      const essential = getEssentialRow(r);
      if (statusFilter) {
        const rowStatus = normalizeTrainingStatus(essential.trainingStatus);
        const want = normalizeTrainingStatus(statusFilter);
        if (rowStatus !== want) return false;
      }
      if (search) {
        const trainerOption = (trainerOptions || []).find((t) => t.username === essential.trainer);
        const trainerDisplay = trainerOption
          ? `${trainerOption.employeeId || trainerOption.username} ${trainerOption.name || ""}`
          : essential.trainer;
        const hay = [essential.name, trainerDisplay, essential.batchNumber, essential.trainingStatus]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }

  function renderTable(root) {
    const thead = root.querySelector("thead");
    const tbody = root.querySelector("tbody");
    if (!thead || !tbody) return;
    const rows = getFilteredRows(root);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No training candidates found.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((r) => {
        const essential = getEssentialRow(r);
        const rowId = r?.id || "";
        const statusClass = essential.trainingStatus ? `status-${String(essential.trainingStatus).toLowerCase().replace(/\s+/g, "-")}` : "";
        const trainerOption = (trainerOptions || []).find((t) => t.username === essential.trainer);
        const trainerDisplay = trainerOption ? `${trainerOption.employeeId || trainerOption.username} (${trainerOption.name || trainerOption.username})` : essential.trainer;
        return `<tr data-id="${rowId}" class="${statusClass}">
          <td>${escapeHtml(essential.name)}</td>
          <td><span class="badge">${escapeHtml(essential.trainingStatus)}</span></td>
          <td>${escapeHtml(essential.trainingStartDate)}</td>
          <td>${escapeHtml(trainerDisplay)}</td>
          <td>${escapeHtml(essential.batchNumber)}</td>
          <td class="actions-col">
            <div class="btn-row">
              ${!isTrainer() ? `<button class="btn btn-outline btn-sm" data-action="view" data-id="${rowId}" aria-label="View">View</button>` : ""}
              <button class="btn btn-primary btn-sm" data-action="edit" data-id="${rowId}" aria-label="Edit">Edit</button>
            </div>
          </td>
        </tr>`;
      })
      .join("");
  }

  function applyFilters(root) {
    refresh(root, false);
  }

  function getRowById(id) {
    return allRows.find((r) => r?.id === id) || null;
  }

  function openViewModal(root, id) {
    const row = getRowById(id);
    if (!row) return;
    const candidateName = row?.Name || row?.name || "";
    const candidateEmail = row?.Email || row?.email || "";
    const trainer = row?.trainer || "";
    const feedbacks = [];
    const days = [1, 2, 3, 4, 5];
    const dayInputs = days.map((day) => {
      const feedback = row?.feedbacks?.find((f) => f.day === day) || {};
      const isTestCall = day === 5;
      const metrics = isTestCall ? `
        <div class="metrics-section">
          <h4>Test Call Metrics</h4>
          <div class="metrics-grid">
            <label><span>Active Listening</span>
              <select disabled>
                <option value="">-</option>
                ${METRIC_OPTIONS.map((m) => `<option value="${m}" ${feedback.active_listening_metric === m ? "selected" : ""}>${m}</option>`).join("")}
              </select>
            </label>
            <label><span>English</span>
              <select disabled>
                <option value="">-</option>
                ${METRIC_OPTIONS.map((m) => `<option value="${m}" ${feedback.english_metric === m ? "selected" : ""}>${m}</option>`).join("")}
              </select>
            </label>
            <label><span>Accent</span>
              <select disabled>
                <option value="">-</option>
                ${METRIC_OPTIONS.map((m) => `<option value="${m}" ${feedback.accent_metric === m ? "selected" : ""}>${m}</option>`).join("")}
              </select>
            </label>
            <label><span>Product Knowledge</span>
              <select disabled>
                <option value="">-</option>
                ${METRIC_OPTIONS.map((m) => `<option value="${m}" ${feedback.product_knowledge_metric === m ? "selected" : ""}>${m}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>
      ` : "";
      return `
        <div class="feedback-day">
          <label><span>Day ${day}</span><input type="date" value="${escapeHtml(feedback.date || "")}" disabled /></label>
          <label style="grid-column:1/-1"><span>Feedback</span><textarea rows="3" disabled>${escapeHtml(feedback.feedback_text || "")}</textarea></label>
          ${metrics}
        </div>
      `;
    }).join("");
    window.openModal(`<div class="modal-header"><h2>View Training - ${escapeHtml(candidateName)}</h2><button class="btn btn-sm" data-close>✕</button></div><div class="modal-body interview-modal-root"><input type="hidden" data-field="candidateId" value="${escapeHtml(id)}" /><input type="hidden" data-field="candidateName" value="${escapeHtml(candidateName)}" /><input type="hidden" data-field="candidateEmail" value="${escapeHtml(candidateEmail)}" /><input type="hidden" data-field="trainer" value="${escapeHtml(trainer)}" />${dayInputs}<div class="form-actions"><button type="button" class="btn" data-close>Close</button></div></div>`, true);
  }

  function openEditModal(root, id) {
    const row = getRowById(id);
    if (!row) return;
    const candidateName = row?.Name || row?.name || "";
    const candidateEmail = row?.Email || row?.email || "";
    const trainer = row?.trainer || "";
    const days = [1, 2, 3, 4, 5];
    const dayInputs = days.map((day) => {
      const feedback = row?.feedbacks?.find((f) => f.day === day) || {};
      const isTestCall = day === 5;
      const metrics = isTestCall ? `
        <div class="metrics-section">
          <h4>Test Call Metrics</h4>
          <div class="metrics-grid">
            <label><span>Active Listening</span>
              <select data-day="${day}" data-field="activeListening">
                <option value="">-</option>
                ${METRIC_OPTIONS.map((m) => `<option value="${m}" ${feedback.active_listening_metric === m ? "selected" : ""}>${m}</option>`).join("")}
              </select>
            </label>
            <label><span>English</span>
              <select data-day="${day}" data-field="english">
                <option value="">-</option>
                ${METRIC_OPTIONS.map((m) => `<option value="${m}" ${feedback.english_metric === m ? "selected" : ""}>${m}</option>`).join("")}
              </select>
            </label>
            <label><span>Accent</span>
              <select data-day="${day}" data-field="accent">
                <option value="">-</option>
                ${METRIC_OPTIONS.map((m) => `<option value="${m}" ${feedback.accent_metric === m ? "selected" : ""}>${m}</option>`).join("")}
              </select>
            </label>
            <label><span>Product Knowledge</span>
              <select data-day="${day}" data-field="productKnowledge">
                <option value="">-</option>
                ${METRIC_OPTIONS.map((m) => `<option value="${m}" ${feedback.product_knowledge_metric === m ? "selected" : ""}>${m}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>
      ` : "";
      return `
        <div class="feedback-day">
          <label><span>Day ${day}</span><input type="date" data-day="${day}" data-field="date" value="${escapeHtml(feedback.date || "")}" /></label>
          <label style="grid-column:1/-1"><span>Feedback</span><textarea data-day="${day}" data-field="text" rows="3" placeholder="Daily feedback for day ${day}...">${escapeHtml(feedback.feedback_text || "")}</textarea></label>
          ${metrics}
        </div>
      `;
    }).join("");
    window.openModal(`<div class="modal-header"><h2>Edit Training - ${escapeHtml(candidateName)}</h2><button class="btn btn-sm" data-close>✕</button></div><form id="training-edit-form" class="form-grid modal-body-scroll interview-modal-root"><input type="hidden" data-field="candidateId" value="${escapeHtml(id)}" /><input type="hidden" data-field="candidateName" value="${escapeHtml(candidateName)}" /><input type="hidden" data-field="candidateEmail" value="${escapeHtml(candidateEmail)}" /><input type="hidden" data-field="trainer" value="${escapeHtml(trainer)}" />${dayInputs}<div class="form-actions"><button type="submit" class="btn btn-primary" data-action="save-training">Save</button><button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button></div></form>`, true);
    const form = document.getElementById("training-edit-form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        saveTraining(root);
      });
    }
  }

  async function saveTraining(root) {
    const form = document.getElementById("training-edit-form");
    if (!form) return;
    const candidateId = form.querySelector('[data-field="candidateId"]')?.value || "";
    const candidateName = form.querySelector('[data-field="candidateName"]')?.value || "";
    const candidateEmail = form.querySelector('[data-field="candidateEmail"]')?.value || "";
    const trainer = form.querySelector('[data-field="trainer"]')?.value || "";
    const days = [1, 2, 3, 4, 5];
    const promises = days.map(async (day) => {
      const dateEl = form.querySelector(`[data-day="${day}"][data-field="date"]`);
      const textEl = form.querySelector(`[data-day="${day}"][data-field="text"]`);
      const activeListeningEl = form.querySelector(`[data-day="${day}"][data-field="activeListening"]`);
      const englishEl = form.querySelector(`[data-day="${day}"][data-field="english"]`);
      const accentEl = form.querySelector(`[data-day="${day}"][data-field="accent"]`);
      const productKnowledgeEl = form.querySelector(`[data-day="${day}"][data-field="productKnowledge"]`);
      const date = dateEl?.value || "";
      const text = textEl?.value || "";
      const activeListening = activeListeningEl?.value || "";
      const english = englishEl?.value || "";
      const accent = accentEl?.value || "";
      const productKnowledge = productKnowledgeEl?.value || "";
      const isTestCall = day === 5;
      const payload = {
        candidateId,
        candidateName,
        candidateEmail,
        day: String(day),
        feedbackText: text,
        trainer,
        date,
        isTestCallDay: isTestCall,
        activeListeningMetric: activeListening ? Number(activeListening) : null,
        englishMetric: english ? Number(english) : null,
        accentMetric: accent ? Number(accent) : null,
        productKnowledgeMetric: productKnowledge ? Number(productKnowledge) : null,
      };
      const res = await fetch("/api/interview/feedbacks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        log("training save error day", day, err.error);
      }
    });
    await Promise.all(promises);
    window.closeModal();
    alert("Training saved successfully.");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { init, startSync, stopSync };
})();
