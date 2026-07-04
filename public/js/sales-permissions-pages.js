/**
 * Full-page Sales field permissions and log column config (admin/RTM).
 * Role-first flow, matching the Access Control page: pick a role, then
 * toggle View/Edit per field with pending-change tracking and batch save.
 */
window.SalesPermissionsPages = (function () {
  const ROLES = ["agent", "tl", "op", "quality", "rtm", "public_relations", "admin", "ceo", "hr", "finance"];

  let fields = [];
  let permMap = {};
  let selectedRole = "agent";
  const pending = new Map(); // "role::fieldKey::view|edit" -> boolean

  function roleLabel(role) {
    return String(role || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function pendingKey(role, fieldKey, kind) {
    return `${role}::${fieldKey}::${kind}`;
  }

  function rolesOf(perm, kind) {
    if (!perm) return [];
    if (kind === "view") return perm.viewRoles || perm.view_roles || [];
    return perm.editRoles || perm.edit_roles || [];
  }

  function roleInList(role, list) {
    return (list || []).map((r) => String(r).toLowerCase()).includes(String(role).toLowerCase());
  }

  function getEffective(role, fieldKey, kind) {
    const pk = pendingKey(role, fieldKey, kind);
    if (pending.has(pk)) return pending.get(pk);
    return roleInList(role, rolesOf(permMap[fieldKey], kind));
  }

  function isPendingField(role, fieldKey) {
    return pending.has(pendingKey(role, fieldKey, "view")) || pending.has(pendingKey(role, fieldKey, "edit"));
  }

  function sectionLabel(sec) {
    return String(sec || "general")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function renderFieldMatrix(root, escapeHtml) {
    const roleTitle = root.querySelector("#sf-selected-role-title");
    if (roleTitle) roleTitle.textContent = `Field access for ${roleLabel(selectedRole)}`;

    const sections = [...new Set(fields.map((f) => f.section || "general"))];
    let rows = "";
    for (const sec of sections) {
      const secFields = fields.filter((f) => (f.section || "general") === sec);
      if (!secFields.length) continue;
      rows += `<tr class="rbac-cat-row"><td colspan="4"><strong>${escapeHtml(sectionLabel(sec))}</strong></td></tr>`;
      for (const f of secFields) {
        const view = getEffective(selectedRole, f.key, "view");
        const edit = getEffective(selectedRole, f.key, "edit");
        const badge = isPendingField(selectedRole, f.key)
          ? '<span class="badge">unsaved</span>'
          : '<span class="badge badge-muted">saved</span>';
        rows += `
          <tr data-field-row="${escapeHtml(f.key)}">
            <td><strong>${escapeHtml(f.label || f.key)}</strong><div class="muted small">${escapeHtml(f.key)}${f.sensitive ? " · sensitive" : ""}</div></td>
            <td>
              <label class="rbac-toggle">
                <input type="checkbox" data-sf-toggle="${escapeHtml(f.key)}" data-kind="view" ${view ? "checked" : ""} />
                ${view ? "Allow" : "Deny"}
              </label>
            </td>
            <td>
              <label class="rbac-toggle">
                <input type="checkbox" data-sf-toggle="${escapeHtml(f.key)}" data-kind="edit" ${edit ? "checked" : ""} />
                ${edit ? "Allow" : "Deny"}
              </label>
            </td>
            <td>${badge}</td>
          </tr>`;
      }
    }

    root.querySelector("#sf-matrix-wrap").innerHTML = `
      <table class="data-table rbac-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>View</th>
            <th>Edit</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">No fields</td></tr>'}</tbody>
      </table>`;

    root.querySelectorAll("[data-sf-toggle]").forEach((input) => {
      input.addEventListener("change", () => {
        const fieldKey = input.dataset.sfToggle;
        const kind = input.dataset.kind;
        const saved = roleInList(selectedRole, rolesOf(permMap[fieldKey], kind));
        const pk = pendingKey(selectedRole, fieldKey, kind);
        if (input.checked === saved) pending.delete(pk);
        else pending.set(pk, input.checked);
        renderFieldMatrix(root, escapeHtml);
        updateSaveState(root);
      });
    });
  }

  function updateSaveState(root) {
    const saveBtn = root.querySelector("#sf-perms-save");
    if (saveBtn) saveBtn.disabled = pending.size === 0;
    const status = root.querySelector("#sf-perms-status");
    if (status) {
      status.textContent = pending.size ? `${pending.size} unsaved change(s)` : "";
    }
  }

  async function loadFieldData(api) {
    const catalog = await api("/sales/field-catalog?allFields=1");
    const perms = catalog.permissions || [];
    permMap = Object.fromEntries(perms.map((p) => [p.fieldKey, p]));
    fields = (catalog.fields && catalog.fields.length)
      ? catalog.fields
      : perms.map((p) => ({ key: p.fieldKey, label: p.label || p.fieldKey, section: p.section || "general", sensitive: p.sensitive }));
    pending.clear();
  }

  async function renderSalesFieldPermissionsPage(root, api, helpers) {
    const { escapeHtml, showSaveIndicator } = helpers;
    root.innerHTML = `<div class="page-header flex-between">
      <div><h1>Sales field permissions</h1><p class="muted">Choose a role, then set which sales form fields that role can view and edit (Add sale, Edit sale, Quality ticket).</p></div>
      <div class="btn-row">
        <button class="btn btn-sm" id="sf-perms-seed" type="button">Reset all to defaults</button>
        <button class="btn btn-primary" id="sf-perms-save" type="button" disabled>Save changes</button>
      </div>
    </div>
    <p id="sf-perms-status" class="muted small"></p>
    <div class="card rbac-layout">
      <div class="rbac-role-picker">
        <label class="field"><span>1. Select role</span>
          <select id="sf-role-select" class="rbac-role-select"></select>
        </label>
        <p class="muted small" style="margin:.5rem 0 0">2. Toggle View / Edit per field below for that role only. Changes apply after you save.</p>
      </div>
      <h3 id="sf-selected-role-title" class="rbac-role-heading">Field access for Agent</h3>
      <div id="sf-matrix-wrap"><p class="muted">Loading…</p></div>
    </div>`;

    try {
      await loadFieldData(api);
    } catch (e) {
      root.querySelector("#sf-matrix-wrap").innerHTML = `<p class="muted">${escapeHtml(e.message || "Failed to load permissions.")}</p>`;
      return;
    }

    const sel = root.querySelector("#sf-role-select");
    sel.innerHTML = ROLES.map(
      (r) => `<option value="${r}" ${r === selectedRole ? "selected" : ""}>${roleLabel(r)}</option>`
    ).join("");
    sel.addEventListener("change", () => {
      selectedRole = sel.value;
      renderFieldMatrix(root, escapeHtml);
      updateSaveState(root);
    });

    renderFieldMatrix(root, escapeHtml);
    updateSaveState(root);

    root.querySelector("#sf-perms-seed")?.addEventListener("click", () => {
      openConfirmModal({
        title: "Reset permissions",
        message: "Reset ALL sales field permissions (every role) to catalog defaults?",
        confirmLabel: "Reset",
        danger: true,
        onConfirm: async () => {
          await api("/sales/field-permissions/seed", { method: "POST", body: "{}" });
          showSaveIndicator?.("Defaults restored", "saved");
          renderSalesFieldPermissionsPage(root, api, helpers);
        },
      });
    });

    root.querySelector("#sf-perms-save")?.addEventListener("click", async () => {
      if (!pending.size) return;
      // Group pending toggles by field, then apply role add/remove to that field's arrays.
      const byField = {};
      for (const [pk, enabled] of pending.entries()) {
        const [role, fieldKey, kind] = pk.split("::");
        if (!byField[fieldKey]) {
          const p = permMap[fieldKey] || {};
          byField[fieldKey] = {
            viewRoles: [...rolesOf(p, "view")],
            editRoles: [...rolesOf(p, "edit")],
            mainViewRoles: [...(p.mainViewRoles || p.main_view_roles || rolesOf(p, "view"))],
            qualityViewRoles: [...(p.qualityViewRoles || p.quality_view_roles || [])],
          };
        }
        const listKey = kind === "view" ? "viewRoles" : "editRoles";
        const set = new Set(byField[fieldKey][listKey].map((r) => String(r).toLowerCase()));
        if (enabled) set.add(role);
        else set.delete(role);
        byField[fieldKey][listKey] = [...set];
        // Keep the main sales log surface in sync with general view access.
        if (kind === "view") {
          const mainSet = new Set(byField[fieldKey].mainViewRoles.map((r) => String(r).toLowerCase()));
          if (enabled) mainSet.add(role);
          else mainSet.delete(role);
          byField[fieldKey].mainViewRoles = [...mainSet];
        }
      }
      const saveBtn = root.querySelector("#sf-perms-save");
      saveBtn.disabled = true;
      saveBtn.classList.add("is-loading");
      try {
        for (const [fieldKey, body] of Object.entries(byField)) {
          await api(`/sales/field-permissions/${encodeURIComponent(fieldKey)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        }
        await loadFieldData(api);
        renderFieldMatrix(root, escapeHtml);
        updateSaveState(root);
        showSaveIndicator?.("Permissions saved", "saved");
      } catch (e) {
        alert(e.message);
      } finally {
        saveBtn.classList.remove("is-loading");
        updateSaveState(root);
      }
    });
  }

  async function renderSalesLogColumnsPage(root, api, helpers) {
    const { escapeHtml, showSaveIndicator } = helpers;
    const data = await api("/sales/list-columns");
    const cols = data.columns || [];

    root.innerHTML = `<div class="page-header flex-between">
      <div><h1>Sales log columns</h1><p class="muted">Choose which columns appear on the Sales log. Visibility also depends on each role's field view access.</p></div>
      <div class="btn-row">
        <button class="btn btn-sm" id="sl-cols-seed" type="button">Reset defaults</button>
        <button class="btn btn-primary" id="sl-cols-save" type="button">Save columns</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Show</th><th>Column</th><th>Key</th><th>Admin only</th></tr></thead>
        <tbody>${cols
          .map(
            (c) => `<tr>
              <td><input type="checkbox" data-list-col="${escapeHtml(c.columnKey)}" ${c.enabled !== false ? "checked" : ""} /></td>
              <td><strong>${escapeHtml(c.label || c.columnKey)}</strong></td>
              <td class="muted">${escapeHtml(c.columnKey)}</td>
              <td>${c.adminOnly ? '<span class="badge badge-warn">Yes</span>' : "—"}</td>
            </tr>`
          )
          .join("")}</tbody>
      </table></div>
    </div>`;

    root.querySelector("#sl-cols-seed")?.addEventListener("click", () => {
      openConfirmModal({
        title: "Reset columns",
        message: "Reset log columns to defaults?",
        confirmLabel: "Reset",
        danger: true,
        onConfirm: async () => {
          await api("/sales/list-columns/seed", { method: "POST", body: "{}" });
          showSaveIndicator?.("Columns reset", "saved");
          renderSalesLogColumnsPage(root, api, helpers);
        },
      });
    });

    root.querySelector("#sl-cols-save")?.addEventListener("click", async () => {
      try {
        for (const input of root.querySelectorAll("[data-list-col]")) {
          await api(`/sales/list-columns/${encodeURIComponent(input.dataset.listCol)}`, {
            method: "PUT",
            body: JSON.stringify({ enabled: input.checked }),
          });
        }
        showSaveIndicator?.("Columns saved", "saved");
      } catch (e) {
        alert(e.message);
      }
    });
  }

  return { renderSalesFieldPermissionsPage, renderSalesLogColumnsPage };
})();
