/**
 * Sales clients catalog, break schedules, and settings UI extensions.
 */
window.HRSalesConfigBreaks = (function () {
  let catalogCache = { clients: [], revision: 0 };
  let breaksCache = { breaks: [], revision: 0 };
  let breakOverlayEl = null;
  let breakTimerId = null;

  const DEVICE_TYPES = [
    { id: "smartwatch", label: "Smartwatch" },
    { id: "bracelet", label: "Band / Bracelet" },
    { id: "necklace", label: "Necklace" },
  ];

  const ROLE_OPTIONS = ["agent", "tl", "op", "quality", "rtm", "hr", "admin", "ceo", "finance", "office_assistant"];
  const UNIT_OPTIONS_ALL = ["HS1", "HS2", "HS3", "HS4", "HS5", "HS-Back-End", "Management"];

  function visibleBreakUnits(state) {
    if (state?.user?.canManageHs2Company) return UNIT_OPTIONS_ALL;
    return UNIT_OPTIONS_ALL.filter((u) => u !== "HS2");
  }

  function calcEndTime(startTime, durationMinutes) {
    const m = String(startTime || "10:00").match(/^(\d{1,2}):(\d{2})/);
    if (!m) return "10:15";
    let mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (Number(durationMinutes) || 15);
    mins = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(mins / 60);
    const mi = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }

  function canManage(state) {
    return ["rtm", "admin"].includes(state.user?.role);
  }

  async function loadCatalog(api, force) {
    const rev = catalogCache.revision || 0;
    const data = await api(`/sales-config/catalog${force ? "?activeOnly=false" : ""}`);
    if (!force && data.revision === rev && catalogCache.clients.length) return catalogCache;
    catalogCache = { clients: data.clients || [], revision: data.revision || 0 };
    return catalogCache;
  }

  async function loadBreaks(api, force) {
    const data = await api("/sales-config/breaks");
    if (!force && data.revision === breaksCache.revision && breaksCache.breaks.length) return breaksCache;
    breaksCache = { breaks: data.breaks || [], revision: data.revision || 0, canManage: data.canManage };
    return breaksCache;
  }

  function onSettingsRevision(api, revision, state) {
    if (!revision) return;
    const prev = window.__hrSettingsRevision || 0;
    if (revision !== prev) {
      window.__hrSettingsRevision = revision;
      catalogCache.revision = 0;
      breaksCache.revision = 0;
      loadCatalog(api, true).catch(() => {});
      loadBreaks(api, true).catch(() => {});
      if (state.page === "settings" || state.page === "breaks") {
        if (typeof render === "function") render();
      }
    }
  }

  function parseEndMs(startTime, durationMinutes) {
    const m = String(startTime || "12:00").match(/^(\d{1,2}):(\d{2})/);
    if (!m) return Date.now() + durationMinutes * 60000;
    const d = new Date();
    d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    d.setMinutes(d.getMinutes() + (Number(durationMinutes) || 15));
    return d.getTime();
  }

  function formatCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function showBreakOverlay(brk) {
    if (!brk) return;
    if (!breakOverlayEl) {
      breakOverlayEl = document.createElement("div");
      breakOverlayEl.id = "break-overlay";
      breakOverlayEl.className = "break-overlay";
      document.body.appendChild(breakOverlayEl);
    }
    const endMs = parseEndMs(brk.startTime, brk.durationMinutes);
    const renderTick = () => {
      const left = endMs - Date.now();
      breakOverlayEl.innerHTML = `
        <div class="break-overlay-card">
          <button type="button" class="btn btn-sm break-overlay-close" id="break-overlay-close">✕</button>
          <h2>Break time</h2>
          <p class="break-overlay-name">${escapeHtml(brk.name || "Scheduled break")}</p>
          <p class="break-overlay-timer" id="break-countdown">${formatCountdown(left)}</p>
          <p class="muted">Ends around ${escapeHtml(formatTimeAmPm(brk.endTime || ""))} (Egypt) · ${brk.durationMinutes || 15} min</p>
          ${brk.message ? `<p>${escapeHtml(brk.message)}</p>` : ""}
          <p class="muted">You can close this and reopen from <strong>Breaks</strong> in the sidebar.</p>
        </div>`;
      breakOverlayEl.querySelector("#break-overlay-close").onclick = () => {
        breakOverlayEl.classList.add("hidden");
      };
      if (left <= 0) {
        clearInterval(breakTimerId);
        breakTimerId = null;
        document.getElementById("break-countdown").textContent = "00:00";
      }
    };
    breakOverlayEl.classList.remove("hidden");
    renderTick();
    if (breakTimerId) clearInterval(breakTimerId);
    breakTimerId = setInterval(renderTick, 1000);
  }

  function handleActiveBreak(brk) {
    if (!brk) {
      if (breakOverlayEl) breakOverlayEl.classList.add("hidden");
      return;
    }
    const dismissed = sessionStorage.getItem(`hr_break_dismissed_${brk.id}`);
    if (!dismissed) showBreakOverlay(brk);
    window.__hrActiveBreak = brk;
  }

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

  /**
   * Resolve catalog UUIDs for a sale. Prefers stored salesClientId/ProductId/PriceId,
   * falls back to matching the sale's client name / device type / price against the
   * catalog (legacy sales stored only text values).
   */
  function resolveCatalogSelection(clients, sale, formData) {
    const fd = formData || {};
    let clientId = fd.salesClientId || "";
    let productId = fd.salesProductId || "";
    let priceId = fd.salesPriceId || "";

    let client = (clients || []).find((c) => c.id === clientId) || null;
    if (!client) {
      clientId = "";
      const name = String(sale?.client || fd.client || "").trim().toLowerCase();
      if (name) {
        client = (clients || []).find((c) => String(c.name || "").trim().toLowerCase() === name) || null;
        if (client) clientId = client.id;
      }
    }
    if (!client) return { clientId: "", productId: "", priceId: "" };

    const products = client.products || [];
    let product = products.find((p) => p.id === productId) || null;
    const priceValue = sale?.price != null ? Number(sale.price) : fd.price != null ? Number(fd.price) : null;
    if (!product) {
      productId = "";
      const deviceType = String(sale?.device || fd.deviceType || "").trim().toLowerCase();
      let candidates = deviceType
        ? products.filter((p) => String(p.deviceType || "").trim().toLowerCase() === deviceType)
        : [];
      if (candidates.length > 1 && priceValue != null) {
        const withPrice = candidates.filter((p) => (p.prices || []).some((pr) => Number(pr.price) === priceValue));
        if (withPrice.length) candidates = withPrice;
      }
      if (candidates.length > 1) {
        const favored = candidates.filter((p) => p.isFavored);
        if (favored.length) candidates = favored;
      }
      product = candidates[0] || null;
      if (product) productId = product.id;
    }
    if (!product) return { clientId, productId: "", priceId: "" };

    const prices = product.prices || [];
    let price = prices.find((pr) => pr.id === priceId) || null;
    if (!price) {
      priceId = "";
      if (priceValue != null) {
        price = prices.find((pr) => Number(pr.price) === priceValue) || null;
        if (price) priceId = price.id;
      }
    }
    return { clientId, productId, priceId };
  }

  function clientPickerHtml(clients, selectedClientId, selectedProductId, selectedPriceId, formData) {
    const clientId = selectedClientId || formData.salesClientId || "";
    const productId = selectedProductId || formData.salesProductId || "";
    const priceId = selectedPriceId || formData.salesPriceId || "";
    const clientOpts = (clients || [])
      .map((c) => {
        const star = c.status === "warn" ? " ⚠" : c.status === "hold" ? " ⏸" : "";
        return `<option value="${c.id}" data-status="${c.status}" ${clientId === c.id ? "selected" : ""}>${escapeHtml(c.name)}${star}</option>`;
      })
      .join("");
    const client = (clients || []).find((c) => c.id === clientId);
    const products = (client?.products || []).slice().sort((a, b) => {
      if (a.isFavored !== b.isFavored) return a.isFavored ? -1 : 1;
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
    const productOpts = products
      .map((p) => {
        const star = p.isFavored ? " ★" : "";
        const note = p.priorityNote ? ` — ${p.priorityNote}` : "";
        return `<option value="${p.id}" data-device="${p.deviceType}" ${productId === p.id ? "selected" : ""}>${star}${escapeHtml(p.label || p.deviceType)}${escapeHtml(note)}</option>`;
      })
      .join("");
    const product = products.find((p) => p.id === productId);
    const prices = product?.prices || [];
    const priceOpts = prices
      .map((pr) => `<option value="${pr.id}" data-price="${pr.price}" ${priceId === pr.id ? "selected" : ""}>${escapeHtml(pr.label)} — $${pr.price}</option>`)
      .join("");

    return `
      <fieldset class="card card-flat sale-client-device" style="grid-column:1/-1">
        <legend>Client &amp; device</legend>
        <div class="field-grid">
          <label class="field"><span>Client</span>
            <select name="salesClientId" id="sale-client-select" required>
              <option value="">— Select client —</option>${clientOpts}
            </select>
            <small id="sale-client-status" class="muted"></small>
          </label>
          <label class="field"><span>Device / product</span>
            <select name="salesProductId" id="sale-product-select" required>
              <option value="">— Select device —</option>${productOpts}
            </select>
          </label>
          <label class="field"><span>Price tier</span>
            <select name="salesPriceId" id="sale-price-select" required>
              <option value="">— Select price —</option>${priceOpts}
            </select>
          </label>
          <input type="hidden" name="client" id="sale-client-name" value="${escapeHtml(client?.name || formData.client || "")}" />
          <input type="hidden" name="device" id="sale-device-type" value="${escapeHtml(product?.deviceType || formData.deviceType || formData.device || "")}" />
          <input type="hidden" name="price" id="sale-price-value" value="${escapeHtml(prices.find((pr) => pr.id === priceId)?.price ?? formData.price ?? "")}" />
        </div>
      </fieldset>`;
  }

  function wireClientPicker(root, clients) {
    const clientSel = root.querySelector("#sale-client-select");
    const productSel = root.querySelector("#sale-product-select");
    const priceSel = root.querySelector("#sale-price-select");
    const statusEl = root.querySelector("#sale-client-status");
    const nameInput = root.querySelector("#sale-client-name");
    const deviceInput = root.querySelector("#sale-device-type");
    const priceInput = root.querySelector("#sale-price-value");

    function refreshProducts() {
      const client = clients.find((c) => c.id === clientSel.value);
      if (statusEl && client) {
        if (client.status === "hold") statusEl.textContent = client.statusMessage || "Client on hold";
        else if (client.status === "warn") statusEl.textContent = client.statusMessage || "Submitting to this client requires confirmation";
        else if (client.status === "disabled") statusEl.textContent = "Client disabled";
        else statusEl.textContent = "";
      }
      if (nameInput) nameInput.value = client?.name || "";
      const products = (client?.products || []).slice().sort((a, b) => (a.isFavored === b.isFavored ? 0 : a.isFavored ? -1 : 1));
      productSel.innerHTML = `<option value="">— Select device —</option>${products
        .map((p) => `<option value="${p.id}" data-device="${p.deviceType}">${p.isFavored ? "★ " : ""}${p.label || p.deviceType}</option>`)
        .join("")}`;
      priceSel.innerHTML = '<option value="">— Select price —</option>';
      if (deviceInput) deviceInput.value = "";
      if (priceInput) priceInput.value = "";
    }

    function refreshPrices() {
      const client = clients.find((c) => c.id === clientSel.value);
      const product = client?.products?.find((p) => p.id === productSel.value);
      if (deviceInput) deviceInput.value = product?.deviceType || "";
      const prices = product?.prices || [];
      priceSel.innerHTML = `<option value="">— Select price —</option>${prices
        .map((pr) => `<option value="${pr.id}" data-price="${pr.price}">${pr.label} — $${pr.price}</option>`)
        .join("")}`;
      if (priceInput) priceInput.value = "";
    }

    clientSel?.addEventListener("change", refreshProducts);
    productSel?.addEventListener("change", refreshPrices);
    priceSel?.addEventListener("change", () => {
      const opt = priceSel.selectedOptions[0];
      if (priceInput && opt) priceInput.value = opt.dataset.price || "";
    });
  }

  async function validateClientSubmit(clients, clientId, productId, priceId) {
    if ((clients || []).length) {
      if (!clientId || !productId || !priceId) {
        alert("Select client, device, and price from the catalog list.");
        return false;
      }
    }
    const client = (clients || []).find((c) => c.id === clientId);
    if (!client) {
      if ((clients || []).length) {
        alert("Invalid client selection.");
        return false;
      }
      return true;
    }
    if (!client) return true;
    if (client.status === "disabled") {
      alert("This client is disabled. Choose another client.");
      return false;
    }
    if (client.status === "hold") {
      alert(client.statusMessage || "This client is on hold. Submissions are blocked.");
      return false;
    }
    if (client.status === "warn") {
      const msg = client.statusMessage || "Are you sure you want to submit to this client?";
      return window.confirm(msg);
    }
    return true;
  }

  function attachmentRowHtml(a, escapeHtml, canEdit) {
    const actions = canEdit
      ? `<button type="button" class="btn btn-sm" data-att-download="${a.id}">Download</button>
         <button type="button" class="btn btn-sm" data-att-share="${a.id}">Share link</button>
         <button type="button" class="btn btn-sm btn-warn" data-att-replace="${a.id}">Replace</button>
         <button type="button" class="btn btn-sm btn-danger" data-att-delete="${a.id}">Delete</button>`
      : `<button type="button" class="btn btn-sm" data-att-download="${a.id}">Download</button>
         <button type="button" class="btn btn-sm" data-att-share="${a.id}">Share link</button>`;
    return `<div class="adj-row attachment-row">
      <button type="button" class="btn btn-sm btn-link" data-open-attach="${a.id}">${escapeHtml(a.fileName)}</button>
      <span class="muted">${escapeHtml(a.kind || "")}</span>
      <div class="attachment-actions">${actions}</div>
    </div>`;
  }

  function showShareLinkModal(url, meta = {}) {
    const esc = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s || "");
    const note =
      meta.storage === "supabase"
        ? `Signed Supabase link (about ${meta.expiresInDays || 7} days). Use Share link again to refresh.`
        : "Copy this link:";
    if (typeof openModal !== "function") {
      prompt(note, url);
      return;
    }
    openModal(
      `<div class="modal-header"><h2>Share link</h2><button class="btn btn-sm" data-close>✕</button></div>
      <div class="modal-body">
        <p class="muted">${esc(note)}</p>
        <input type="text" class="search-input" id="share-link-copy" readonly value="${esc(url)}" style="width:100%" />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="share-link-copy-btn">Copy to clipboard</button>
      </div>`
    );
    document.getElementById("share-link-copy-btn")?.addEventListener("click", async () => {
      const input = document.getElementById("share-link-copy");
      try {
        await navigator.clipboard.writeText(input?.value || url);
        alert("Link copied");
      } catch {
        input?.select();
        document.execCommand?.("copy");
        alert("Select the link and copy manually if needed");
      }
    });
  }

  function wireAttachmentActions(container, api, openSaleAttachment, canEditFn, onMutated) {
    container.querySelectorAll("[data-open-attach]").forEach((btn) => {
      btn.onclick = () => openSaleAttachment(btn.dataset.openAttach, btn.textContent);
    });
    container.querySelectorAll("[data-att-download]").forEach((btn) => {
      btn.onclick = async () => {
        const sessionId = typeof getSessionId === "function" ? getSessionId() : "";
        const res = await fetch(`/api/sales/attachments/${btn.dataset.attDownload}/download`, {
          headers: sessionId ? { "x-session-id": sessionId } : {},
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return alert(err.error || `Download failed (${res.status})`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = btn.closest(".attachment-row")?.querySelector("[data-open-attach]")?.textContent || "recording";
        a.click();
        URL.revokeObjectURL(url);
      };
    });
    container.querySelectorAll("[data-att-share]").forEach((btn) => {
      btn.onclick = async () => {
        try {
          const res = await api(`/sales/attachments/${btn.dataset.attShare}/share-link`);
          if (!res.url) return alert(res.error || "No share link available.");
          const copiedMsg =
            res.storage === "supabase"
              ? `Share link copied (~${res.expiresInDays || 7} days; use Share link again to refresh)`
              : "Share link copied to clipboard";
          try {
            await navigator.clipboard.writeText(res.url);
            alert(copiedMsg);
          } catch {
            showShareLinkModal(res.url, res);
          }
        } catch (e) {
          alert(e.message || "Could not get share link");
        }
      };
    });
    container.querySelectorAll("[data-att-delete]").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Delete this recording?")) return;
        if (!confirm("This cannot be undone. Delete permanently?")) return;
        try {
          await api(`/sales/attachments/${btn.dataset.attDelete}`, { method: "DELETE" });
          if (typeof onMutated === "function") {
            await onMutated();
          } else {
            const row = btn.closest(".attachment-row");
            const group = btn.closest(".attachment-kind-group");
            row?.remove();
            if (group && !group.querySelector(".attachment-row")) group.remove();
            if (!container.querySelector(".attachment-row") && !container.querySelector(".attachment-kind-group")) {
              container.innerHTML = "<span class='muted'>No attachments yet</span>";
            }
          }
        } catch (e) {
          alert(e.message || "Could not delete attachment");
        }
      };
    });
    container.querySelectorAll("[data-att-replace]").forEach((btn) => {
      btn.onclick = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*,image/*,.pdf";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          if (!confirm(`Replace with "${file.name}"?`)) return;
          if (!confirm("Confirm replace — old file will be removed.")) return;
          try {
            const b64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            });
            await api(`/sales/attachments/${btn.dataset.attReplace}/replace`, {
              method: "PUT",
              body: JSON.stringify({ fileName: file.name, contentBase64: b64 }),
            });
            if (typeof onMutated === "function") await onMutated();
            else alert("File replaced");
          } catch (e) {
            alert(e.message || "Replace failed");
          }
        };
        input.click();
      };
    });
  }

  function readFileBase64WithProgress(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 45));
        }
      };
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function uploadSaleAttachmentWithProgress(saleId, file, kind, { onProgress, getSessionId } = {}) {
    return readFileBase64WithProgress(file, onProgress).then(
      (contentBase64) =>
        new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const sessionId = typeof getSessionId === "function" ? getSessionId() : "";
          xhr.open("POST", `/api/sales/${encodeURIComponent(saleId)}/attachments`);
          xhr.setRequestHeader("Content-Type", "application/json");
          if (sessionId) xhr.setRequestHeader("x-session-id", sessionId);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
              onProgress(45 + Math.round((e.loaded / e.total) * 55));
            }
          };
          xhr.onload = () => {
            let data = {};
            try {
              data = JSON.parse(xhr.responseText || "{}");
            } catch {
              /* ignore */
            }
            if (xhr.status >= 200 && xhr.status < 300) {
              onProgress?.(100);
              resolve(data);
            } else {
              reject(new Error(data.error || xhr.statusText || "Upload failed"));
            }
          };
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.send(JSON.stringify({ fileName: file.name, contentBase64, kind }));
        })
    );
  }

  function bindImmediateSaleAttachmentUploads(scopeEl, saleId, attachKinds, { refreshList, getSessionId } = {}) {
    if (!scopeEl || !saleId) return;
    const uploading = new Set();
    const editableKinds = new Set((attachKinds || []).filter((k) => k.canEdit).map((k) => k.key));
    scopeEl.querySelectorAll("input[data-attach-kind]").forEach((input) => {
      if (input.dataset.immediateUploadBound === "1") return;
      input.dataset.immediateUploadBound = "1";
      input.addEventListener("change", async () => {
        const files = [...(input.files || [])];
        if (!files.length) return;
        const kind = input.dataset.attachKind || "recording";
        if (!editableKinds.has(kind)) return;
        input.disabled = true;
        const statusEl = scopeEl.querySelector(`[data-upload-status="${kind}"]`);
        const fill = statusEl?.querySelector(".upload-meter-fill");
        const label = statusEl?.querySelector(".upload-meter-label");
        if (statusEl) statusEl.hidden = false;
        const setProgress = (pct) => {
          if (fill) fill.style.width = `${Math.min(100, pct)}%`;
          if (label) label.textContent = pct >= 100 ? "Uploaded" : `Uploading… ${pct}%`;
        };
        let done = 0;
        try {
          for (const file of files) {
            const dedupeKey = `${kind}:${file.name}:${file.size}:${file.lastModified}`;
            if (uploading.has(dedupeKey)) continue;
            uploading.add(dedupeKey);
            try {
              setProgress(Math.round((done / files.length) * 100));
              await uploadSaleAttachmentWithProgress(saleId, file, kind, {
                onProgress: (pct) => {
                  const overall = Math.round(((done + pct / 100) / files.length) * 100);
                  setProgress(overall);
                },
                getSessionId,
              });
              done += 1;
            } finally {
              uploading.delete(dedupeKey);
            }
          }
          input.dataset.uploaded = "1";
          input.value = "";
          setProgress(100);
          if (typeof refreshList === "function") await refreshList();
        } catch (e) {
          alert(e.message || "Upload failed");
          input.value = "";
        } finally {
          input.disabled = false;
          setTimeout(() => {
            if (statusEl) statusEl.hidden = true;
            if (fill) fill.style.width = "0%";
          }, 1200);
        }
      });
    });
  }

  function teamsForUnit(orgTeams, unit) {
    const teams = orgTeams || [];
    if (!unit) return teams.filter((t) => t.dialsSales !== false);
    return teams.filter((t) => t.unit === unit && t.dialsSales !== false);
  }

  function isDialingEmployee(e) {
    const id = String(e?.id || "");
    if (/^(TL|CL|OP|HR|MG|OF|NW|DEL)/i.test(id)) return false;
    return String(e?.status || "").toLowerCase() !== "deleted";
  }

  function isCloserCandidate(e) {
    const id = String(e?.id || "");
    const role = String(e?.role || "").toLowerCase();
    if (/^(TL|CL|OP)/i.test(id)) return true;
    if (["tl", "op"].includes(role)) return true;
    return isDialingEmployee(e);
  }

  function isDualRoleAgent(user) {
    return user?.role === "agent" && (user?.leadTeams || []).length > 0;
  }

  function unitsForSubmitUser(user) {
    const units = new Set();
    if (user?.unit) units.add(user.unit);
    for (const lt of user?.leadTeams || []) {
      if (lt.unit) units.add(lt.unit);
    }
    return [...units];
  }

  function isBroadSubmitter(user) {
    const role = String(user?.role || "").toLowerCase();
    return ["admin", "ceo", "hr", "finance", "quality", "rtm", "public_relations"].includes(role);
  }

  function pickAgentsForSubmit(user, employees) {
    if (isBroadSubmitter(user)) {
      return (employees || []).filter((e) => isDialingEmployee(e));
    }
    const role = String(user?.role || "").toLowerCase();
    if (role === "tl" || role === "op") {
      const unit = user?.unit;
      return (employees || []).filter((e) => isDialingEmployee(e) && (!unit || e.unit === unit));
    }
    if (role === "agent") {
      if (isDualRoleAgent(user)) {
        const units = new Set(unitsForSubmitUser(user));
        return (employees || []).filter((e) => isDialingEmployee(e) && units.has(e.unit));
      }
      return (employees || []).filter((e) => e.id === user?.employeeId);
    }
    return (employees || []).filter((e) => isDialingEmployee(e));
  }

  function pickClosersForSubmit(_user, employees) {
    return (employees || []).filter((e) => isCloserCandidate(e));
  }

  function allowedUnitsForSubmit(user, orgTeams) {
    const dialing = (orgTeams || []).filter((t) => t.dialsSales !== false);
    if (isBroadSubmitter(user)) {
      return [...new Set(dialing.map((t) => t.unit).filter(Boolean))].sort();
    }
    const role = String(user?.role || "").toLowerCase();
    if (role === "tl" || role === "op") {
      return user?.unit ? [user.unit] : unitsForSubmitUser(user);
    }
    if (role === "agent") {
      if (isDualRoleAgent(user)) return unitsForSubmitUser(user).sort();
      return user?.unit ? [user.unit] : [];
    }
    return unitsForSubmitUser(user);
  }

  function closerOptionsHtml(closers, escapeHtml, selectedId) {
    const leaders = (closers || [])
      .filter((e) => /^(TL|CL|OP)/i.test(String(e.id || "")) || ["tl", "op"].includes(String(e.role || "").toLowerCase()))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const agents = (closers || [])
      .filter((e) => isDialingEmployee(e))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let html = '<option value="">— Select closer —</option>';
    for (const e of leaders) {
      html += `<option value="${escapeHtml(e.id)}" ${selectedId === e.id ? "selected" : ""}>★ ${escapeHtml(e.id)} — ${escapeHtml(e.american_name || e.id)}</option>`;
    }
    if (leaders.length && agents.length) html += '<option disabled>— Dialing agents —</option>';
    for (const e of agents) {
      html += `<option value="${escapeHtml(e.id)}" ${selectedId === e.id ? "selected" : ""}>${escapeHtml(e.id)} — ${escapeHtml(e.american_name || e.id)}</option>`;
    }
    return html;
  }

  function agentOptionsForUnit(scopedAgents, unit, escapeHtml, selectedId) {
    const list = (scopedAgents || [])
      .filter((e) => isDialingEmployee(e) && (!unit || e.unit === unit))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return list
      .map(
        (e) =>
          `<option value="${escapeHtml(e.id)}" ${selectedId === e.id ? "selected" : ""}>${escapeHtml(e.id)} — ${escapeHtml(e.american_name || e.id)}</option>`
      )
      .join("");
  }

  function agentOptionsForTeam(scopedAgents, teamName, escapeHtml, selectedId) {
    const norm = (t) => String(t || "").replace(/^team\s+/i, "").trim().toLowerCase();
    const want = norm(teamName);
    const list = (scopedAgents || [])
      .filter((e) => isDialingEmployee(e) && norm(e.team) === want)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return list
      .map(
        (e) =>
          `<option value="${escapeHtml(e.id)}" ${selectedId === e.id ? "selected" : ""}>${escapeHtml(e.id)} — ${escapeHtml(e.american_name || e.id)}</option>`
      )
      .join("");
  }

  function unitTeamPickerHtml(orgTeams, scopedAgents, scopedClosers, sale, escapeHtml, defaultCloserId, pickerOpts = {}) {
    const { lockAgent = false, lockTeam = false, lockUnit = false, allowedUnits = [] } = pickerOpts;
    const dialingTeams = (orgTeams || []).filter((t) => t.dialsSales !== false);
    const units = allowedUnits.length
      ? allowedUnits
      : [...new Set(dialingTeams.map((t) => t.unit).filter(Boolean))].sort();
    const agentId = sale?.agentId || "";
    const agent = scopedAgents.find((e) => e.id === agentId) || {};
    const defaultUnit = sale?.unit || agent.unit || units[0] || "";
    const defaultTeam = sale?.team || agent.team || "";
    const unitOpts = units
      .map((u) => `<option value="${escapeHtml(u)}" ${defaultUnit === u ? "selected" : ""}>${escapeHtml(u)}</option>`)
      .join("");
    const teamOpts = teamsForUnit(dialingTeams, defaultUnit)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || String(a.name).localeCompare(String(b.name)))
      .map((t) => `<option value="${escapeHtml(t.name)}" ${defaultTeam === t.name ? "selected" : ""}>${escapeHtml(t.name)}</option>`)
      .join("");
    const agentOpts = lockTeam
      ? agentOptionsForUnit(scopedAgents, defaultUnit, escapeHtml, agentId)
      : agentOptionsForTeam(scopedAgents, defaultTeam, escapeHtml, agentId);
    const unitName = lockUnit ? "" : ' name="unit"';
    const teamName = lockTeam ? "" : ' name="team"';
    const agentName = lockAgent ? "" : ' name="agentId"';
    const hiddenFields = [
      lockUnit ? `<input type="hidden" name="unit" id="sale-unit-hidden" value="${escapeHtml(defaultUnit)}" />` : "",
      lockTeam ? `<input type="hidden" name="team" id="sale-team-hidden" value="${escapeHtml(defaultTeam)}" />` : "",
      lockAgent ? `<input type="hidden" name="agentId" id="sale-agent-hidden" value="${escapeHtml(agentId)}" />` : "",
    ].join("");
    return `
      <fieldset class="card card-flat sale-unit-team" style="grid-column:1/-1">
        <legend>Unit, team &amp; assignment</legend>
        <div class="field-grid">
          ${hiddenFields}
          <label class="field"><span>Unit</span>
            <select id="sale-unit-select"${unitName} required ${lockUnit ? "disabled" : ""}>
              <option value="">— Select unit —</option>${unitOpts}
            </select>
          </label>
          <label class="field"><span>Team</span>
            <select id="sale-team-select"${teamName} required ${lockTeam ? "disabled" : ""}>
              <option value="">— Select team —</option>${teamOpts}
            </select>
          </label>
          <label class="field"><span>Agent</span>
            <select id="sale-agent-select"${agentName} required ${lockAgent ? "disabled" : ""}>
              <option value="">— Select agent —</option>${agentOpts}
            </select>
          </label>
          <label class="field"><span>Closer</span>
            <select name="closerId" id="sale-closer-select">${closerOptionsHtml(scopedClosers, escapeHtml, defaultCloserId || "")}</select>
          </label>
        </div>
      </fieldset>`;
  }

  function wireUnitTeamPicker(form, orgTeams, scopedAgents, scopedClosers, pickerOpts = {}) {
    const { lockAgent = false, lockTeam = true, lockUnit = false, allowedUnits = [] } = pickerOpts;
    const unitSel = form.querySelector("#sale-unit-select");
    const teamSel = form.querySelector("#sale-team-select");
    const agentSel = form.querySelector("#sale-agent-select") || form.querySelector('[name="agentId"]');
    const closerSel = form.querySelector("#sale-closer-select");
    const teamHidden = form.querySelector("#sale-team-hidden");
    const unitHidden = form.querySelector("#sale-unit-hidden");
    const dialingTeams = (orgTeams || []).filter((t) => t.dialsSales !== false);
    const esc = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s || "");

    function ensureTeamOption(teamName) {
      if (!teamSel || !teamName) return;
      const exists = [...teamSel.options].some((o) => o.value === teamName);
      if (!exists) {
        const opt = document.createElement("option");
        opt.value = teamName;
        opt.textContent = teamName;
        teamSel.appendChild(opt);
      }
      teamSel.value = teamName;
    }

    function syncAssignmentHiddenFields() {
      const unitVal = unitSel?.value || unitHidden?.value || "";
      const teamVal = teamSel?.value || teamHidden?.value || "";
      const agentVal = agentSel?.value || form.querySelector("#sale-agent-hidden")?.value || "";
      if (unitHidden && unitVal) unitHidden.value = unitVal;
      if (teamHidden && teamVal) teamHidden.value = teamVal;
      const agentHidden = form.querySelector("#sale-agent-hidden");
      if (agentHidden && agentVal) agentHidden.value = agentVal;
    }

    function syncTeamFromAgent(agentId) {
      const agent = scopedAgents.find((e) => e.id === agentId);
      if (!agent) return;
      const team = agent.team || "";
      ensureTeamOption(team);
      if (teamHidden) teamHidden.value = team;
      if (agent.unit && unitSel && !lockUnit) {
        unitSel.value = agent.unit;
        if (unitHidden) unitHidden.value = agent.unit;
      } else if (agent.unit && unitHidden) {
        unitHidden.value = agent.unit;
      }
      syncAssignmentHiddenFields();
    }

    function refreshCloserOptions() {
      if (!closerSel) return;
      closerSel.innerHTML = closerOptionsHtml(scopedClosers, esc, closerSel.value);
    }

    function refreshAgentOptionsForUnit(unit, selectedId) {
      if (!agentSel) return;
      const opts = lockTeam
        ? agentOptionsForUnit(scopedAgents, unit, esc, selectedId || agentSel.value)
        : agentOptionsForTeam(scopedAgents, teamSel?.value, esc, selectedId || agentSel.value);
      agentSel.innerHTML = `<option value="">— Select agent —</option>${opts}`;
      if (selectedId) agentSel.value = selectedId;
      if (selectedId) syncTeamFromAgent(selectedId);
    }

    function refreshTeamOptions(unit, selectedTeam) {
      if (!teamSel) return;
      const opts = teamsForUnit(dialingTeams, unit)
        .filter((t) => !allowedUnits.length || allowedUnits.includes(t.unit))
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || String(a.name).localeCompare(String(b.name)))
        .map((t) => `<option value="${esc(t.name)}" ${selectedTeam === t.name ? "selected" : ""}>${esc(t.name)}</option>`)
        .join("");
      teamSel.innerHTML = `<option value="">— Select team —</option>${opts}`;
      if (lockTeam) {
        refreshAgentOptionsForUnit(unit, agentSel?.value);
      } else {
        refreshAgentOptionsForUnit(unit, agentSel?.value);
        if (selectedTeam) ensureTeamOption(selectedTeam);
      }
    }

    if (!lockUnit) {
      unitSel?.addEventListener("change", () => {
        if (unitHidden) unitHidden.value = unitSel.value;
        refreshTeamOptions(unitSel.value, "");
        refreshAgentOptionsForUnit(unitSel.value, "");
        syncAssignmentHiddenFields();
      });
    }
    if (!lockTeam) {
      teamSel?.addEventListener("change", () => {
        if (teamHidden) teamHidden.value = teamSel.value;
        refreshAgentOptionsForUnit(unitSel?.value || unitHidden?.value, "");
        syncAssignmentHiddenFields();
      });
    }
    agentSel?.addEventListener("change", () => {
      syncTeamFromAgent(agentSel.value);
      syncAssignmentHiddenFields();
    });

    if (agentSel && unitSel && teamSel) {
      const agent = scopedAgents.find((e) => e.id === agentSel.value);
      const unit = agent?.unit || unitSel.value || unitHidden?.value;
      if (agent?.unit && !lockUnit) {
        unitSel.value = agent.unit;
      }
      if (unit) refreshTeamOptions(unit, agent?.team || teamSel.value);
      if (agentSel.value) syncTeamFromAgent(agentSel.value);
    }
    refreshCloserOptions();
    form._syncAssignmentHiddenFields = syncAssignmentHiddenFields;
    syncAssignmentHiddenFields();
  }

  async function injectUnitTeamPickerBlock(form, sale, employees, api, escapeHtml, mode) {
    const teamsRes = await api("/hrms/teams").catch(() => ({ teams: [] }));
    const orgTeams = teamsRes.teams || [];
    const user = state.user || {};
    const scopedAgents = pickAgentsForSubmit(user, employees || []);
    const scopedClosers = pickClosersForSubmit(user, employees || []);
    const selfEmp = (employees || []).find((e) => e.id === user.employeeId);
    const isDialingSelf =
      user.employeeId &&
      !/^(TL|CL|OP|HR|MG|OF|NW)/i.test(String(user.employeeId)) &&
      scopedAgents.some((e) => e.id === user.employeeId);
    const defaultAgentId = sale?.agentId || (isDialingSelf ? user.employeeId : "");
    const defaultCloserId = sale?.closerId || user.employeeId || "";
    const draftSale = sale?.id
      ? { unit: sale.unit, team: sale.team, agentId: sale.agentId }
      : { unit: selfEmp?.unit || user.unit, team: selfEmp?.team, agentId: defaultAgentId };
    const plainAgent = user.role === "agent" && !isDualRoleAgent(user);
    const allUnits = [...new Set((orgTeams || []).map((t) => t.unit).filter(Boolean))].sort();
    const pickerOpts =
      mode === "create"
        ? {
            lockAgent: plainAgent,
            lockTeam: true,
            lockUnit: plainAgent || ["tl", "op"].includes(user.role),
            allowedUnits: allowedUnitsForSubmit(user, orgTeams),
          }
        : { lockAgent: false, lockTeam: false, lockUnit: false, allowedUnits: allUnits };
    const unitTeamWrap = document.createElement("div");
    unitTeamWrap.innerHTML = unitTeamPickerHtml(
      orgTeams,
      scopedAgents,
      scopedClosers,
      draftSale,
      escapeHtml,
      defaultCloserId,
      pickerOpts
    );
    const agentField = form.querySelector('[name="agentId"]')?.closest("label");
    if (agentField) agentField.remove();
    const closerField = form.querySelector('[name="closerId"]')?.closest("label");
    if (closerField) closerField.remove();
    const summary = form.querySelector(".quality-ticket-summary");
    const firstFieldset = form.querySelector("fieldset");
    const insertBefore = summary?.nextElementSibling || firstFieldset;
    if (insertBefore) form.insertBefore(unitTeamWrap.firstElementChild, insertBefore);
    else form.prepend(unitTeamWrap.firstElementChild);
    wireUnitTeamPicker(form, orgTeams, scopedAgents, scopedClosers, pickerOpts);
  }

  async function enhanceSaleModal(api, helpers, sale, employees, formRoot, canEditFn, openSaleAttachment, modalOpts = {}) {
    const { escapeHtml } = helpers;
    const mode = modalOpts.mode || (sale?.id ? "edit" : "create");
    const formSelector = modalOpts.formSelector || "#sale-form";
    const catalog = await loadCatalog(api).catch(() => ({ clients: [] }));
    const clients = catalog.clients || [];
    const formData = sale?.formData || {};
    const form = formRoot.querySelector(formSelector) || formRoot;

    const canReassign = state.user?.canReassignSaleLead === true;
    const showPickers = !sale?.id || (canReassign && sale?.id && (mode === "edit" || mode === "quality"));
    if (showPickers) {
      await injectUnitTeamPickerBlock(form, sale, employees, api, escapeHtml, sale?.id ? mode : "create");
    }

    if (formSelector === "#sale-form" && clients.length) {
      const resolved = resolveCatalogSelection(clients, sale, formData);
      const picker = document.createElement("div");
      picker.innerHTML = clientPickerHtml(clients, resolved.clientId, resolved.productId, resolved.priceId, formData);
      const firstFieldset = form.querySelector("fieldset");
      if (firstFieldset) form.insertBefore(picker.firstElementChild, firstFieldset);
      else form.prepend(picker.firstElementChild);
      wireClientPicker(form, clients);
      const clientField = form.querySelector('[name="client"]');
      if (clientField?.closest("label")) clientField.closest("label").style.display = "none";
      const deviceField = form.querySelector('[name="device"]') || form.querySelector('[name="deviceType"]');
      if (deviceField?.closest("label")) deviceField.closest("label").style.display = "none";
      const priceField = form.querySelector('[name="price"]');
      if (priceField?.closest("label")) priceField.closest("label").style.display = "none";
    } else if (formSelector === "#sale-form" && !sale?.id) {
      const warn = document.createElement("p");
      warn.className = "alert alert-warn";
      warn.style.gridColumn = "1 / -1";
      warn.textContent = "No sales clients configured. Contact RTM or Admin to set up clients and devices in Settings.";
      form.prepend(warn);
    }

    for (const name of ["unit", "team", "client", "device", "deviceType", "price"]) {
      form.querySelectorAll(`[name="${name}"]`).forEach((el) => {
        const label = el.closest("label");
        if (label && !label.closest(".sale-unit-team") && !label.closest(".sale-client-device")) {
          label.remove();
        }
      });
    }

    const listEl = form.querySelector("#sale-attachments-list");
    if (listEl && sale?.id) {
      const catalogRes = await api(`/sales/field-catalog?surface=main&saleId=${encodeURIComponent(sale.id)}`).catch(
        () => ({ attachmentKinds: [] })
      );
      const attachKinds = (catalogRes.attachmentKinds || []).filter((k) => k.canView);
      const refreshList = async () => {
        const res = await api(`/sales/${sale.id}/attachments`).catch(() => ({ attachments: [] }));
        const list = res.attachments || [];
        const kindCanEdit = Object.fromEntries(attachKinds.map((k) => [k.key, k.canEdit === true]));
        listEl.innerHTML = list.length
          ? list
              .map((a) => attachmentRowHtml(a, helpers.escapeHtml, () => kindCanEdit[a.kind] === true))
              .join("")
          : "<span class='muted'>No attachments yet</span>";
        wireAttachmentActions(listEl, api, openSaleAttachment, canEditFn, refreshList);
      };
      await refreshList();
      bindImmediateSaleAttachmentUploads(form, sale.id, attachKinds, {
        refreshList,
        getSessionId: typeof getSessionId === "function" ? getSessionId : () => "",
      });
    }

    return { clients };
  }

  async function renderBreaksPage(root, api, state, helpers) {
    const { escapeHtml } = helpers;
    const data = await loadBreaks(api, true);
    const active = window.__hrActiveBreak || null;
    root.innerHTML = `
      <div class="page-header"><h1>Breaks</h1></div>
      <div class="card">
        <h3>Current break</h3>
        ${
          active
            ? `<p><strong>${escapeHtml(active.name)}</strong> until ${escapeHtml(active.endTime || "")}</p>
               <button class="btn btn-primary" id="breaks-show-popup">Show break timer</button>
               <button class="btn btn-sm" id="breaks-dismiss">Dismiss popup for this break</button>`
            : `<p class="muted">No active break for your unit/role right now.</p>`
        }
      </div>
      <div class="card">
        <h3>Today's schedules</h3>
        <ul>${(data.breaks || [])
          .filter((b) => b.active)
          .map(
            (b) =>
              `<li><strong>${escapeHtml(b.name)}</strong> ${escapeHtml(formatTimeAmPm(b.startTime))} – ${escapeHtml(formatTimeAmPm(b.endTime))} (${b.durationMinutes} min) · Egypt time</li>`
          )
          .join("") || "<li class='muted'>None configured</li>"}</ul>
      </div>`;
    root.querySelector("#breaks-show-popup")?.addEventListener("click", () => showBreakOverlay(active));
    root.querySelector("#breaks-dismiss")?.addEventListener("click", () => {
      if (active) sessionStorage.setItem(`hr_break_dismissed_${active.id}`, "1");
      if (breakOverlayEl) breakOverlayEl.classList.add("hidden");
    });
  }

  async function enhanceSettings(root, api, state, helpers) {
    if (!canManage(state)) return;
    const { escapeHtml, openModal, closeModal } = helpers;
    const wrap = document.createElement("div");
    wrap.className = "grid-2";
    wrap.style.gridColumn = "1 / -1";
    wrap.innerHTML = `
      <div class="card" style="grid-column:1/-1"><h3>Sales clients</h3>
        <p class="muted">Clients, devices, and price tiers for closers/TL/OP. Changes apply to all active sessions.</p>
        <button class="btn btn-primary btn-sm" id="sc-add-client">Add client</button>
        <button class="btn btn-sm" id="sc-import-sales" title="Import distinct clients, devices, and prices from existing sales">Import from sales</button>
        <div id="sc-clients-list" class="muted" style="margin-top:.75rem">Loading…</div>
      </div>
      <div class="card" style="grid-column:1/-1"><h3>Break schedules</h3>
        <p class="muted">Fullscreen break popup by unit and role.</p>
        <button class="btn btn-primary btn-sm" id="sc-add-break">Add break</button>
        <div id="sc-breaks-list" class="muted" style="margin-top:.75rem">Loading…</div>
      </div>`;
    root.querySelector(".grid-2")?.appendChild(wrap);

    async function refreshClients() {
      const data = await api("/sales-config/clients");
      const el = document.getElementById("sc-clients-list");
      if (!el) return;
      el.innerHTML = (data.clients || [])
        .map((c) => {
          const prods = (c.products || [])
            .map((p) => {
              const priceRows = (p.prices || [])
                .map(
                  (pr) =>
                    `<li class="price-tier-row adj-row" style="margin:.2rem 0;padding-left:1rem;gap:.35rem;flex-wrap:wrap" data-price-id="${pr.id}" data-product-id="${p.id}">
                      <input type="text" class="price-tier-label" value="${escapeHtml(pr.label)}" style="min-width:6rem;flex:1" />
                      <input type="number" class="price-tier-price" min="0" step="0.01" value="${Number(pr.price) || 0}" style="width:5rem" />
                      <button type="button" class="btn btn-sm btn-primary price-tier-save" title="Save">✓</button>
                      <button type="button" class="btn btn-sm btn-danger" data-del-price="${pr.id}" title="Delete">✕</button>
                    </li>`
                )
                .join("");
              return `<li style="margin:.35rem 0">
                <div class="adj-row">
                  <span>${p.isFavored ? "★ " : ""}<strong>${escapeHtml(p.label)}</strong> (${escapeHtml(p.deviceType)})</span>
                  <button type="button" class="btn btn-sm" data-toggle-favored="${p.id}" data-client="${c.id}" title="Toggle favored">${p.isFavored ? "Unstar" : "★ Favor"}</button>
                  <button type="button" class="btn btn-sm" data-edit-product="${p.id}" data-client="${c.id}">Edit</button>
                  <button type="button" class="btn btn-sm btn-danger" data-del-product="${p.id}">Delete</button>
                  <button type="button" class="btn btn-sm" data-add-price="${p.id}">Add price</button>
                </div>
                <ul class="muted" style="margin:.25rem 0 0 1rem">${priceRows || "<li>No price tiers</li>"}</ul>
              </li>`;
            })
            .join("");
          return `<div class="card card-flat" style="margin:.5rem 0">
            <div class="adj-row"><strong>${escapeHtml(c.name)}</strong>
              <span class="badge">${escapeHtml(c.status)}</span>
              <button class="btn btn-sm" data-edit-client="${c.id}">Edit</button>
              <button class="btn btn-sm" data-add-product="${c.id}">Add device</button>
              <button class="btn btn-sm btn-danger" data-del-client="${c.id}">Delete</button>
            </div>
            ${c.statusMessage ? `<p class="muted">${escapeHtml(c.statusMessage)}</p>` : ""}
            <ul>${prods || "<li class='muted'>No devices</li>"}</ul>
          </div>`;
        })
        .join("") || "<p>No clients yet</p>";
      const clients = data.clients || [];
      el.querySelectorAll("[data-edit-client]").forEach((btn) => {
        btn.onclick = () => openClientModal(clients.find((x) => x.id === btn.dataset.editClient));
      });
      el.querySelectorAll("[data-add-product]").forEach((btn) => {
        btn.onclick = () => openProductModal(btn.dataset.addProduct);
      });
      el.querySelectorAll("[data-edit-product]").forEach((btn) => {
        const client = clients.find((x) => x.id === btn.dataset.client);
        const product = client?.products?.find((p) => p.id === btn.dataset.editProduct);
        btn.onclick = () => openProductModal(btn.dataset.client, product);
      });
      el.querySelectorAll("[data-del-product]").forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm("Delete this device and its prices?")) return;
          await api(`/sales-config/products/${btn.dataset.delProduct}`, { method: "DELETE" });
          refreshClients();
        };
      });
      el.querySelectorAll("[data-toggle-favored]").forEach((btn) => {
        btn.onclick = async () => {
          const client = clients.find((x) => x.id === btn.dataset.client);
          const product = client?.products?.find((p) => p.id === btn.dataset.toggleFavored);
          if (!product) return;
          await api(`/sales-config/products/${product.id}`, {
            method: "PATCH",
            body: JSON.stringify({ clientId: client.id, deviceType: product.deviceType, label: product.label, isFavored: !product.isFavored }),
          });
          refreshClients();
        };
      });
      el.querySelectorAll(".price-tier-save").forEach((btn) => {
        btn.onclick = async () => {
          const row = btn.closest(".price-tier-row");
          const priceId = row?.dataset.priceId;
          const productId = row?.dataset.productId;
          const label = row?.querySelector(".price-tier-label")?.value?.trim();
          const priceVal = row?.querySelector(".price-tier-price")?.value;
          const price = priceVal === "" || priceVal == null ? 0 : Number(priceVal);
          if (!label) return alert("Label required");
          await api(`/sales-config/prices/${priceId}`, {
            method: "PATCH",
            body: JSON.stringify({ productId, label, price }),
          });
          refreshClients();
        };
      });
      el.querySelectorAll("[data-add-price]").forEach((btn) => {
        btn.onclick = () => openPriceModal(btn.dataset.addPrice);
      });
      el.querySelectorAll("[data-del-price]").forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm("Delete this price tier?")) return;
          await api(`/sales-config/prices/${btn.dataset.delPrice}`, { method: "DELETE" });
          refreshClients();
        };
      });
      el.querySelectorAll("[data-del-client]").forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm("Delete client and all devices?")) return;
          await api(`/sales-config/clients/${btn.dataset.delClient}`, { method: "DELETE" });
          refreshClients();
        };
      });
    }

    function openPriceModal(productId, price) {
      const pr = price || { label: "Standard", price: 0 };
      openModal(`<div class="modal-header"><h2>${price ? "Edit" : "Add"} price tier</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="sc-price-form" class="form-grid modal-body">
          <label class="field"><span>Label</span><input name="label" required value="${escapeHtml(pr.label || "")}" /></label>
          <label class="field"><span>Price ($)</span><input name="price" type="number" min="0" step="0.01" required value="${pr.price ?? 0}" /></label>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>`);
      document.getElementById("sc-price-form").onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = { productId, label: fd.get("label"), price: Number(fd.get("price")) || 0 };
        if (price?.id) await api(`/sales-config/prices/${price.id}`, { method: "PATCH", body: JSON.stringify(body) });
        else await api("/sales-config/prices", { method: "POST", body: JSON.stringify(body) });
        closeModal();
        refreshClients();
      };
    }

    function openClientModal(client) {
      const c = client || { status: "active" };
      openModal(`<div class="modal-header"><h2>${client ? "Edit" : "Add"} client</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="sc-client-form" class="form-grid modal-body">
          <label class="field"><span>Name</span><input name="name" required value="${escapeHtml(c.name || "")}" /></label>
          <label class="field"><span>Status</span><select name="status">
            <option value="active" ${c.status === "active" ? "selected" : ""}>Active</option>
            <option value="disabled" ${c.status === "disabled" ? "selected" : ""}>Disabled</option>
            <option value="hold" ${c.status === "hold" ? "selected" : ""}>On hold</option>
            <option value="warn" ${c.status === "warn" ? "selected" : ""}>Warn on submit</option>
          </select></label>
          <label class="field" style="grid-column:1/-1"><span>Status message</span><textarea name="statusMessage">${escapeHtml(c.statusMessage || "")}</textarea></label>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>`);
      document.getElementById("sc-client-form").onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = { name: fd.get("name"), status: fd.get("status"), statusMessage: fd.get("statusMessage") };
        if (client?.id) await api(`/sales-config/clients/${client.id}`, { method: "PATCH", body: JSON.stringify(body) });
        else await api("/sales-config/clients", { method: "POST", body: JSON.stringify(body) });
        closeModal();
        refreshClients();
      };
    }

    function openProductModal(clientId, product) {
      const p = product || { deviceType: "smartwatch", active: true };
      openModal(`<div class="modal-header"><h2>${product ? "Edit" : "Add"} device</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="sc-product-form" class="form-grid modal-body">
          <label class="field"><span>Device type</span><select name="deviceType">${DEVICE_TYPES.map((d) => `<option value="${d.id}" ${p.deviceType === d.id ? "selected" : ""}>${d.label}</option>`).join("")}</select></label>
          <label class="field"><span>Label</span><input name="label" value="${escapeHtml(p.label || "")}" /></label>
          <label class="toggle-label"><input type="checkbox" name="isFavored" ${p.isFavored ? "checked" : ""} /> Favored (★)</label>
          <label class="field"><span>Priority note</span><input name="priorityNote" value="${escapeHtml(p.priorityNote || "")}" /></label>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>`);
      document.getElementById("sc-product-form").onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = {
          clientId,
          deviceType: fd.get("deviceType"),
          label: fd.get("label"),
          isFavored: fd.get("isFavored") === "on",
          priorityNote: fd.get("priorityNote"),
        };
        if (product?.id) await api(`/sales-config/products/${product.id}`, { method: "PATCH", body: JSON.stringify(body) });
        else {
          const res = await api("/sales-config/products", { method: "POST", body: JSON.stringify(body) });
          await api("/sales-config/prices", {
            method: "POST",
            body: JSON.stringify({ productId: res.product.id, label: "Standard", price: 0 }),
          });
        }
        closeModal();
        refreshClients();
      };
    }

    async function refreshBreaks() {
      const data = await api("/sales-config/breaks");
      const el = document.getElementById("sc-breaks-list");
      if (!el) return;
      el.innerHTML = (data.breaks || [])
        .map(
          (b) => `<div class="card card-flat adj-row" style="margin:.35rem 0">
            <div><strong>${escapeHtml(b.name)}</strong> ${escapeHtml(formatTimeAmPm(b.startTime))}–${escapeHtml(formatTimeAmPm(b.endTime))} · ${b.durationMinutes}m · Egypt
            ${b.active ? "" : " <span class='badge'>inactive</span>"}</div>
            <button class="btn btn-sm" data-edit-break="${b.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-del-break="${b.id}">Delete</button>
          </div>`
        )
        .join("") || "<p>No breaks</p>";
      el.querySelectorAll("[data-edit-break]").forEach((btn) => {
        btn.onclick = () => openBreakModal(data.breaks.find((x) => x.id === btn.dataset.editBreak));
      });
      el.querySelectorAll("[data-del-break]").forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm("Delete break?")) return;
          await api(`/sales-config/breaks/${btn.dataset.delBreak}`, { method: "DELETE" });
          refreshBreaks();
        };
      });
    }

    function openBreakModal(brk) {
      const b = brk || { active: true, durationMinutes: 15, units: [], roles: [], daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "10:00" };
      const endPreview = calcEndTime(b.startTime || "10:00", b.durationMinutes || 15);
      const unitChecks = visibleBreakUnits(state).map(
        (u) => `<label><input type="checkbox" name="units" value="${u}" ${(b.units || []).includes(u) ? "checked" : ""} /> ${u}</label>`
      ).join(" ");
      const roleChecks = ROLE_OPTIONS.map(
        (r) => `<label><input type="checkbox" name="roles" value="${r}" ${(b.roles || []).includes(r) ? "checked" : ""} /> ${r}</label>`
      ).join(" ");
      openModal(`<div class="modal-header"><h2>${brk ? "Edit" : "Add"} break</h2><button class="btn btn-sm" data-close>✕</button></div>
        <form id="sc-break-form" class="form-grid modal-body">
          <label class="field"><span>Name</span><input name="name" required value="${escapeHtml(b.name || "")}" /></label>
          <label class="field"><span>Start (HH:MM)</span><input name="startTime" id="sc-break-start" required value="${escapeHtml(b.startTime || "10:00")}" /></label>
          <label class="field"><span>Duration (minutes)</span><input name="durationMinutes" id="sc-break-duration" type="number" min="1" value="${b.durationMinutes || 15}" /></label>
          <label class="field"><span>End time (calculated)</span><input id="sc-break-end-preview" type="text" readonly value="${escapeHtml(b.endTime || endPreview)}" class="muted" /></label>
          <input type="hidden" name="endTime" id="sc-break-end" value="${escapeHtml(b.endTime || endPreview)}" />
          <label class="field" style="grid-column:1/-1"><span>Message</span><textarea name="message">${escapeHtml(b.message || "")}</textarea></label>
          <label class="toggle-label"><input type="checkbox" name="active" ${b.active !== false ? "checked" : ""} /> Active</label>
          <div style="grid-column:1/-1"><strong>Units</strong><div class="checkbox-grid">${unitChecks}</div></div>
          <div style="grid-column:1/-1"><strong>Roles</strong><div class="checkbox-grid">${roleChecks}</div></div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>`);
      document.getElementById("sc-break-form").onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const units = [...fd.getAll("units")];
        const roles = [...fd.getAll("roles")];
        const startTime = fd.get("startTime");
        const durationMinutes = Number(fd.get("durationMinutes")) || 15;
        const body = {
          name: fd.get("name"),
          startTime,
          endTime: calcEndTime(startTime, durationMinutes),
          durationMinutes,
          message: fd.get("message"),
          active: fd.get("active") === "on",
          units,
          roles,
        };
        if (brk?.id) await api(`/sales-config/breaks/${brk.id}`, { method: "PATCH", body: JSON.stringify(body) });
        else await api("/sales-config/breaks", { method: "POST", body: JSON.stringify(body) });
        closeModal();
        refreshBreaks();
      };
      const syncEnd = () => {
        const start = document.getElementById("sc-break-start")?.value || "10:00";
        const dur = document.getElementById("sc-break-duration")?.value || 15;
        const end = calcEndTime(start, dur);
        const preview = document.getElementById("sc-break-end-preview");
        const hidden = document.getElementById("sc-break-end");
        if (preview) preview.value = end;
        if (hidden) hidden.value = end;
      };
      document.getElementById("sc-break-start")?.addEventListener("input", syncEnd);
      document.getElementById("sc-break-duration")?.addEventListener("input", syncEnd);
    }

    document.getElementById("sc-add-client").onclick = () => openClientModal(null);
    document.getElementById("sc-import-sales").onclick = async () => {
      if (!confirm("Import clients, devices, and prices from all existing sales? Duplicates are skipped.")) return;
      const res = await api("/sales-config/import-from-sales", { method: "POST", body: "{}" });
      alert(`Imported: ${res.clientsAdded} clients, ${res.productsAdded} devices, ${res.pricesAdded} prices (${res.salesScanned} sales scanned).`);
      refreshClients();
    };
    document.getElementById("sc-add-break").onclick = () => openBreakModal(null);
    refreshClients();
    refreshBreaks();
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return {
    loadCatalog,
    loadBreaks,
    onSettingsRevision,
    handleActiveBreak,
    showBreakOverlay,
    enhanceSaleModal,
    injectUnitTeamPickerBlock,
    validateClientSubmit,
    renderBreaksPage,
    enhanceSettings,
    wireAttachmentActions,
    attachmentRowHtml,
    uploadSaleAttachmentWithProgress,
    bindImmediateSaleAttachmentUploads,
  };
})();
