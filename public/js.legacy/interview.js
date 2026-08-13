window.InterviewModule = (function () {
  const STATUS_OPTIONS = ["pending", "on hold", "accepted", "rejected"];
  const TRAINING_OPTIONS = ["waiting", "on hold", "started", "dropped", "postponed", "cancelled"];
  const GRADUATION_OPTIONS = ["Graduated", "Not Graduated", "In Progress"];
  const DAY_OPTIONS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const RATING_OPTIONS = ["1", "2", "3", "4", "5"];

  const ESSENTIAL_COLUMNS = ["timestamp", "name", "phone", "firstInterviewStatus", "secondInterviewStatus"];
  const EDITABLE_COLUMNS = ["timestamp", "name", "email", "phone", "whatsapp", "dateOfBirth", "address", "graduationStatus", "facultyName", "universityName", "nationalId", "previousExperiences", "gender", "englishSpeaking", "englishWriting", "englishListening", "fastPacedRating", "availableDays", "currentlyEmployed", "preferredWorkingMode", "howHeard", "companyIfYes", "firstInterviewStatus", "firstInterviewFeedback", "interviewDate", "interviewer", "trainingStatus", "trainingStartDate", "trainer", "secondInterviewDate", "secondInterviewFeedback", "secondInterviewStatus", "secondInterviewer"];

  let pollTimer = null;
  let lastRowsHash = "";
  let saveTimer = null;
  let meta = null;
  let allRows = [];
  let editingRowId = null;
  let currentRole = null;
  let currentUsername = null;
  let interviewerOptions = [];
  let trainerOptions = [];
  let useSupabase = false;
  let saveShouldClose = true;

  let canEditInterviews = false;
  let canDeleteInterviews = false;

  function log(...args) {
    console.log("[InterviewModule]", ...args);
  }

  function isTrainer() {
    return ["op", "tl"].includes(currentRole || "");
  }

  function resolvePermissions() {
    const user = typeof window !== "undefined" ? window.state?.user : null;
    canEditInterviews =
      user?.canEditInterview === true ||
      meta?.canEditInterview === true ||
      ["admin", "ceo", "hr", "quality"].includes(currentRole || "");
    canDeleteInterviews =
      user?.canDeleteInterview === true ||
      meta?.canDeleteInterview === true ||
      ["admin", "ceo", "hr"].includes(currentRole || "");
  }

  function init(container) {
    log("init", container ? "container provided" : "rendering into #app");
    const root = container || document.getElementById("app");
    if (!root) {
      log("init failed: no root element");
      return;
    }
    root.innerHTML = buildShell();
    bindEvents(root);
    loadMeta(root);
    startSync(root);
  }

  async function loadMeta(root) {
    try {
      const res = await fetch("/api/interview/interviews/meta");
      if (!res.ok) throw new Error(`meta HTTP ${res.status}`);
      meta = await res.json();
      currentRole = meta.role || null;
      currentUsername = meta.username ? String(meta.username).trim().toLowerCase() : null;
      interviewerOptions = Array.isArray(meta.interviewerOptions) ? meta.interviewerOptions : [];
      trainerOptions = Array.isArray(meta.trainerOptions) ? meta.trainerOptions : [];
      useSupabase = Boolean(meta.role && process.env.DATA_BACKEND === "supabase");
      resolvePermissions();
      log("meta loaded", meta.tab, meta.headers?.length || 0, "role=", currentRole, "supabase=", useSupabase, "interviewers=", interviewerOptions.length, "trainers=", trainerOptions.length);
    } catch (e) {
      log("meta error", e.message);
    }
  }

  function buildShell() {
    return `
      <div class="interview-shell">
        <div class="interview-header">
          <h2>Interviews</h2>
          <div class="interview-actions">
            <button class="btn btn-secondary" data-action="refresh">Refresh</button>
          </div>
        </div>
        <div class="interview-toolbar">
          <input class="search" placeholder="Search candidates..." data-filter="search" />
          <select data-filter="firstInterviewStatus">
            <option value="">All 1st Int Status</option>
            ${STATUS_OPTIONS.map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>
          <select data-filter="secondInterviewStatus">
            <option value="">All 2nd Int Status</option>
            ${STATUS_OPTIONS.map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </div>
        <div class="table-wrap">
          <table class="data-table interview-main-table">
            <thead>
              <tr>
                <th>Submission Date</th>
                <th>Candidate Name</th>
                <th>Phone Number</th>
                <th>1st Int Status</th>
                <th>2nd Int Status</th>
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
      if (action === "view") openViewModal(root, btn.dataset.id);
      if (action === "edit") openEditModal(root, btn.dataset.id);
      if (action === "delete") deleteRow(root, btn.dataset.id);
      if (action === "cancel") window.closeModal();
      if (action === "save-edit") saveEdit(root);
      if (action === "add-feedback") openFeedbackModal(root, btn.dataset.id);
      if (action === "save-feedback") saveFeedback(root);
    });
    root.addEventListener("input", (e) => {
      const target = e.target;
      if (target.matches("[data-filter]")) applyFilters(root);
      if (target.closest(".interview-modal-root")) debounceSave(root);
    });
    root.addEventListener("change", (e) => {
      const target = e.target;
      if (target.matches("[data-filter]")) applyFilters(root);
      if (target.closest(".interview-modal-root")) {
        debounceSave(root);
        const modal = target.closest(".interview-modal-root");
        updateTrainingVisibility(modal);
        if (target.matches("[data-field='trainingStartDate']")) {
          syncTrainingStatusFromDate(modal);
        }
      }
    });
    root.addEventListener("focusout", (e) => {
      const target = e.target;
      if (target.closest(".interview-modal-root")) debounceSave(root, 400);
    });
  }

  function updateTrainingVisibility(rootOrModal) {
    const modals = rootOrModal.matches && rootOrModal.matches(".interview-modal-root")
      ? [rootOrModal]
      : rootOrModal.querySelectorAll(".interview-modal-root");
    modals.forEach((modal) => {
      const statusEl = modal.querySelector("[data-field='secondInterviewStatus']") || modal.querySelector("[data-field='firstInterviewStatus']");
      if (!statusEl) return;
      const status = String(statusEl.value || statusEl.textContent || "").trim().toLowerCase();
      const isAccepted = status === "accepted";
      const trainingSection = modal.querySelector(".training-section");
      if (trainingSection) {
        trainingSection.classList.toggle("hidden", !isAccepted);
      }
    });
  }

  function computeTrainingStatus(startDate, currentStatus) {
    const status = String(currentStatus || "").toLowerCase();
    if (status === "no show no call" || status === "on hold") return "on hold";
    if (["dropped", "postponed", "cancelled"].includes(status)) return currentStatus;
    if (!startDate) return "waiting";
    const today = new Date();
    const start = new Date(startDate);
    if (isNaN(start.getTime())) return "waiting";
    const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0) return "started";
    return "waiting";
  }

  function parseAvailableDays(value) {
    return String(value || "")
      .split(/[,;]+/)
      .map((d) => d.trim())
      .filter(Boolean);
  }

  function formatAvailableDays(days) {
    return (days || []).join(", ");
  }

  function renderAvailableDaysInput(key, value) {
    const selected = new Set(parseAvailableDays(value));
    return `<div class="day-checkbox-grid" data-field="${key}">${DAY_OPTIONS.map((day) => {
      const checked = selected.has(day) ? "checked" : "";
      return `<label class="day-checkbox"><input type="checkbox" value="${escapeHtml(day)}" ${checked} /> ${escapeHtml(day)}</label>`;
    }).join("")}</div>`;
  }

  function renderRatingSelect(key, value) {
    const options = ['<option value="">—</option>', ...RATING_OPTIONS.map((n) => {
      const sel = String(value) === n ? "selected" : "";
      return `<option value="${n}" ${sel}>${n}</option>`;
    })];
    return `<select data-field="${key}" class="rating-scale">${options.join("")}</select>`;
  }

  function syncTrainingStatusFromDate(modal) {
    const dateEl = modal.querySelector("[data-field='trainingStartDate']");
    const statusEl = modal.querySelector("[data-field='trainingStatus']");
    if (!dateEl || !statusEl || statusEl.disabled) return;
    const computed = computeTrainingStatus(dateEl.value, statusEl.value);
    if (computed && statusEl.options) {
      for (const opt of statusEl.options) {
        if (String(opt.value).toLowerCase() === String(computed).toLowerCase()) {
          statusEl.value = opt.value;
          break;
        }
      }
    }
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
      const res = await fetch("/api/interview/interviews");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allRows = data.rows || [];
      if (data.canEditInterview != null) meta = { ...(meta || {}), canEditInterview: data.canEditInterview, canDeleteInterview: data.canDeleteInterview };
      resolvePermissions();
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
    const timestamp = r?.Timestamp || r?.timestamp || "";
    const name = r?.Name || r?.name || "";
    const phone = r?.Phone || r?.phone || "";
    const firstStatus = r?.["1st Int Status"] || r?.firstInterviewStatus || r?.Status || r?.status || "";
    const secondStatus = r?.["2nd Int Status"] || r?.secondInterviewStatus || "";
    return { timestamp, name, phone, firstStatus, secondStatus };
  }

  function renderTable(root) {
    const thead = root.querySelector("thead");
    const tbody = root.querySelector("tbody");
    if (!thead || !tbody) return;
    const search = (root.querySelector('[data-filter="search"]')?.value || "").toLowerCase();
    const firstStatusFilter = (root.querySelector('[data-filter="firstInterviewStatus"]')?.value || "").toLowerCase();
    const secondStatusFilter = (root.querySelector('[data-filter="secondInterviewStatus"]')?.value || "").toLowerCase();
    const filtered = allRows.filter((r) => {
      const essential = getEssentialRow(r);
      const matchSearch = !search || Object.values(essential).some((v) => String(v || "").toLowerCase().includes(search));
      const matchFirstStatus = !firstStatusFilter || String(r?.firstInterviewStatus || r?.["1st Int Status"] || r?.Status || r?.status || "").toLowerCase() === firstStatusFilter;
      const matchSecondStatus = !secondStatusFilter || String(r?.secondInterviewStatus || r?.["2nd Int Status"] || "").toLowerCase() === secondStatusFilter;
      return matchSearch && matchFirstStatus && matchSecondStatus;
    });
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No interviews found.</td></tr>`;
      return;
    }
    tbody.innerHTML = filtered
      .map((r) => {
        const essential = getEssentialRow(r);
        const rowId = r?.id || "";
        const rowFirstStatus = essential.firstStatus || "pending";
        const rowSecondStatus = essential.secondStatus || "pending";
        const firstStatusClass = rowFirstStatus ? `status-${String(rowFirstStatus).toLowerCase().replace(/\s+/g, "-")}` : "";
        const secondStatusClass = rowSecondStatus ? `status-${String(rowSecondStatus).toLowerCase().replace(/\s+/g, "-")}` : "";
        return `<tr data-id="${rowId}" class="${firstStatusClass}">
          <td>${escapeHtml(essential.timestamp)}</td>
          <td>${escapeHtml(essential.name)}</td>
          <td>${escapeHtml(essential.phone)}</td>
          <td><span class="badge">${escapeHtml(rowFirstStatus)}</span></td>
          <td><span class="badge">${escapeHtml(rowSecondStatus)}</span></td>
          <td class="actions-col">
            <div class="btn-row">
              <button class="btn btn-outline btn-sm" data-action="view" data-id="${rowId}" aria-label="View">View</button>
              ${canEditInterviews && !isTrainer() ? `<button class="btn btn-primary btn-sm" data-action="edit" data-id="${rowId}" aria-label="Edit">Edit</button>` : ""}
              <button class="btn btn-primary btn-sm" data-action="add-feedback" data-id="${rowId}" aria-label="Feedback">Feedback</button>
              ${canDeleteInterviews && !isTrainer() ? `<button class="btn btn-danger btn-sm" data-action="delete" data-id="${rowId}" aria-label="Delete">Delete</button>` : ""}
            </div>
          </td>
        </tr>`;
      })
      .join("");
  }

  function applyFilters(root) {
    renderTable(root);
  }

  function getRowById(id) {
    return allRows.find((r) => r?.id === id) || null;
  }

  function openViewModal(root, id) {
    const row = getRowById(id);
    if (!row) return;
    editingRowId = id;
    saveShouldClose = false;
    const fields = Object.entries(row).map(([key, value]) => {
      const normalizedKey = key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim();
      const displayKey = {
        dateOfBirth: "Date of Birth",
        graduationStatus: "Graduation status",
        facultyName: "Faculty Name",
        universityName: "University Name",
        nationalId: "National ID or Passport ID",
        previousExperiences: "Previous Experiences",
        englishSpeaking: "English Speaking",
        englishWriting: "English Writing",
        englishListening: "English Listening",
        fastPacedRating: "Fast-paced rating (1–5)",
        availableDays: "Available days",
        trainingStatus: "Training Status",
        currentlyEmployed: "Currently employed",
        preferredWorkingMode: "Preferred working mode",
        howHeard: "How did you hear about this job opening?",
        companyIfYes: "Company name if yes",
        interviewDate: "1st Interview Date",
        trainingStartDate: "Training Start Date",
        secondInterviewDate: "2nd Interview Date",
        secondInterviewFeedback: "2nd Interview Feedback",
        secondInterviewStatus: "2nd Interview Status",
        firstInterviewStatus: "1st Interview Status",
        firstInterviewFeedback: "1st Interview Feedback",
        batchNumber: "Batch Number",
        submittedBy: "Submitted By",
        interviewer: "Interviewer",
        trainer: "Trainer",
        secondInterviewer: "2nd Interviewer",
      }[key] || normalizedKey;

      const isDate = ["1st Interview Date", "Training Start Date", "2nd Interview Date"].includes(displayKey);
      const isSelect = ["1st Interview Status", "Training Status", "Interviewer", "Trainer", "2nd Interview Status", "2nd Interviewer", "Graduation status"].includes(displayKey);
      const isEditableHr = false;
      let input = "";
      if (isSelect) {
        const rawOptions = {
          "1st Interview Status": STATUS_OPTIONS.map((o) => ({ value: o, label: o })),
          "Training Status": TRAINING_OPTIONS.map((o) => ({ value: o, label: o })),
          Interviewer: interviewerOptions.map((o) => ({ value: o.username, label: `${o.employeeId || o.username} (${o.name || o.username})` })),
          Trainer: trainerOptions.map((o) => ({ value: o.username, label: `${o.employeeId || o.username} (${o.name || o.username})` })),
          "2nd Interview Status": STATUS_OPTIONS.map((o) => ({ value: o, label: o })),
          "2nd Interviewer": interviewerOptions.map((o) => ({ value: o.username, label: `${o.employeeId || o.username} (${o.name || o.username})` })),
          "Graduation status": GRADUATION_OPTIONS.map((o) => ({ value: o, label: o })),
        }[displayKey] || [];
        const disabled = !isEditableHr ? "disabled" : "";
        const uniqueValues = [...new Set([value, ...rawOptions.map((o) => o.value)])];
        input = `<select data-field="${key}" ${disabled}>${uniqueValues.map((v) => {
          const opt = rawOptions.find((o) => o.value === v) || { value: v, label: v };
          return `<option value="${escapeHtml(opt.value)}" ${String(value) === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`;
        }).join("")}</select>`;
      } else if (isDate) {
        const disabled = !isEditableHr ? "disabled" : "";
        input = `<input type="date" data-field="${key}" value="${escapeHtml(value || "")}" ${disabled} />`;
      } else if (displayKey === "First Interview Feedback" || displayKey === "Second Interview Feedback") {
        input = `<textarea data-field="${key}" rows="5" ${!isEditableHr ? "disabled" : ""}>${escapeHtml(value || "")}</textarea>`;
      } else {
        input = `<span class="field-readonly">${escapeHtml(value || "—")}</span>`;
      }
      return `<div class="field"><span>${escapeHtml(displayKey)}</span>${input}</div>`;
    }).join("");
    window.openModal(`<div class="modal-header"><h2>View Interview</h2><button class="btn btn-sm" data-close>✕</button></div><div class="modal-body interview-modal-root"><div class="field-grid">${fields}</div><div class="form-actions"><button type="button" class="btn" data-close>Close</button></div></div>`, true);
    const modal = document.querySelector(".interview-modal-root:last-of-type");
    if (modal) {
      updateTrainingVisibility(modal);
      syncTrainingStatusFromDate(modal);
      const dateEl = modal.querySelector("[data-field='trainingStartDate']");
      if (dateEl) {
        dateEl.addEventListener("change", () => syncTrainingStatusFromDate(modal));
      }
    }
  }

  function openEditModal(root, id) {
    const row = getRowById(id);
    if (!row) return;
    editingRowId = id;
    saveShouldClose = true;
    const employeeFields = ["timestamp", "name", "email", "phone", "whatsapp", "dateOfBirth", "address", "graduationStatus", "facultyName", "universityName", "nationalId", "previousExperiences", "gender", "englishSpeaking", "englishWriting", "englishListening", "fastPacedRating", "availableDays", "currentlyEmployed", "preferredWorkingMode", "howHeard", "companyIfYes"];
    const hrFields = ["firstInterviewStatus", "firstInterviewFeedback", "interviewDate", "interviewer", "trainingStatus", "trainingStartDate", "trainer", "secondInterviewDate", "secondInterviewFeedback", "secondInterviewStatus", "secondInterviewer"];

    function renderField(key) {
      const value = row[key] || "";
      const normalizedKey = key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim();
      const displayKey = {
        dateOfBirth: "Date of Birth",
        graduationStatus: "Graduation status",
        facultyName: "Faculty Name",
        universityName: "University Name",
        nationalId: "National ID or Passport ID",
        previousExperiences: "Previous Experiences",
        englishSpeaking: "English Speaking",
        englishWriting: "English Writing",
        englishListening: "English Listening",
        fastPacedRating: "Fast-paced rating (1–5)",
        availableDays: "Available days",
        trainingStatus: "Training Status",
        currentlyEmployed: "Currently employed",
        preferredWorkingMode: "Preferred working mode",
        howHeard: "How did you hear about this job opening?",
        companyIfYes: "Company name if yes",
        interviewDate: "1st Interview Date",
        trainingStartDate: "Training Start Date",
        secondInterviewDate: "2nd Interview Date",
        secondInterviewFeedback: "2nd Interview Feedback",
        secondInterviewStatus: "2nd Interview Status",
        firstInterviewStatus: "1st Interview Status",
        firstInterviewFeedback: "1st Interview Feedback",
        batchNumber: "Batch Number",
        submittedBy: "Submitted By",
        interviewer: "Interviewer",
        trainer: "Trainer",
        secondInterviewer: "2nd Interviewer",
      }[key] || normalizedKey;

      const isDate = ["1st Interview Date", "Training Start Date", "2nd Interview Date"].includes(displayKey);
      const isSelect = ["1st Interview Status", "Training Status", "Interviewer", "Trainer", "2nd Interview Status", "2nd Interviewer", "Graduation status"].includes(displayKey);
      const isLongText = ["1st Interview Feedback", "2nd Interview Feedback", "Previous Experiences", "Address", "Company if yes"].includes(displayKey);
      let input = "";
      if (key === "fastPacedRating") {
        input = renderRatingSelect(key, value);
      } else if (key === "availableDays") {
        input = renderAvailableDaysInput(key, value);
      } else if (isSelect) {
        const rawOptions = {
          "1st Interview Status": STATUS_OPTIONS.map((o) => ({ value: o, label: o })),
          "Training Status": TRAINING_OPTIONS.map((o) => ({ value: o, label: o })),
          Interviewer: interviewerOptions.map((o) => ({ value: o.username, label: `${o.employeeId || o.username} (${o.name || o.username})` })),
          Trainer: trainerOptions.map((o) => ({ value: o.username, label: `${o.employeeId || o.username} (${o.name || o.username})` })),
          "2nd Interview Status": STATUS_OPTIONS.map((o) => ({ value: o, label: o })),
          "2nd Interviewer": interviewerOptions.map((o) => ({ value: o.username, label: `${o.employeeId || o.username} (${o.name || o.username})` })),
          "Graduation status": GRADUATION_OPTIONS.map((o) => ({ value: o, label: o })),
        }[displayKey] || [];
        const uniqueValues = [...new Set([value, ...rawOptions.map((o) => o.value)])];
        input = `<select data-field="${key}"><option value="">—</option>${uniqueValues.map((v) => {
          const opt = rawOptions.find((o) => o.value === v) || { value: v, label: v };
          return `<option value="${escapeHtml(opt.value)}" ${String(value) === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`;
        }).join("")}</select>`;
      } else if (isDate) {
        input = `<input type="date" data-field="${key}" value="${escapeHtml(value || "")}" />`;
      } else if (isLongText) {
        input = `<textarea data-field="${key}" rows="5">${escapeHtml(value || "")}</textarea>`;
      } else {
        input = `<input type="text" data-field="${key}" value="${escapeHtml(value || "")}" />`;
      }
      return `<label class="field"><span>${escapeHtml(displayKey)}</span>${input}</label>`;
    }

    const employeeSection = employeeFields.map(renderField).join("");
    const secondInterviewFields = ["secondInterviewDate", "secondInterviewFeedback", "secondInterviewStatus", "secondInterviewer"];
    const secondInterviewSection = `<div class="form-section second-interview-section" id="second-interview-section" style="display:none;"><h3>Second Interview</h3>${secondInterviewFields.map(renderField).join("")}</div>`;
    const trainingFields = ["trainingStatus", "trainingStartDate", "trainer"];
    const trainingSection = `<div class="form-section training-section" id="training-section" style="display:none;"><h3>Training</h3>${trainingFields.map(renderField).join("")}</div>`;
    const firstInterviewFields = hrFields.filter((f) => !f.startsWith("second") && !trainingFields.includes(f));
    const hrSection = `<div class="form-section"><h3>First Interview</h3>${firstInterviewFields.map(renderField).join("")}</div>${secondInterviewSection}${trainingSection}`;

    window.openModal(`<div class="modal-header"><h2>Edit Interview</h2><button class="btn btn-sm" data-close>✕</button></div><form id="interview-edit-form" class="form-grid modal-body-scroll interview-modal-root"><div class="form-section"><h3>Candidate Information</h3>${employeeSection}</div>${hrSection}<div class="form-actions"><button type="submit" class="btn btn-primary" data-action="save-edit">Save</button><button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button></div></form>`, true);
    const form = document.getElementById("interview-edit-form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        saveEdit(root);
      });
      const modal = form.closest(".interview-modal-root");
      if (modal) {
        const firstStatusEl = modal.querySelector("[data-field='firstInterviewStatus']");
        const secondStatusEl = modal.querySelector("[data-field='secondInterviewStatus']");
        const secondSection = modal.querySelector("#second-interview-section");
        const trainingSectionEl = modal.querySelector("#training-section");
        const updateSecondInterviewVisibility = () => {
          if (!firstStatusEl || !secondSection) return;
          const status = String(firstStatusEl.value || "").toLowerCase();
          secondSection.style.display = status === "accepted" ? "block" : "none";
        };
        const updateTrainingVisibility = () => {
          if (!secondStatusEl || !trainingSectionEl) return;
          const status = String(secondStatusEl.value || "").toLowerCase();
          trainingSectionEl.style.display = status === "accepted" ? "block" : "none";
        };
        if (firstStatusEl) {
          firstStatusEl.addEventListener("change", () => {
            updateSecondInterviewVisibility();
            updateTrainingVisibility();
          });
        }
        if (secondStatusEl) {
          secondStatusEl.addEventListener("change", updateTrainingVisibility);
        }
        updateSecondInterviewVisibility();
        updateTrainingVisibility();
        syncTrainingStatusFromDate(modal);
        const dateEl = modal.querySelector("[data-field='trainingStartDate']");
        if (dateEl) {
          dateEl.addEventListener("change", () => syncTrainingStatusFromDate(modal));
        }
      }
    }
  }

  async function saveEdit(root) {
    if (!editingRowId) return;
    const form = document.getElementById("interview-edit-form");
    if (!form) return;
    const payload = {};
    form.querySelectorAll("[data-field]").forEach((el) => {
      const field = el.dataset.field;
      if (!field) return;
      if (el.classList.contains("day-checkbox-grid")) {
        const checked = [...el.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value);
        payload[field] = formatAvailableDays(checked);
        return;
      }
      if (el.tagName === "SELECT") payload[field] = el.value;
      else if (el.tagName === "INPUT") payload[field] = el.value;
      else if (el.tagName === "TEXTAREA") payload[field] = el.value;
    });
    try {
      const url = useSupabase
        ? `/api/interview/interviews/${encodeURIComponent(editingRowId)}`
        : `/api/interview/interviews/${encodeURIComponent(editingRowId)}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to save");
        return;
      }
      if (saveShouldClose) {
        window.closeModal();
      }
      refresh(root, true);
    } catch (e) {
      alert("Save failed: " + e.message);
    }
  }

  async function deleteRow(root, id) {
    if (!confirm("Delete this interview?")) return;
    try {
      const res = await fetch(`/api/interview/interviews/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to delete");
        return;
      }
      refresh(root, true);
    } catch (e) {
      alert("Delete failed: " + e.message);
    }
  }

  function openFeedbackModal(root, id) {
    const row = getRowById(id);
    if (!row) return;
    const candidateName = row?.Name || row?.name || "";
    const candidateEmail = row?.Email || row?.email || "";
    const isAccepted = String(row?.secondInterviewStatus || "").toLowerCase() === "accepted";
    if (!isAccepted) {
      alert("Feedback is only available for candidates who passed the second interview.");
      return;
    }
    const trainer = currentRole || "";
    const days = [1, 2, 3, 4, 5];
    const dayInputs = days.map((day) => `
      <div class="feedback-day">
        <label><span>Day ${day}</span><input type="date" data-day="${day}" data-field="date" /></label>
        <label style="grid-column:1/-1"><span>Feedback</span><textarea data-day="${day}" data-field="text" rows="3" placeholder="Daily feedback for day ${day}..."></textarea></label>
      </div>
    `).join("");
    window.openModal(`<div class="modal-header"><h2>Training Feedback - ${escapeHtml(candidateName)}</h2><button class="btn btn-sm" data-close>✕</button></div><form id="feedback-form" class="form-grid modal-body-scroll interview-modal-root"><input type="hidden" data-field="candidateId" value="${escapeHtml(id)}" /><input type="hidden" data-field="candidateName" value="${escapeHtml(candidateName)}" /><input type="hidden" data-field="candidateEmail" value="${escapeHtml(candidateEmail)}" /><input type="hidden" data-field="trainer" value="${escapeHtml(trainer)}" />${dayInputs}<div class="form-actions"><button type="submit" class="btn btn-primary" data-action="save-feedback">Save Feedback</button><button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button></div></form>`, true);
  }

  async function saveFeedback(root) {
    const form = document.getElementById("feedback-form");
    if (!form) return;
    const candidateId = form.querySelector('[data-field="candidateId"]')?.value || "";
    const candidateName = form.querySelector('[data-field="candidateName"]')?.value || "";
    const candidateEmail = form.querySelector('[data-field="candidateEmail"]')?.value || "";
    const trainer = form.querySelector('[data-field="trainer"]')?.value || "";
    const days = [1, 2, 3, 4, 5];
    const promises = days.map(async (day) => {
      const dateEl = form.querySelector(`[data-day="${day}"][data-field="date"]`);
      const textEl = form.querySelector(`[data-day="${day}"][data-field="text"]`);
      const date = dateEl?.value || "";
      const text = textEl?.value || "";
      if (!text.trim() && !date) return;
      const payload = {
        candidateId,
        candidateName,
        candidateEmail,
        day: String(day),
        feedbackText: text,
        trainer,
        date,
      };
      const res = await fetch("/api/interview/feedbacks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        log("feedback save error day", day, err.error);
      }
    });
    await Promise.all(promises);
    window.closeModal();
    alert("Feedback saved successfully.");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function debounceSave(root, delay = 800) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveEdit(root);
    }, delay);
  }

  return { init, startSync, stopSync };
})();
