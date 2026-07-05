/**
 * Sales management UI.
 */
window.SalesModule = (function () {
  const CLIENT_STATUS_OPTIONS = [
    "Passed",
    "Dropped",
    "Chargeback",
    "Duplicate",
    "Retransfer",
    "Pending bank approval",
    "Processed",
  ];
  const REVIEWER_STATUS_OPTIONS = [
    "Sale done",
    "Postdated",
    "Pending bank approval",
    "On hold",
    "Rejected",
    "Callback",
  ];
  const SALES_UNITS = ["HS-1", "HS-2", "HS-3"];
  const PERIOD_LABELS = { day: "Day", week: "Week", month: "Month" };

  function deviceLabel(device) {
    const key = String(device || "").toLowerCase();
    const map = { smartwatch: "Smartwatch", bracelet: "Bracelet", necklace: "Necklace" };
    return map[key] || (device ? String(device) : "—");
  }

  function formatEgyptDateTime(date = new Date()) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  }

  const PAYMENT_SUBMIT_FIELDS = [
    { key: "paymentMethod", label: "Payment method", section: "payment", type: "select", options: ["Bank account", "Card"], selectPlaceholder: true },
    { key: "routingNumber", label: "Routing number", section: "payment", type: "text", bankField: true },
    { key: "bankName", label: "Bank name", section: "payment", type: "text", bankField: true },
    { key: "bankAccountNumber", label: "Bank account number", section: "payment", type: "text", bankField: true },
    { key: "bankAddress", label: "Bank address", section: "payment", type: "text", bankField: true },
    {
      key: "bankAccountChosenBy",
      label: "Who chose bank account",
      section: "payment",
      type: "employee",
      employeeFilter: "all",
      bankField: true,
    },
    { key: "cardType", label: "Card Type", section: "payment", type: "text", cardField: true },
    { key: "cardNumber", label: "Card Number", section: "payment", type: "text", cardField: true },
    { key: "cardExpDate", label: "Card Exp Date", section: "payment", type: "text", cardField: true, placeholder: "MM/YY" },
    { key: "cvv", label: "CVV", section: "payment", type: "text", cardField: true, inputMode: "numeric", maxLength: 4 },
  ];

  const VERIFIER_FEEDBACK_OPTIONS = [
    "Sale done",
    "Postdated",
    "Pending bank approval",
    "On hold",
    "Rejected",
    "Callback",
  ];

  const CLIENT_FEEDBACK_OPTIONS = [
    "Passed",
    "Dropped",
    "Chargeback",
    "Duplicate",
    "Retransfer",
    "Pending bank approval",
    "Processed",
  ];

  function formatTimeAmPm(timeStr) {
    const m = String(timeStr || "").match(/^(\d{1,2}):(\d{2})/);
    if (!m) return timeStr || "";
    let h = parseInt(m[1], 10);
    const mi = m[2];
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${mi} ${ampm}`;
  }

  function defaultListColumns() {
    return [
      { columnKey: "workingDay", label: "Day" },
      { columnKey: "submissionTime", label: "Time" },
      { columnKey: "client", label: "Client" },
      { columnKey: "customer", label: "Customer" },
      { columnKey: "device", label: "Device" },
      { columnKey: "agent", label: "Agent" },
      { columnKey: "verifierFeedback", label: "Reviewer status" },
      { columnKey: "clientFeedback", label: "Client status" },
      { columnKey: "price", label: "Price" },
    ];
  }

  function renderSaleListCell(colKey, sale, empById, escapeHtml, fmt) {
    const agent = empById.get(sale.agentId);
    const agentName = agent ? agent.american_name || sale.agentId : sale.agentId;
    const fd = sale.formData || {};
    switch (colKey) {
      case "workingDay":
        return escapeHtml(sale.workingDay || String(sale.submissionDate || "").slice(0, 10) || sale.effectiveDate || "—");
      case "submissionTime":
        return escapeHtml(formatTimeAmPm(sale.submissionTime || ""));
      case "client":
        return escapeHtml(sale.client || fd.client || "—");
      case "customer":
        return `<strong>${escapeHtml(sale.fullName || "—")}</strong><br><span class="muted">${escapeHtml(sale.phoneNumber || "")}</span>`;
      case "device":
      case "deviceType":
        return escapeHtml(deviceLabel(sale.device || fd.deviceType));
      case "agent":
      case "agentName":
        return `${escapeHtml(sale.agentId || "—")}<br><span class="muted">${escapeHtml(agentName || "")}</span>`;
      case "closer":
      case "closerName": {
        const closer = empById.get(sale.closerId);
        return `${escapeHtml(sale.closerId || "—")}<br><span class="muted">${escapeHtml(closer?.american_name || "")}</span>`;
      }
      case "team":
        return escapeHtml(sale.team || fd.team || "—");
      case "unit":
        return escapeHtml(sale.unit || fd.unit || "—");
      case "status":
        return `<span class="badge">${escapeHtml(sale.status || "")}</span>`;
      case "verifierFeedback":
        return escapeHtml(fd.verifierFeedback || "—");
      case "clientFeedback":
        return escapeHtml(fd.clientFeedback || "—");
      case "price":
        return sale.price != null ? fmt(sale.price) : fd.price != null ? fmt(fd.price) : "—";
      case "assignVerifier":
      case "reviewer":
      case "bankAccountChosenBy": {
        const id = fd[colKey] || sale[colKey] || "";
        const emp = empById.get(id);
        return id ? `${escapeHtml(id)}<br><span class="muted">${escapeHtml(emp?.american_name || "")}</span>` : "—";
      }
      case "firstName":
      case "lastName":
        return escapeHtml(fd[colKey] || sale[colKey] || "—");
      case "phoneNumber":
        return escapeHtml(sale.phoneNumber || fd.phoneNumber || "—");
      default:
        return escapeHtml(fd[colKey] ?? sale[colKey] ?? "—");
    }
  }

  function loadAdvancedFilter() {
    try {
      const raw = localStorage.getItem("hr_sales_advanced_filter");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveAdvancedFilter(filter) {
    if (!filter) localStorage.removeItem("hr_sales_advanced_filter");
    else localStorage.setItem("hr_sales_advanced_filter", JSON.stringify(filter));
  }

  function advancedFilterRuleIsNoOp(rule) {
    if (!rule) return true;
    const op = String(rule.op || "IS").toUpperCase();
    if (op === "IS EMPTY" || op === "IS NOT EMPTY") return false;
    if (op === "ON" || op === "BEFORE" || op === "AFTER") return !String(rule.value ?? "").trim();
    const targets = Array.isArray(rule.value) ? rule.value : [rule.value];
    return targets.every((t) => !String(t ?? "").trim());
  }

  function normalizeAdvancedFilter(filter) {
    if (!filter?.rules?.length) return null;
    const rules = filter.rules.filter((r) => !advancedFilterRuleIsNoOp(r));
    if (!rules.length) return null;
    return { ...filter, rules };
  }

  function buildAdvancedFilterFields(catalogFields) {
    const base = [
      { key: "agentId", label: "Agent ID", valueType: "employee", employeeFilter: "dialing" },
      { key: "closerId", label: "Closer ID", valueType: "employee", employeeFilter: "all" },
      { key: "client", label: "Client", valueType: "client" },
      { key: "device", label: "Device", valueType: "select", options: ["bracelet", "necklace", "smartwatch"] },
      { key: "team", label: "Team", valueType: "team" },
      { key: "unit", label: "Unit", valueType: "select", options: ["HS-1", "HS-2", "HS-3", "HS-Back-End", "HS-MGMT"] },
      { key: "status", label: "Status", valueType: "select", options: ["passed", "pending", "postdated", "denied", "callback"] },
      { key: "customer", label: "Customer name", valueType: "text" },
      { key: "phoneNumber", label: "Phone", valueType: "text" },
      { key: "workingDay", label: "Working day", valueType: "date" },
      { key: "assignVerifier", label: "Verifier", valueType: "employee", employeeFilter: "verifiers" },
      { key: "reviewer", label: "Reviewer", valueType: "employee", employeeFilter: "reviewers" },
      { key: "verifierFeedback", label: "Reviewer status", valueType: "select", options: REVIEWER_STATUS_OPTIONS },
      { key: "clientFeedback", label: "Client status", valueType: "select", options: CLIENT_STATUS_OPTIONS },
      { key: "paymentMethod", label: "Payment method", valueType: "select", options: ["Bank account", "Card"] },
    ];
    const seen = new Set(base.map((b) => b.key));
    for (const f of catalogFields || []) {
      if (seen.has(f.key)) continue;
      if (f.type === "select" && f.options?.length) {
        base.push({ key: f.key, label: f.label || f.key, valueType: "select", options: f.options });
      } else if (f.type === "employee") {
        base.push({ key: f.key, label: f.label || f.key, valueType: "employee", employeeFilter: f.employeeFilter || "all" });
      } else if (f.type !== "textarea" && f.type !== "datetime") {
        base.push({ key: f.key, label: f.label || f.key, valueType: "text" });
      }
      seen.add(f.key);
    }
    return base;
  }

  function filterValueControlHtml(fieldDef, value, employees, clients, teams, escapeHtml) {
    const val = value || "";
    const hideForEmpty = (op) => op === "IS EMPTY" || op === "IS NOT EMPTY";
    if (fieldDef.valueType === "employee") {
      const opts = employeeSelectOptions(employees, escapeHtml, val, fieldDef.employeeFilter || "all");
      return `<select class="sf-val">${opts}</select>`;
    }
    if (fieldDef.valueType === "client") {
      const opts =
        '<option value="">— Any —</option>' +
        (clients || [])
          .map((c) => `<option value="${escapeHtml(c.name)}" ${val === c.name ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
          .join("");
      return `<select class="sf-val">${opts}</select>`;
    }
    if (fieldDef.valueType === "team") {
      const opts =
        '<option value="">— Any —</option>' +
        (teams || [])
          .map((t) => `<option value="${escapeHtml(t)}" ${val === t ? "selected" : ""}>${escapeHtml(t)}</option>`)
          .join("");
      return `<select class="sf-val">${opts}</select>`;
    }
    if (fieldDef.valueType === "select") {
      const opts =
        '<option value="">— Any —</option>' +
        (fieldDef.options || [])
          .map((o) => `<option value="${escapeHtml(o)}" ${val === o ? "selected" : ""}>${escapeHtml(o)}</option>`)
          .join("");
      return `<select class="sf-val">${opts}</select>`;
    }
    if (fieldDef.valueType === "date") {
      return `<input class="sf-val" type="date" value="${escapeHtml(val)}" />`;
    }
    return `<input class="sf-val" type="text" value="${escapeHtml(val)}" placeholder="Value" style="min-width:8rem" />`;
  }

  function advancedFilterPanelHtml(escapeHtml, filterFields, employees, clients, teams) {
    const f = state.salesAdvancedFilter || loadAdvancedFilter() || { op: "AND", rules: [{ field: "agentId", op: "IS", value: "" }] };
    const rules = f.rules?.length ? f.rules : [{ field: "agentId", op: "IS", value: "" }];
    const showLogic = rules.length > 1;
    const fieldMap = Object.fromEntries(filterFields.map((x) => [x.key, x]));
    const rulesHtml = rules
      .map((r, i) => {
        const fieldDef = fieldMap[r.field] || filterFields[0];
        return `<div class="sales-filter-rule" data-idx="${i}" style="display:flex;gap:.35rem;flex-wrap:wrap;align-items:center;margin:.35rem 0">
          <select class="sf-field">${filterFields.map((x) => `<option value="${x.key}" ${r.field === x.key ? "selected" : ""}>${escapeHtml(x.label)}</option>`).join("")}</select>
          <select class="sf-op"><option value="IS" ${r.op === "IS" ? "selected" : ""}>IS</option><option value="IS NOT" ${r.op === "IS NOT" ? "selected" : ""}>IS NOT</option><option value="CONTAINS" ${r.op === "CONTAINS" ? "selected" : ""}>CONTAINS</option><option value="IS EMPTY" ${r.op === "IS EMPTY" ? "selected" : ""}>IS EMPTY</option><option value="IS NOT EMPTY" ${r.op === "IS NOT EMPTY" ? "selected" : ""}>IS NOT EMPTY</option></select>
          ${filterValueControlHtml(fieldDef, r.value, employees, clients, teams, escapeHtml)}
          <button type="button" class="btn btn-sm sf-remove">✕</button>
        </div>`;
      })
      .join("");
    return `<details class="card card-flat sales-advanced-filter" style="margin-bottom:1rem;padding:.75rem 1rem">
      <summary><strong>Advanced filter</strong> <span class="muted">(AND / OR / NOT)</span></summary>
      <div style="margin-top:.75rem">
        <div id="sf-rules">${rulesHtml}</div>
        <div id="sf-logic-wrap" class="${showLogic ? "" : "hidden"}" style="margin-top:.5rem">
          <label class="field field-inline"><span>Combine rules with</span>
            <select id="sf-logic"><option value="AND" ${f.op === "AND" ? "selected" : ""}>AND (all match)</option><option value="OR" ${f.op === "OR" ? "selected" : ""}>OR (any match)</option><option value="NOT" ${f.op === "NOT" ? "selected" : ""}>NOT (exclude matches)</option></select>
          </label>
        </div>
        <div class="btn-row" style="margin-top:.5rem">
          <button type="button" class="btn btn-sm" id="sf-add-rule">+ Rule</button>
          <button type="button" class="btn btn-sm btn-primary" id="sf-apply">Apply filter</button>
          <button type="button" class="btn btn-sm" id="sf-clear">Clear</button>
        </div>
      </div>
    </details>`;
  }

  function bindAdvancedFilter(root, rerender, filterFields, employees, clients, teams, escapeHtml) {
    root.querySelectorAll(".sf-field").forEach((sel) => {
      sel.addEventListener("change", () => {
        const row = sel.closest(".sales-filter-rule");
        const fieldDef = filterFields.find((x) => x.key === sel.value) || filterFields[0];
        const valWrap = row.querySelector(".sf-val")?.parentElement;
        const oldVal = row.querySelector(".sf-val")?.value || "";
        const tmp = document.createElement("div");
        tmp.innerHTML = filterValueControlHtml(fieldDef, oldVal, employees, clients, teams, escapeHtml);
        row.querySelector(".sf-val")?.replaceWith(tmp.firstElementChild);
      });
    });
    root.querySelector("#sf-add-rule")?.addEventListener("click", () => {
      const cur = state.salesAdvancedFilter || loadAdvancedFilter() || { op: "AND", rules: [] };
      cur.rules = cur.rules || [];
      cur.rules.push({ field: "agentId", op: "IS", value: "" });
      state.salesAdvancedFilter = cur;
      rerender();
    });
    root.querySelector("#sf-clear")?.addEventListener("click", () => {
      state.salesAdvancedFilter = null;
      saveAdvancedFilter(null);
      rerender();
    });
    root.querySelector("#sf-apply")?.addEventListener("click", () => {
      const rules = [];
      root.querySelectorAll(".sales-filter-rule").forEach((row) => {
        rules.push({
          field: row.querySelector(".sf-field")?.value,
          op: row.querySelector(".sf-op")?.value,
          value: row.querySelector(".sf-val")?.value,
        });
      });
      const op = rules.length > 1 ? root.querySelector("#sf-logic")?.value || "AND" : "AND";
      const normalized = normalizeAdvancedFilter({ op, rules });
      state.salesAdvancedFilter = normalized;
      saveAdvancedFilter(normalized);
      rerender();
    });
    root.querySelectorAll(".sf-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.closest(".sales-filter-rule")?.dataset.idx);
        const cur = state.salesAdvancedFilter || loadAdvancedFilter() || { op: "AND", rules: [] };
        cur.rules.splice(idx, 1);
        if (!cur.rules.length) cur.rules.push({ field: "agentId", op: "IS", value: "" });
        state.salesAdvancedFilter = cur;
        rerender();
      });
    });
  }

  function canToggleSalesUnits() {
    return state.user?.canViewDashboardUnits === true;
  }

  function canApprove() {
    return state.user?.canApproveSales === true;
  }

  function canEdit() {
    return state.user?.canEditSales === true;
  }

  function canSubmit() {
    return state.user?.canSubmitSales === true;
  }

  function canManagePermissions() {
    return state.user?.canManageSalesFieldPermissions === true || state.user?.canViewSalesAdmin === true;
  }

  function canExportSalesList() {
    return state.user?.canExportSales === true;
  }

  function isQualityAgent() {
    return state.user?.role === "quality";
  }

  function canFullEditSale() {
    return state.user?.canEditSales === true;
  }

  function canWorkQualityTicket() {
    return state.user?.canWorkQualityTicket === true;
  }

  function defaultQualityAttachKinds() {
    return [
      { key: "recording", label: "Recordings", canView: true, canEdit: false },
      { key: "raw_call", label: "Raw call record", canView: true, canEdit: false },
      { key: "quality_record", label: "Quality Record", canView: true, canEdit: false },
      { key: "receipt", label: "Receipt Attachment", canView: true, canEdit: false },
      { key: "confirmation", label: "Confirmation", canView: true, canEdit: false },
    ];
  }

  async function wireSaleAttachmentsList(container, saleId, api, attachKinds, openSaleAttachment, canManageFiles, opts = {}) {
    if (!container || !saleId) return;
    const res = await api(`/sales/${saleId}/attachments`).catch(() => ({ attachments: [] }));
    const list = res.attachments || [];
    const viewKinds = new Set((attachKinds || []).filter((k) => k.canView).map((k) => k.key));
    const visible = list.filter((a) => !a.kind || !viewKinds.size || viewKinds.has(a.kind));
    const kindLabel = Object.fromEntries((attachKinds || []).map((k) => [k.key, k.label]));
    if (!visible.length) {
      container.innerHTML = "<span class='muted'>No attachments yet</span>";
      return;
    }

    function isAudioName(name) {
      return /\.(mp3|wav|m4a|ogg|webm|aac)$/i.test(String(name || ""));
    }
    function isImageName(name) {
      return /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(name || ""));
    }
    function isPdfName(name) {
      return /\.pdf$/i.test(String(name || ""));
    }

    container.innerHTML = visible
      .map((a) => {
        const kind = kindLabel[a.kind] || a.kind || "file";
        const inlineAudio =
          opts.inlineAudio && isAudioName(a.fileName)
            ? `<audio controls preload="metadata" class="sale-inline-audio" data-inline-audio="${a.id}" data-file-name="${escapeHtml(a.fileName || "")}" style="width:100%;max-width:420px;margin-top:.35rem"></audio><p class="muted sale-audio-err hidden" data-audio-err="${a.id}" style="font-size:.8rem;margin-top:.25rem"></p>`
            : "";
        const actions = window.HRSalesConfigBreaks?.attachmentRowHtml
          ? window.HRSalesConfigBreaks.attachmentRowHtml(a, escapeHtml, () => canManageFiles)
          : `<div class="adj-row"><button type="button" class="btn btn-sm btn-link" data-open-attach="${a.id}">${escapeHtml(a.fileName)}</button> <span class="muted">${escapeHtml(kind)}</span></div>`;
        return `<div class="attachment-kind-group" data-kind="${escapeHtml(a.kind || "")}">${actions}${inlineAudio}</div>`;
      })
      .join("");

    if (opts.inlineAudio) {
      const sessionId = typeof getSessionId === "function" ? getSessionId() : "";
      for (const el of container.querySelectorAll("[data-inline-audio]")) {
        const id = el.dataset.inlineAudio;
        const fileName = el.dataset.fileName || "";
        const errEl = container.querySelector(`[data-audio-err="${id}"]`);
        fetch(`/api/sales/attachments/${encodeURIComponent(id)}/file`, {
          headers: sessionId ? { "x-session-id": sessionId } : {},
        })
          .then(async (r) => {
            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              throw new Error(err.error || `Could not load audio (${r.status})`);
            }
            const blob = await r.blob();
            const mime = mimeFromAttachment(fileName, r.headers.get("content-type") || blob.type);
            const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
            el.src = URL.createObjectURL(typed);
            if (errEl) errEl.classList.add("hidden");
          })
          .catch((e) => {
            if (errEl) {
              errEl.textContent = e.message || "Playback failed";
              errEl.classList.remove("hidden");
            }
          });
      }
    }

    const safeOpenAttachment = async (attachId, name) => {
      try {
        await openSaleAttachment(attachId, name);
      } catch (e) {
        alert(e.message || "Could not open file");
      }
    };

    if (window.HRSalesConfigBreaks) {
      window.HRSalesConfigBreaks.wireAttachmentActions(container, api, safeOpenAttachment, () => canManageFiles);
    } else {
      container.querySelectorAll("[data-open-attach]").forEach((btn) => {
        btn.onclick = () => safeOpenAttachment(btn.dataset.openAttach, btn.textContent);
      });
    }
  }

  function buildAttachmentsBlock(attachKinds, isEdit, { forceShow = false } = {}) {
    if (!isEdit) return "";
    if (!attachKinds?.length && !forceShow) return "";
    const uploadKinds = attachKinds.filter((k) => k.canEdit);
    const viewKinds = attachKinds.filter((k) => k.canView);
    const uploadHtml = uploadKinds.length
      ? `<div class="attachment-upload-grid">${uploadKinds
          .map(
            (k) =>
              `<label class="field"><span>${escapeHtml(k.label)} — upload</span><input type="file" data-attach-kind="${k.key}" accept="audio/*,image/*,.pdf" /></label>`
          )
          .join("")}</div>`
      : "";
    const viewNote =
      viewKinds.length && !uploadKinds.length
        ? `<p class="muted">You can listen to recordings below. Upload is not available for your role.</p>`
        : viewKinds.some((k) => !k.canEdit)
          ? `<p class="muted">Open existing files below. Upload only where your role allows.</p>`
          : "";
    return `<div class="card card-flat sale-attachments-block" style="grid-column:1/-1">
      <h4>Attachments</h4>
      ${viewNote}
      ${uploadHtml}
      <div id="sale-attachments-list" class="sale-attachments-list muted">Loading…</div>
    </div>`;
  }

  function mimeFromAttachment(fileName, headerMime) {
    const mime = String(headerMime || "").split(";")[0].trim().toLowerCase();
    if (mime && mime !== "application/octet-stream") return mime;
    const ext = String(fileName || "").toLowerCase().match(/\.[^.]+$/)?.[0] || "";
    const map = {
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".m4a": "audio/mp4",
      ".ogg": "audio/ogg",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".pdf": "application/pdf",
    };
    return map[ext] || mime || "application/octet-stream";
  }

  async function openSaleAttachment(attachmentId, fileName) {
    const sessionId = typeof getSessionId === "function" ? getSessionId() : "";
    const res = await fetch(`/api/sales/attachments/${encodeURIComponent(attachmentId)}/file`, {
      headers: sessionId ? { "x-session-id": sessionId } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Could not open file");
    }
    const blob = await res.blob();
    const mime = mimeFromAttachment(fileName, res.headers.get("content-type") || blob.type);
    const typedBlob = blob.type === mime ? blob : new Blob([blob], { type: mime });
    const url = URL.createObjectURL(typedBlob);
    const title = escapeHtml(fileName || "Attachment");

    if (/^audio\//i.test(mime)) {
      openModal(
        `<div class="modal-header"><h2>${title}</h2><button class="btn btn-sm" data-close>✕</button></div>
        <div class="modal-body"><audio controls autoplay src="${url}" style="width:100%"></audio>
        <p class="muted" style="margin-top:.75rem">Cached on this PC for 48 hours after first open.</p></div>`
      );
    } else if (/^image\//i.test(mime)) {
      openModal(
        `<div class="modal-header"><h2>${title}</h2><button class="btn btn-sm" data-close>✕</button></div>
        <div class="modal-body attachment-preview"><img src="${url}" alt="${title}" style="max-width:100%;height:auto;border-radius:8px" /></div>`
      );
    } else if (mime === "application/pdf") {
      openModal(
        `<div class="modal-header"><h2>${title}</h2><button class="btn btn-sm" data-close>✕</button></div>
        <div class="modal-body attachment-preview"><iframe src="${url}" title="${title}" style="width:100%;height:70vh;border:0;border-radius:8px"></iframe></div>`,
        true
      );
    } else {
      window.open(url, "_blank");
    }
  }

  function monthEnd(ym) {
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${ym}-${String(last).padStart(2, "0")}`;
  }

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

  function shortDateLabel(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function weekRangeLabel(monday) {
    const sunday = shiftDate(monday, 6);
    return `${shortDateLabel(monday)} – ${shortDateLabel(sunday)}`;
  }

  function statSum(dashboard, key) {
    if (dashboard.totals?.[key] != null) return dashboard.totals[key];
    return (dashboard.groups || []).reduce((s, g) => s + (g[key] || 0), 0);
  }

  function countClientStatus(sales, value) {
    return sales.filter((s) => (s.formData?.clientFeedback || "") === value).length;
  }

  function listHasColumn(listColumns, key) {
    return (listColumns || []).some((c) => c.columnKey === key);
  }

  function feedbackFilterSelects(state, escapeHtml) {
    const clientOpts = CLIENT_STATUS_OPTIONS.map(
      (v) =>
        `<option value="${escapeHtml(v)}" ${state.salesClientFeedbackFilter === v ? "selected" : ""}>${escapeHtml(v)}</option>`
    ).join("");
    const revOpts = REVIEWER_STATUS_OPTIONS.map(
      (v) =>
        `<option value="${escapeHtml(v)}" ${state.salesVerifierFeedbackFilter === v ? "selected" : ""}>${escapeHtml(v)}</option>`
    ).join("");
    return `<select id="sales-client-feedback-filter" title="Client status"><option value="">All client statuses</option>${clientOpts}</select>
      <select id="sales-verifier-feedback-filter" title="Reviewer status"><option value="">All reviewer statuses</option>${revOpts}</select>`;
  }

  function employeeSelectOptions(employees, escapeHtml, selectedId = "", filter = "all") {
    let list = employees.slice();
    if (filter === "dialing") {
      const nonDialRoles = new Set([
        "quality",
        "hr",
        "rtm",
        "admin",
        "ceo",
        "finance",
        "it",
        "public_relations",
        "office_assistant",
      ]);
      list = list.filter((e) => {
        const id = String(e.id || "");
        if (/^(TL|CL|OP|HR|MG|OF|NW|RTM|quality)/i.test(id)) return false;
        const role = String(e.role || "").toLowerCase();
        if (nonDialRoles.has(role)) return false;
        return true;
      });
      if (state.user?.role === "quality" && state.user?.unit) {
        list = list.filter((e) => e.unit === state.user.unit);
      }
    } else if (filter === "leaders") {
      list = list.filter((e) => /^(TL|CL|OP|HR|quality|rtm)/i.test(String(e.id || "")) || ["quality", "rtm"].includes(String(e.role || "").toLowerCase()));
    } else if (filter === "quality") {
      list = list.filter((e) => /^(HR|quality|rtm|MG)/i.test(String(e.id || "")) || ["quality", "rtm", "hr", "admin", "ceo"].includes(String(e.role || "").toLowerCase()));
    } else if (filter === "reviewers") {
      list = list.filter((e) => {
        const id = String(e.id || "");
        const role = String(e.role || "").toLowerCase();
        const team = String(e.team || "").trim();
        const unit = String(e.unit || "").trim();
        if (team === "Quality" && role === "quality") return true;
        if (unit === "HS-Back-End") return true;
        if (role === "rtm" || /^RTM/i.test(id)) return true;
        return false;
      });
    } else if (filter === "verifiers") {
      list = list.filter((e) => {
        const id = String(e.id || "");
        const role = String(e.role || "").toLowerCase();
        if (/^(TL|CL|OP)/i.test(id)) return true;
        if (["quality", "rtm", "tl", "op"].includes(role)) return true;
        if (/^(HR|quality|rtm|MG)/i.test(id)) return true;
        return false;
      });
    }
    list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let html = '<option value="">— Select —</option>';
    for (const e of list) {
      const star =
        filter === "reviewers" && String(e.team || "") === "Quality" && String(e.role || "").toLowerCase() === "quality"
          ? " ★"
          : "";
      html += `<option value="${e.id}" ${selectedId === e.id ? "selected" : ""}>${e.id} — ${escapeHtml(e.american_name || e.id)}${star}</option>`;
    }
    return html;
  }

  function salesPersonFilters(employees, clients, escapeHtml, state) {
    const agentOpts = employeeSelectOptions(employees, escapeHtml, state.salesAgentFilter || "", "dialing");
    const closerOpts = employeeSelectOptions(employees, escapeHtml, state.salesCloserFilter || "", "all");
    const clientOpts =
      '<option value="">All clients</option>' +
      (clients || [])
        .map(
          (c) =>
            `<option value="${escapeHtml(c.name)}" ${state.salesClientFilter === c.name ? "selected" : ""}>${escapeHtml(c.name)}</option>`
        )
        .join("");
    return `<select id="sales-client-filter" title="Filter by client">${clientOpts}</select>
      <select id="sales-agent-filter" title="Filter by agent"><option value="">All agents</option>${agentOpts.replace('<option value="">— Select —</option>', "")}</select>
      <select id="sales-closer-filter" title="Filter by closer"><option value="">All closers</option>${closerOpts.replace('<option value="">— Select —</option>', "")}</select>`;
  }

  function periodToolbar(period, state, monthToolbar, monthLabel, employees, clients, escapeHtml) {
    const personFilters = salesPersonFilters(employees, clients, escapeHtml, state);
    const extra = `${personFilters}${feedbackFilterSelects(state, escapeHtml)}<select id="sales-period">
      <option value="day" ${period === "day" ? "selected" : ""}>Daily</option>
      <option value="week" ${period === "week" ? "selected" : ""}>Weekly</option>
      <option value="month" ${period === "month" ? "selected" : ""}>Monthly</option>
    </select>`;

    if (period === "month") {
      return monthToolbar(extra);
    }
    if (period === "day") {
      const d = state.salesPickDate || todayIso();
      return `<div class="toolbar">
        <button class="btn" id="prev-day">←</button>
        <strong>${shortDateLabel(d)}</strong>
        <button class="btn" id="next-day">→</button>
        <input type="date" id="sales-pick-date" value="${d}" />
        ${extra}
      </div>`;
    }
    const mon = state.salesWeekDate || mondayOf(todayIso());
    return `<div class="toolbar">
      <button class="btn" id="prev-week">←</button>
      <strong>${weekRangeLabel(mon)}</strong>
      <button class="btn" id="next-week">→</button>
      <input type="date" id="sales-week-date" value="${mon}" title="Pick any day — snaps to Monday of that week" />
      ${extra}
    </div>`;
  }

  function bindPeriodNav(root, period, state, rerender) {
    root.querySelector("#prev-day")?.addEventListener("click", () => {
      state.salesPickDate = shiftDate(state.salesPickDate || todayIso(), -1);
      rerender();
    });
    root.querySelector("#next-day")?.addEventListener("click", () => {
      state.salesPickDate = shiftDate(state.salesPickDate || todayIso(), 1);
      rerender();
    });
    root.querySelector("#sales-pick-date")?.addEventListener("change", (e) => {
      state.salesPickDate = e.target.value;
      rerender();
    });
    root.querySelector("#prev-week")?.addEventListener("click", () => {
      state.salesWeekDate = shiftDate(state.salesWeekDate || mondayOf(todayIso()), -7);
      rerender();
    });
    root.querySelector("#next-week")?.addEventListener("click", () => {
      state.salesWeekDate = shiftDate(state.salesWeekDate || mondayOf(todayIso()), 7);
      rerender();
    });
    root.querySelector("#sales-week-date")?.addEventListener("change", (e) => {
      state.salesWeekDate = mondayOf(e.target.value);
      rerender();
    });
  }

  function agentsOffTitle(agentsOff, date, escapeHtml) {
    const list = agentsOff[date] || [];
    if (!list.length) return "";
    return list.map((a) => a.name).join(", ");
  }

  function agentsOffLine(agentsOff, date, escapeHtml) {
    const list = agentsOff[date] || [];
    if (!list.length) return "";
    const names = list.map((a) => escapeHtml(a.name)).join(", ");
    return `<br><span class="muted" style="font-size:.72rem;line-height:1.2">Off: ${names}</span>`;
  }

  function renderPeriodGrid(grid, escapeHtml) {
    if (!grid?.teams?.length) {
      return `<div class="card muted" style="padding:1rem;margin-bottom:1rem">No team data for this period.</div>`;
    }
    const { teams, dates, matrix, agentsOff } = grid;
    return `<div class="table-wrap card" style="margin-bottom:1rem;overflow-x:auto">
      <table class="sales-period-grid">
        <thead><tr>
          <th>Team</th>
          ${dates.map((d) => {
            const title = agentsOffTitle(agentsOff, d, escapeHtml);
            return `<th title="${escapeHtml(title)}">${shortDateLabel(d)}${agentsOffLine(agentsOff, d, escapeHtml)}</th>`;
          }).join("")}
        </tr></thead>
        <tbody>${teams.map((team) => `<tr>
          <td><strong>${escapeHtml(team)}</strong></td>
          ${dates.map((d) => {
            const count = matrix[team]?.[d] ?? 0;
            const title = agentsOffTitle(agentsOff, d, escapeHtml);
            return `<td title="${escapeHtml(title)}" class="${count ? "" : "muted"}">${count || "—"}</td>`;
          }).join("")}
        </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  async function renderSalesPage(root, api, state, helpers) {
    const { monthLabel, escapeHtml, fmt, bindMonthNav, monthToolbar, downloadFile } = helpers;
    const month = state.month;
    const period = state.salesPeriod || "month";
    const today = todayIso();
    state.salesPickDate = state.salesPickDate || today;
    state.salesWeekDate = state.salesWeekDate || mondayOf(today);
    state.salesStatusFilter = state.salesStatusFilter || "";
    state.salesAgentFilter = state.salesAgentFilter || "";
    state.salesCloserFilter = state.salesCloserFilter || "";
    state.salesClientFilter = state.salesClientFilter || "";

    let from;
    let to;
    let dashDate;
    if (period === "day") {
      from = to = dashDate = state.salesPickDate;
    } else if (period === "week") {
      from = state.salesWeekDate;
      to = shiftDate(from, 6);
      dashDate = from;
    } else {
      from = `${month}-01`;
      to = monthEnd(month);
      dashDate = from;
    }

    state.salesClientFeedbackFilter = state.salesClientFeedbackFilter || "";
    state.salesVerifierFeedbackFilter = state.salesVerifierFeedbackFilter || "";

    const salesQ = new URLSearchParams({ from, to, dateBasis: "workingDay" });
    if (state.salesAgentFilter) salesQ.set("agentId", state.salesAgentFilter);
    if (state.salesCloserFilter) salesQ.set("closerId", state.salesCloserFilter);
    if (state.salesClientFilter) salesQ.set("client", state.salesClientFilter);
    if (state.companyContext === "hs2") salesQ.set("company", "hs2");
    const advFilterRaw = state.salesAdvancedFilter || loadAdvancedFilter();
    const advFilter = normalizeAdvancedFilter(advFilterRaw);
    if (advFilterRaw && !advFilter) {
      state.salesAdvancedFilter = null;
      saveAdvancedFilter(null);
    }
    if (advFilter?.rules?.length) salesQ.set("filter", JSON.stringify(advFilter));
    if (!state.salesHiddenUnits) state.salesHiddenUnits = [];
    const dashQ = new URLSearchParams({ period, date: dashDate, groupBy: "team", dateBasis: "submission" });
    if (state.companyContext === "hs2") dashQ.set("company", "hs2");
    const [salesRes, dashRes, empRes, catalogRes, clientsRes] = await Promise.all([
      api(`/sales?${salesQ}`),
      api(`/sales/dashboard?${dashQ}`),
      api(`/employees${employeesQuery()}`),
      api("/sales/field-catalog?allFields=1").catch(() => ({ fields: [] })),
      api("/sales-config/catalog").catch(() => ({ clients: [] })),
    ]);
    let sales = salesRes.sales || [];
    let salesForStats = sales.slice();
    if (state.salesHiddenUnits?.length) {
      const hidden = new Set(state.salesHiddenUnits);
      sales = sales.filter((s) => !hidden.has(s.unit));
      salesForStats = salesForStats.filter((s) => !hidden.has(s.unit));
    }
    if (state.salesClientFeedbackFilter) {
      sales = sales.filter((s) => (s.formData?.clientFeedback || "") === state.salesClientFeedbackFilter);
    }
    if (state.salesVerifierFeedbackFilter) {
      sales = sales.filter((s) => (s.formData?.verifierFeedback || "") === state.salesVerifierFeedbackFilter);
    }
    const listColumns = salesRes.listColumns?.length ? salesRes.listColumns : defaultListColumns();
    const dashboard = dashRes;
    const employees = empRes.employees || [];
    const empById = new Map(employees.map((e) => [e.id, e]));
    const salesClients = clientsRes.clients || [];
    const teamNames = [...new Set(employees.map((e) => e.team).filter(Boolean))].sort();
    const filterFields = buildAdvancedFilterFields(catalogRes.fields || []);
    const periodLabel = PERIOD_LABELS[period] || "Month";
    const headerLabel = period === "month"
      ? monthLabel(month)
      : period === "day"
        ? shortDateLabel(state.salesPickDate)
        : weekRangeLabel(state.salesWeekDate);

    const showClientStats = listHasColumn(listColumns, "clientFeedback");
    const statGridHtml = showClientStats
      ? `<div class="grid-2 sales-stat-grid" style="gap:1rem;margin-bottom:1rem">
        <div class="card card-stat card-stat-click" data-client-filter="Passed"><strong>${countClientStatus(salesForStats, "Passed")}</strong><span class="muted">Passed (${periodLabel})</span></div>
        <div class="card card-stat card-stat-click" data-client-filter="Pending bank approval"><strong>${countClientStatus(salesForStats, "Pending bank approval")}</strong><span class="muted">Pending bank</span></div>
        <div class="card card-stat card-stat-click" data-client-filter="Processed"><strong>${countClientStatus(salesForStats, "Processed")}</strong><span class="muted">Processed</span></div>
        <div class="card card-stat card-stat-click" data-client-filter="Dropped"><strong>${countClientStatus(salesForStats, "Dropped")}</strong><span class="muted">Dropped</span></div>
      </div>`
      : "";

    const colCount = listColumns.length + 1;
    const unitToggleHtml = canToggleSalesUnits()
      ? `<div class="sales-unit-toggle card card-flat" style="margin-bottom:1rem;padding:.75rem 1rem">
          <span class="muted" style="margin-right:.75rem">Show units:</span>
          ${SALES_UNITS.map((u) => {
            const on = !state.salesHiddenUnits.includes(u);
            return `<label class="toggle-label" style="margin-right:1rem"><input type="checkbox" data-sales-unit="${u}" ${on ? "checked" : ""} /> ${u}</label>`;
          }).join("")}
          <span class="muted" style="margin-left:.5rem;font-size:.85rem">HS-2 = separate company</span>
        </div>`
      : "";

    const thead = listColumns.map((c) => `<th>${escapeHtml(c.label || c.columnKey)}</th>`).join("") + "<th></th>";
    const tbody = sales.length
      ? sales
          .map((s) => {
            const cells = listColumns.map((c) => `<td>${renderSaleListCell(c.columnKey, s, empById, escapeHtml, fmt)}</td>`).join("");
            return `<tr>${cells}<td class="btn-row">
              ${canFullEditSale() ? `<button class="btn btn-sm" data-edit-sale="${s.id}">Edit</button>` : ""}
              ${canWorkQualityTicket() && !canFullEditSale() ? `<button class="btn btn-sm btn-primary" data-quality-ticket="${s.id}">Open ticket</button>` : ""}
              ${canWorkQualityTicket() && canFullEditSale() ? `<button class="btn btn-sm" data-quality-ticket="${s.id}">Quality ticket</button>` : ""}
              ${canApprove() && s.status === "pending" ? `<button class="btn btn-sm" data-approve="${s.id}">Approve</button>
                <button class="btn btn-sm btn-danger" data-deny="${s.id}">Deny</button>` : ""}
              ${canApprove() ? `<button class="btn btn-sm" data-callback="${s.id}">Callback</button>` : ""}
              ${canExportSalesList() ? `<button class="btn btn-sm" data-export-sale="${s.id}" title="Export this sale">Export</button>` : ""}
            </td></tr>`;
          })
          .join("")
      : `<tr><td colspan="${colCount}" class="muted">No sales in this ${periodLabel.toLowerCase()} period</td></tr>`;

    root.innerHTML = `
      <div class="page-header">
        <div><h1>Sales log</h1><p class="muted">${headerLabel} · ${sales.length} records · Filtered by <strong>working day</strong></p></div>
        <div class="btn-row">
          ${canSubmit() && !isQualityAgent() ? '<button class="btn btn-primary" id="add-sale-btn">+ Add sale</button>' : ""}
          ${canExportSalesList() ? `<select id="sales-export-format" class="search-input" style="width:auto;min-width:6rem;flex:0 0 auto" title="Export format">
            <option value="csv">CSV</option>
            <option value="xlsx">Excel</option>
            <option value="pdf">PDF</option>
          </select>
          <button class="btn btn-sm" id="sales-export-btn" type="button" title="Export current list (filters + date range)">Export list</button>` : ""}
        </div>
      </div>
      ${unitToggleHtml}
      ${periodToolbar(period, state, monthToolbar, monthLabel, employees, salesClients, escapeHtml)}
      ${advancedFilterPanelHtml(escapeHtml, filterFields, employees, salesClients, teamNames)}
      ${statGridHtml}
      <div class="table-wrap card"><table>
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table></div>`;

    const rerender = () => renderSalesPage(root, api, state, helpers);
    if (period === "month") bindMonthNav(root);
    else bindPeriodNav(root, period, state, rerender);

    root.querySelector("#sales-period")?.addEventListener("change", (e) => {
      state.salesPeriod = e.target.value;
      rerender();
    });
    root.querySelector("#sales-client-feedback-filter")?.addEventListener("change", (e) => {
      state.salesClientFeedbackFilter = e.target.value;
      rerender();
    });
    root.querySelector("#sales-verifier-feedback-filter")?.addEventListener("change", (e) => {
      state.salesVerifierFeedbackFilter = e.target.value;
      rerender();
    });
    root.querySelector("#sales-agent-filter")?.addEventListener("change", (e) => {
      state.salesAgentFilter = e.target.value;
      rerender();
    });
    root.querySelector("#sales-closer-filter")?.addEventListener("change", (e) => {
      state.salesCloserFilter = e.target.value;
      rerender();
    });
    root.querySelector("#sales-client-filter")?.addEventListener("change", (e) => {
      state.salesClientFilter = e.target.value;
      rerender();
    });
    root.querySelectorAll("[data-sales-unit]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const hidden = SALES_UNITS.filter((u) => {
          const el = root.querySelector(`[data-sales-unit="${u}"]`);
          return el && !el.checked;
        });
        state.salesHiddenUnits = hidden;
        rerender();
      });
    });
    root.querySelectorAll(".card-stat-click").forEach((card) => {
      card.addEventListener("click", () => {
        const clientVal = card.dataset.clientFilter || "";
        if (clientVal) {
          state.salesClientFeedbackFilter = clientVal;
          state.salesVerifierFeedbackFilter = "";
          rerender();
        }
      });
    });
    root.querySelector("#add-sale-btn")?.addEventListener("click", () =>
      openSaleModal(api, employees, helpers, null, rerender)
    );
    bindAdvancedFilter(root, rerender, filterFields, employees, salesClients, teamNames, escapeHtml);
    function salesExportExt(format) {
      return format === "xlsx" ? "xlsx" : format;
    }
    function runSalesExport(extra = {}) {
      if (typeof downloadFile !== "function") return alert("Export not available");
      const format = root.querySelector("#sales-export-format")?.value || "csv";
      const q = new URLSearchParams(salesQ);
      q.set("format", format);
      Object.entries(extra).forEach(([k, v]) => {
        if (v != null && v !== "") q.set(k, v);
      });
      const label = extra.saleId ? `sale-${extra.saleId}` : `sales-${from}-${to}`;
      downloadFile(`/sales/export?${q}`, `${label}.${salesExportExt(format)}`).catch((e) => alert(e.message));
    }
    root.querySelector("#sales-export-btn")?.addEventListener("click", () => runSalesExport());
    root.querySelectorAll("[data-export-sale]").forEach((btn) => {
      btn.onclick = () => runSalesExport({ saleId: btn.dataset.exportSale });
    });
    root.querySelectorAll("[data-edit-sale]").forEach((btn) => {
      btn.onclick = () => {
        const sale = sales.find((s) => s.id === btn.dataset.editSale);
        if (sale) openSaleModal(api, employees, helpers, sale, rerender);
      };
    });
    root.querySelectorAll("[data-quality-ticket]").forEach((btn) => {
      btn.onclick = () => {
        const sale = sales.find((s) => s.id === btn.dataset.qualityTicket);
        if (sale) openQualityTicketModal(api, employees, helpers, sale, rerender);
      };
    });
    root.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.onclick = async () => {
        await api(`/sales/${btn.dataset.approve}`, { method: "PATCH", body: JSON.stringify({ action: "approve" }) });
        rerender();
      };
    });
    root.querySelectorAll("[data-deny]").forEach((btn) => {
      btn.onclick = () => {
        openPromptModal({
          title: "Deny sale",
          message: "Optional denial reason:",
          placeholder: "Reason",
          confirmLabel: "Deny",
          onSubmit: async (feedback) => {
            await api(`/sales/${btn.dataset.deny}`, {
              method: "PATCH",
              body: JSON.stringify({ action: "deny", feedback }),
            });
            rerender();
          },
        });
      };
    });
    root.querySelectorAll("[data-callback]").forEach((btn) => {
      btn.onclick = () => {
        openModal(
          `<div class="modal-header"><h2>Callback</h2><button class="btn btn-sm" data-close>✕</button></div>
          <form id="sale-callback-form" class="modal-body">
            <label class="field"><span>Feedback</span><textarea name="feedback" required rows="3"></textarea></label>
            <label class="toggle-label"><input type="checkbox" name="visible" /> Allow agent to see this feedback</label>
          </form>
          <div class="modal-footer">
            <button class="btn" data-close>Cancel</button>
            <button type="submit" form="sale-callback-form" class="btn btn-primary">Send callback</button>
          </div>`,
          true
        );
        document.getElementById("sale-callback-form").onsubmit = async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const feedback = String(fd.get("feedback") || "").trim();
          if (!feedback) return alert("Feedback is required");
          await api(`/sales/${btn.dataset.callback}`, {
            method: "PATCH",
            body: JSON.stringify({
              action: "callback",
              feedback,
              callbackVisibleToAgent: fd.get("visible") === "on",
            }),
          });
          closeModal();
          rerender();
        };
      };
    });
  }

  function closerSelectOptions(employees, escapeHtml, selectedId = "") {
    const isLead = (e) => /^(TL|CL|OP)/i.test(String(e.id || ""));
    const excludedUnit = (u) => /back.?end/i.test(String(u || "")) || String(u || "") === "HS-Back-End";
    const isDialingAgent = (e) =>
      !/^(TL|CL|OP|HR|MG|OF|NW)/i.test(String(e.id || "")) && e.unit && !excludedUnit(e.unit);
    const leaders = employees.filter(isLead).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const agents = employees
      .filter((e) => isDialingAgent(e) && !isLead(e))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let html = '<option value="">— Select closer —</option>';
    for (const e of leaders) {
      html += `<option value="${e.id}" ${selectedId === e.id ? "selected" : ""}>★ ${e.id} — ${escapeHtml(e.american_name || e.id)}</option>`;
    }
    if (leaders.length && agents.length) html += '<option disabled>— Dialing agents —</option>';
    for (const e of agents) {
      html += `<option value="${e.id}" ${selectedId === e.id ? "selected" : ""}>${e.id} — ${escapeHtml(e.american_name || e.id)}</option>`;
    }
    return html;
  }

  async function openQualityTicketModal(api, employees, helpers, sale, onDone) {
    const { escapeHtml, closeModal, openModal } = helpers;
    const catalog = await api(`/sales/field-catalog?surface=quality&saleId=${encodeURIComponent(sale.id)}`).catch(() => ({
      fields: [],
      attachmentKinds: [],
    }));
    const attachKinds = catalog.attachmentKinds?.length ? catalog.attachmentKinds : [];
    const formData = sale?.formData || {};
    const ticketFields = (catalog.fields || []).filter(
      (f) => !["client", "deviceType", "unit", "team", "price"].includes(f.key)
    );
    const agentEmp = employees.find((e) => e.id === sale?.agentId);

    function qFieldHtml(f) {
      const val = formData[f.key] ?? sale?.[f.key] ?? "";
      const name = f.key;
      const editable = f.canEdit === true;
      const ro = editable ? "" : " readonly";
      const dis = editable ? "" : " disabled";
      if (f.type === "employee") {
        if (!editable) {
          return `<label class="field"><span>${escapeHtml(f.label)}</span><input value="${escapeHtml(val)}" readonly /></label>`;
        }
        return `<label class="field"><span>${escapeHtml(f.label)}</span><select name="${name}">${employeeSelectOptions(employees, escapeHtml, val, f.employeeFilter || "all")}</select></label>`;
      }
      if (f.type === "textarea") {
        return `<label class="field" style="grid-column:1/-1"><span>${escapeHtml(f.label)}</span><textarea name="${name}"${ro}>${escapeHtml(val)}</textarea></label>`;
      }
      if (f.type === "select" && f.options) {
        const opts = f.options
          .map((o) => `<option value="${escapeHtml(o)}" ${String(val) === o ? "selected" : ""}>${escapeHtml(o)}</option>`)
          .join("");
        return `<label class="field"><span>${escapeHtml(f.label)}</span><select name="${name}"${dis}>${opts}</select></label>`;
      }
      return `<label class="field"><span>${escapeHtml(f.label)}</span><input name="${name}" type="text" value="${escapeHtml(val)}"${ro} /></label>`;
    }

    const bySection = [...new Set(ticketFields.map((f) => f.section || "general"))];
    const fieldsHtml = bySection
      .map((sec) => {
        const secFields = ticketFields.filter((f) => (f.section || "general") === sec);
        if (!secFields.length) return "";
        return `<fieldset class="card card-flat" style="grid-column:1/-1"><legend>${escapeHtml(sec)}</legend><div class="field-grid">${secFields.map(qFieldHtml).join("")}</div></fieldset>`;
      })
      .join("");

    const attachBlock = buildAttachmentsBlock(attachKinds, true, { forceShow: true });

    openModal(
      `<div class="modal-header"><h2>Quality ticket</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="quality-ticket-form" class="form-grid modal-body-scroll">
        <div class="card card-flat quality-ticket-summary" style="grid-column:1/-1">
          <div class="field-grid">
            <div><span class="muted">Customer</span><div><strong>${escapeHtml(sale.fullName || "—")}</strong></div><span class="muted">${escapeHtml(sale.phoneNumber || "")}</span></div>
            <div><span class="muted">Client</span><div>${escapeHtml(sale.client || formData.client || "—")}</div></div>
            <div><span class="muted">Device</span><div>${escapeHtml(deviceLabel(sale.device || formData.deviceType))}</div></div>
            <div><span class="muted">Agent</span><div>${escapeHtml(sale.agentId || "—")} — ${escapeHtml(agentEmp?.american_name || "")}</div></div>
            <div><span class="muted">Status</span><div><span class="badge">${escapeHtml(sale.status || "")}</span></div></div>
          </div>
        </div>
        ${fieldsHtml}
        ${attachBlock}
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save ticket</button></div>
      </form>`,
      true
    );

    const listEl = document.getElementById("sale-attachments-list");
    const canManageFiles = attachKinds.some((k) => k.canEdit);
    await wireSaleAttachmentsList(listEl, sale.id, api, attachKinds, openSaleAttachment, canManageFiles, {
      inlineAudio: true,
    });

    document.getElementById("quality-ticket-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { edit: true, qualityTicket: true, formData: {} };
      for (const [k, v] of fd.entries()) body.formData[k] = v;
      try {
        await api(`/sales/${sale.id}`, { method: "PATCH", body: JSON.stringify(body) });
        const saleId = sale.id;
        for (const input of document.querySelectorAll("[data-attach-kind]")) {
          const file = input.files?.[0];
          if (!file) continue;
          const b64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(",")[1]);
            r.onerror = reject;
            r.readAsDataURL(file);
          });
          await api(`/sales/${saleId}/attachments`, {
            method: "POST",
            body: JSON.stringify({ fileName: file.name, contentBase64: b64, kind: input.dataset.attachKind }),
          });
        }
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  async function openSaleModal(api, employees, helpers, sale, onDone) {
    const { escapeHtml, closeModal, openModal } = helpers;
    const isEdit = !!sale;
    const catalogQuery = isEdit && sale?.id ? `?saleId=${encodeURIComponent(sale.id)}` : "";
    const catalog = await api(`/sales/field-catalog${catalogQuery}`).catch(() => ({ fields: [], attachmentKinds: [] }));
    let fields = (catalog.fields || []).filter((f) => {
      if (isEdit && f.hideOnEdit) return false;
      if (!isEdit && f.hideOnCreate) return false;
      if (!isEdit && !canApprove() && f.key === "status") return false;
      return true;
    });
    if (!isEdit) {
      for (const pf of PAYMENT_SUBMIT_FIELDS) {
        if (!fields.some((f) => f.key === pf.key)) fields.push({ ...pf, canEdit: true });
      }
    }
    const formData = sale?.formData || {};
    const agentEmp = employees.find((e) => e.id === sale?.agentId);
    const closerEmp = employees.find((e) => e.id === sale?.closerId);
    function isDialingAgentUser(user, emps) {
      const id = user?.employeeId;
      if (!id || /^(TL|CL|OP|HR|MG|OF|NW)/i.test(String(id))) return false;
      return emps.some((e) => e.id === id);
    }
    const defaultAgentId =
      sale?.agentId || (isDialingAgentUser(state.user, employees) ? state.user?.employeeId : "") || "";
    const defaultCloserId =
      sale?.closerId || (["tl", "op"].includes(state.user?.role) ? state.user?.employeeId : "") || "";
    const agentOpts = employeeSelectOptions(employees, escapeHtml, defaultAgentId, "dialing");

    function fieldHtml(f) {
      const val = formData[f.key] ?? sale?.[f.key] ?? "";
      const name = f.key === "deviceType" ? "device" : f.key;
      const cardClass = f.cardField ? " sale-card-fields hidden" : f.bankField ? " sale-bank-fields hidden" : "";
      const idAttr = f.key === "paymentMethod" ? ' id="sale-payment-method"' : "";
      let editable = f.canEdit === true;
      if (f.key === "verifierFeedback" || f.key === "clientFeedback") {
        editable = f.canEdit === true;
      }
      const ro = editable ? "" : " readonly";
      const dis = editable ? "" : " disabled";
      if (f.type === "datetime") {
        if (!isEdit) {
          const display = formatEgyptDateTime();
          return `<div class="field"><span>${escapeHtml(f.label)}</span><div class="field-readonly">${escapeHtml(display)}</div><small class="muted">Egypt local time — set automatically on submit</small></div>`;
        }
        return `<div class="field"><span>${escapeHtml(f.label)}</span><div class="field-readonly">${escapeHtml(val || "—")}</div></div>`;
      }
      if (f.type === "employee") {
        const selected = val || "";
        return `<label class="field${cardClass}"><span>${escapeHtml(f.label)}</span><select name="${name}"${dis}>${employeeSelectOptions(employees, escapeHtml, selected, f.employeeFilter || "all")}</select></label>`;
      }
      if (f.type === "select" && f.options) {
        const placeholder = f.selectPlaceholder ? '<option value="">— Select —</option>' : "";
        const opts = f.options
          .map((o) => `<option value="${escapeHtml(o)}" ${String(val) === o ? "selected" : ""}>${escapeHtml(o)}</option>`)
          .join("");
        const req = f.required && editable ? " required" : "";
        return `<label class="field${cardClass}"><span>${escapeHtml(f.label)}</span><select name="${name}"${idAttr}${req}${dis}>${placeholder}${opts}</select></label>`;
      }
      if (f.type === "textarea") {
        return `<label class="field${cardClass}" style="grid-column:1/-1"><span>${escapeHtml(f.label)}</span><textarea name="${name}"${ro}>${escapeHtml(val)}</textarea></label>`;
      }
      const inputType = f.type === "tel" ? "tel" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
      const req = f.required && editable ? " required" : "";
      const inputMode = f.inputMode ? ` inputmode="${f.inputMode}"` : "";
      const maxLength = f.maxLength ? ` maxlength="${f.maxLength}"` : "";
      const autoComplete = f.cardField || f.key === "cvv" || f.key === "cardNumber" ? ' autocomplete="off"' : "";
      const placeholder = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : "";
      return `<label class="field${cardClass}"><span>${escapeHtml(f.label)}</span><input name="${name}" type="${inputType}" value="${escapeHtml(val)}"${req}${inputMode}${maxLength}${autoComplete}${placeholder}${ro} /></label>`;
    }

    function wirePaymentToggle(form) {
      const sel = form.querySelector("#sale-payment-method");
      const cardFields = form.querySelectorAll(".sale-card-fields");
      const bankFields = form.querySelectorAll(".sale-bank-fields");
      function sync() {
        const method = sel?.value;
        const isCard = method === "Card";
        const isBank = method === "Bank account";
        cardFields.forEach((el) => el.classList.toggle("hidden", !isCard));
        bankFields.forEach((el) => el.classList.toggle("hidden", !isBank));
      }
      sel?.addEventListener("change", sync);
      sync();
    }

    const agentCloserHtml = isEdit
      ? `<div class="field" style="grid-column:1/-1">
          <span class="muted">Agent</span><div><strong>${escapeHtml(sale?.agentId || "—")}</strong> — ${escapeHtml(agentEmp?.american_name || "")}</div>
          <span class="muted">Closer</span><div><strong>${escapeHtml(sale?.closerId || "—")}</strong> — ${escapeHtml(closerEmp?.american_name || "")}</div>
        </div>`
      : "";

    const sections = [...new Set(fields.map((f) => f.section || "general"))];
    const sectionHtml = sections.map((sec) => {
      const secFields = fields.filter((f) => (f.section || "general") === sec);
      if (!secFields.length) return "";
      return `<fieldset class="card card-flat" style="grid-column:1/-1"><legend>${escapeHtml(sec)}</legend><div class="field-grid">${secFields.map(fieldHtml).join("")}</div></fieldset>`;
    }).join("");

    const attachKinds = catalog.attachmentKinds || [];
    const attachHtml = buildAttachmentsBlock(attachKinds, isEdit);

    openModal(`
      <div class="modal-header"><h2>${isEdit ? "Edit sale" : "Add sale"}</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="sale-form" class="form-grid modal-body-scroll">
        ${agentCloserHtml}
        ${sectionHtml}
        ${attachHtml}
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button></div>
      </form>
    `, true);
    document.querySelector("#modal-root .modal")?.classList.add("sale-form-modal");

    const saleForm = document.getElementById("sale-form");
    wirePaymentToggle(saleForm);

    let salesClientsMeta = null;
    if (window.HRSalesConfigBreaks) {
      salesClientsMeta = await window.HRSalesConfigBreaks.enhanceSaleModal(
        api,
        { escapeHtml, closeModal, openModal },
        sale,
        employees,
        document.getElementById("modal-root") || document,
        () => canFullEditSale(),
        openSaleAttachment
      ).catch(() => null);
    }
    const listEl = document.getElementById("sale-attachments-list");
    if (isEdit && sale?.id && listEl && !salesClientsMeta) {
      await wireSaleAttachmentsList(listEl, sale.id, api, attachKinds, openSaleAttachment, canFullEditSale());
    }

    document.getElementById("sale-form").onsubmit = async (e) => {
      e.preventDefault();
      const clientId = document.getElementById("sale-client-select")?.value;
      const productId = document.getElementById("sale-product-select")?.value;
      const priceId = document.getElementById("sale-price-select")?.value;
      const clients =
        salesClientsMeta?.clients ||
        (await window.HRSalesConfigBreaks.loadCatalog(api).catch(() => ({ clients: [] }))).clients ||
        [];
      if (clients.length && window.HRSalesConfigBreaks) {
        const ok = await window.HRSalesConfigBreaks.validateClientSubmit(clients, clientId, productId, priceId);
        if (!ok) return;
      } else if (clients.length && !clientId) {
        alert("Select client, device, and price from the catalog list.");
        return;
      }
      const fd = new FormData(e.target);
      const paymentMethod = String(fd.get("paymentMethod") || "").trim();
      if (!isEdit && !paymentMethod) {
        alert("Select a payment method (Bank account or Card).");
        return;
      }
      if (paymentMethod === "Card") {
        if (!String(fd.get("cardNumber") || "").trim() || !String(fd.get("cardExpDate") || "").trim() || !String(fd.get("cvv") || "").trim()) {
          alert("Enter card number, expiration, and CVV when payment method is Card.");
          return;
        }
      }
      if (paymentMethod === "Bank account") {
        if (
          !String(fd.get("routingNumber") || "").trim() ||
          !String(fd.get("bankName") || "").trim() ||
          !String(fd.get("bankAccountNumber") || "").trim()
        ) {
          alert("Enter routing number, bank name, and account number when payment method is Bank account.");
          return;
        }
      }
      const body = { formData: {} };
      for (const [k, v] of fd.entries()) {
        if (k === "agentId" || k === "closerId" || k === "unit" || k === "team") body[k] = v;
        else if (k === "device") {
          body.device = v;
          body.formData.deviceType = v;
        } else {
          body.formData[k] = v;
          if (k === "phoneNumber") body.phoneNumber = v;
          if (k === "fullName") body.fullName = v;
          if (k === "price") body.price = Number(v) || null;
          if (k === "client") body.client = v;
          if (k === "salesClientId" || k === "salesProductId" || k === "salesPriceId") {
            body.formData[k] = v;
            body[k] = v;
          }
          if (k === "submissionDate") body.submissionDate = v;
          if (k === "effectiveDate") body.effectiveDate = v;
          if (k === "status") body.status = v;
          if (k === "feedback") body.feedback = v;
        }
      }
      if (!body.fullName) {
        const fn = body.formData.firstName || fd.get("firstName") || "";
        const ln = body.formData.lastName || fd.get("lastName") || "";
        body.fullName = [fn, ln].filter(Boolean).join(" ").trim();
      }
      try {
        let saleId = sale?.id;
        if (isEdit) {
          body.edit = true;
          await api(`/sales/${sale.id}`, { method: "PATCH", body: JSON.stringify(body) });
        } else {
          const res = await api("/sales", { method: "POST", body: JSON.stringify(body) });
          saleId = res.sale?.id;
        }
        for (const input of e.target.querySelectorAll("[data-attach-kind]")) {
          const file = input.files?.[0];
          if (!file || !saleId) continue;
          const b64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(",")[1]);
            r.onerror = reject;
            r.readAsDataURL(file);
          });
          await api(`/sales/${saleId}/attachments`, {
            method: "POST",
            body: JSON.stringify({ fileName: file.name, contentBase64: b64, kind: input.dataset.attachKind }),
          });
        }
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const PERM_ROLE_GROUPS = [
    { key: "agent", label: "Agent", roles: ["agent"] },
    { key: "tl", label: "TL", roles: ["tl"] },
    { key: "op", label: "OP", roles: ["op"] },
    { key: "quality", label: "Quality", roles: ["quality"] },
    { key: "rtm", label: "RTM", roles: ["rtm"] },
    { key: "pr", label: "Public relations", roles: ["public_relations"] },
    { key: "admin", label: "Admin", roles: ["admin", "ceo"] },
    { key: "hr", label: "HR", roles: ["hr"] },
    { key: "finance", label: "Finance", roles: ["finance"] },
  ];

  function groupHasAllRoles(list, groupRoles) {
    const set = new Set((list || []).map((r) => String(r).toLowerCase()));
    return groupRoles.every((r) => set.has(r));
  }

  function toggleGroupRoles(list, groupRoles, enabled) {
    const set = new Set((list || []).map((r) => String(r).toLowerCase()));
    for (const r of groupRoles) {
      if (enabled) set.add(r);
      else set.delete(r);
    }
    return [...set];
  }

  async function openSalesPermissionsModal(api, helpers, onDone) {
    const { escapeHtml, closeModal, openModal } = helpers;
    const catalog = await api("/sales/field-catalog?allFields=1");
    const perms = catalog.permissions || [];
    const permMap = Object.fromEntries(perms.map((p) => [p.fieldKey, p]));
    const fields = (catalog.fields && catalog.fields.length)
      ? catalog.fields
      : perms.map((p) => ({ key: p.fieldKey, label: p.label || p.fieldKey, section: p.section || "general" }));

    const sections = [...new Set(fields.map((f) => f.section || "general"))];
    const rowsBySection = sections
      .map((sec) => {
        const secFields = fields.filter((f) => (f.section || "general") === sec);
        const secRows = secFields
          .map((f) => {
            const p = permMap[f.key] || {};
            const viewRoles = p.viewRoles || p.view_roles || [];
            const editRoles = p.editRoles || p.edit_roles || [];
            const cells = PERM_ROLE_GROUPS.map((g) => {
              const viewOn = groupHasAllRoles(viewRoles, g.roles);
              const editOn = groupHasAllRoles(editRoles, g.roles);
              return `<td class="perm-cell"><label class="perm-check"><input type="checkbox" data-field="${f.key}" data-kind="view" data-group="${g.key}" ${viewOn ? "checked" : ""} /><span>View</span></label></td>
                <td class="perm-cell"><label class="perm-check perm-check-edit"><input type="checkbox" data-field="${f.key}" data-kind="edit" data-group="${g.key}" ${editOn ? "checked" : ""} /><span>Edit</span></label></td>`;
            }).join("");
            return `<tr><td class="perm-field-name"><strong>${escapeHtml(f.label || f.key)}</strong><span class="muted">${escapeHtml(f.key)}</span></td>${cells}</tr>`;
          })
          .join("");
        return `<tr class="perm-section-row"><td colspan="${1 + PERM_ROLE_GROUPS.length * 2}">${escapeHtml(sec)}</td></tr>${secRows}`;
      })
      .join("");

    const headerCells = PERM_ROLE_GROUPS.map((g) => `<th colspan="2" class="perm-group-head">${g.label}</th>`).join("");
    const subHeader = PERM_ROLE_GROUPS.map(() => `<th class="perm-sub">View</th><th class="perm-sub">Edit</th>`).join("");

    openModal(`
      <div class="modal-header">
        <h2>Sales access — Edit fields</h2>
        <button class="btn btn-sm" data-close>✕</button>
      </div>
      <div class="modal-body modal-body-scroll sales-perms-modal">
        <p class="muted">Edit access (full sale form). Edit grants view for the same cell. Use <strong>Log columns</strong> for the sales list tab.</p>
        <div class="table-wrap sales-perms-wrap"><table class="sales-perms-table sales-perms-table-wide">
          <thead><tr><th class="perm-sticky-col">Field</th>${headerCells}</tr>
          <tr><th class="perm-sticky-col"></th>${subHeader}</tr></thead>
          <tbody>${rowsBySection}</tbody>
        </table></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sm" id="sales-perms-seed">Reset defaults</button>
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="sales-perms-save">Save permissions</button>
      </div>`, true);

    document.getElementById("sales-perms-seed")?.addEventListener("click", () => {
      openConfirmModal({
        title: "Reset permissions",
        message: "Reset all column permissions to catalog defaults?",
        confirmLabel: "Reset",
        danger: true,
        onConfirm: async () => {
          await api("/sales/field-permissions/seed", { method: "POST", body: "{}" });
          closeModal();
          onDone();
        },
      });
    });

    document.getElementById("sales-perms-save")?.addEventListener("click", async () => {
      const byField = {};
      for (const input of document.querySelectorAll("[data-field][data-group]")) {
        const fieldKey = input.dataset.field;
        const kind = input.dataset.kind;
        const group = PERM_ROLE_GROUPS.find((g) => g.key === input.dataset.group);
        if (!group) continue;
        if (!byField[fieldKey]) {
          const p = permMap[fieldKey] || {};
          byField[fieldKey] = {
            viewRoles: [...(p.viewRoles || p.view_roles || [])],
            editRoles: [...(p.editRoles || p.edit_roles || [])],
            mainViewRoles: [...(p.mainViewRoles || p.main_view_roles || p.viewRoles || p.view_roles || [])],
            qualityViewRoles: [...(p.qualityViewRoles || p.quality_view_roles || [])],
          };
        }
        byField[fieldKey][kind === "view" ? "viewRoles" : "editRoles"] = toggleGroupRoles(
          byField[fieldKey][kind === "view" ? "viewRoles" : "editRoles"],
          group.roles,
          input.checked
        );
      }
      try {
        for (const [fieldKey, body] of Object.entries(byField)) {
          await api(`/sales/field-permissions/${encodeURIComponent(fieldKey)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        }
        closeModal();
        onDone();
      } catch (e) {
        alert(e.message);
      }
    });
  }

  async function openSalesListColumnsModal(api, helpers, onDone) {
    const { escapeHtml, closeModal, openModal } = helpers;
    const data = await api("/sales/list-columns");
    const cols = data.columns || defaultListColumns();
    openModal(
      `<div class="modal-header"><h2>Sales log columns</h2><button class="btn btn-sm" data-close>✕</button></div>
      <div class="modal-body modal-body-scroll">
        <p class="muted">Choose which columns appear on the Sales log tab (intersected with each role's field view access).</p>
        <div class="field-grid">${cols
          .map(
            (c) => `<label class="field"><span>${escapeHtml(c.label || c.columnKey)}</span>
              <input type="checkbox" data-list-col="${escapeHtml(c.columnKey)}" ${c.enabled !== false ? "checked" : ""} /></label>`
          )
          .join("")}</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sm" id="list-cols-seed">Reset defaults</button>
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="list-cols-save">Save</button>
      </div>`,
      true
    );
    document.getElementById("list-cols-seed")?.addEventListener("click", async () => {
      await api("/sales/list-columns/seed", { method: "POST", body: "{}" });
      closeModal();
      onDone();
    });
    document.getElementById("list-cols-save")?.addEventListener("click", async () => {
      const columns = [...document.querySelectorAll("[data-list-col]")].map((input) => ({
        columnKey: input.dataset.listCol,
        enabled: input.checked,
      }));
      await api("/sales/list-columns", {
        method: "PUT",
        body: JSON.stringify({ columns }),
      });
      closeModal();
      onDone();
    });
  }

  return { renderSalesPage, openSalesPermissionsModal, openSalesListColumnsModal };
})();
