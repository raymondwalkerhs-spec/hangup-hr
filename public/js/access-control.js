/**
 * Admin Access Control — pick role first, then edit permissions.
 */
window.AccessControlModule = (function () {
  let catalog = null;
  let effective = null;
  let selectedRole = "agent";
  const pending = new Map();

  function roleLabel(role) {
    return String(role || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function pendingKey(role, permissionKey) {
    return `${role}::${permissionKey}`;
  }

  function getEffective(role, permissionKey) {
    const pk = pendingKey(role, permissionKey);
    if (pending.has(pk)) return pending.get(pk);
    const eff = effective?.[role]?.[permissionKey];
    if (eff && typeof eff.effective === "boolean") return eff.effective;
    return catalog?.defaults?.[role]?.[permissionKey] ?? false;
  }

  function getOverrideState(role, permissionKey) {
    const pk = pendingKey(role, permissionKey);
    if (pending.has(pk)) return "pending";
    const eff = effective?.[role]?.[permissionKey];
    if (eff && eff.override !== null && eff.override !== undefined) return "override";
    return "default";
  }

  function groupByCategory(permissions) {
    const groups = {};
    for (const p of permissions || []) {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    }
    return groups;
  }

  async function loadData(api) {
    const [cat, ov] = await Promise.all([api("/rbac/catalog"), api("/rbac/overrides")]);
    catalog = cat;
    effective = ov.effective || {};
    pending.clear();
    return { catalog, effective };
  }

  function renderMatrix(root) {
    const perms = catalog?.permissions || [];
    const groups = groupByCategory(perms);
    const categories = catalog?.categories || Object.keys(groups);
    const roleTitle = root.querySelector("#rbac-selected-role-title");
    if (roleTitle) {
      roleTitle.textContent = `Access for ${roleLabel(selectedRole)}`;
    }

    let rows = "";
    for (const cat of categories) {
      const items = groups[cat] || [];
      if (!items.length) continue;
      rows += `<tr class="rbac-cat-row"><td colspan="4"><strong>${cat}</strong></td></tr>`;
      for (const p of items) {
        const eff = getEffective(selectedRole, p.key);
        const state = getOverrideState(selectedRole, p.key);
        const def = catalog?.defaults?.[selectedRole]?.[p.key];
        const badge =
          state === "override"
            ? '<span class="badge badge-warn">override</span>'
            : state === "pending"
              ? '<span class="badge">unsaved</span>'
              : '<span class="badge badge-muted">default</span>';
        rows += `
          <tr data-perm="${p.key}">
            <td><strong>${p.label}</strong><div class="muted small">${p.description || p.key}</div></td>
            <td>${def ? "Allow" : "Deny"}</td>
            <td>
              <label class="rbac-toggle">
                <input type="checkbox" data-perm-toggle="${p.key}" ${eff ? "checked" : ""} />
                ${eff ? "Allow" : "Deny"}
              </label>
            </td>
            <td>${badge}</td>
          </tr>`;
      }
    }

    root.querySelector("#rbac-matrix-wrap").innerHTML = `
      <table class="data-table rbac-table">
        <thead>
          <tr>
            <th>Permission</th>
            <th>Default</th>
            <th>Effective</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">No permissions</td></tr>'}</tbody>
      </table>`;

    root.querySelectorAll("[data-perm-toggle]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.permToggle;
        const def = catalog?.defaults?.[selectedRole]?.[key];
        const allowed = input.checked;
        if (allowed === def) {
          pending.delete(pendingKey(selectedRole, key));
        } else {
          pending.set(pendingKey(selectedRole, key), allowed);
        }
        renderMatrix(root);
        updateSaveState(root);
      });
    });
  }

  function updateSaveState(root) {
    const saveBtn = root.querySelector("#rbac-save");
    if (saveBtn) saveBtn.disabled = pending.size === 0;
    const status = root.querySelector("#rbac-status");
    if (status) {
      status.textContent = pending.size ? `${pending.size} unsaved change(s) for ${roleLabel(selectedRole)}` : "";
    }
  }

  function bindRolePicker(root) {
    const sel = root.querySelector("#rbac-role-select");
    if (!sel) return;
    sel.addEventListener("change", () => {
      selectedRole = sel.value;
      renderMatrix(root);
      updateSaveState(root);
    });
  }

  async function renderAccessControlPage(root, api, helpers) {
    root.innerHTML = `
      <div class="page-header flex-between">
        <div>
          <h1>Access Control</h1>
          <p class="muted">Choose a role, then set what that role may do. Per-user exceptions are on the Users page.</p>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" id="rbac-sales-perms" type="button">Sales column permissions</button>
          <button class="btn btn-sm" id="rbac-reset-role" type="button">Reset role to defaults</button>
          <button class="btn btn-primary" id="rbac-save" type="button" disabled>Save changes</button>
        </div>
      </div>
      <p id="rbac-status" class="muted small"></p>
      <div class="card rbac-layout">
        <div class="rbac-role-picker">
          <label class="field"><span>1. Select role</span>
            <select id="rbac-role-select" class="rbac-role-select"></select>
          </label>
          <p class="muted small" style="margin:.5rem 0 0">2. Toggle permissions below for that role only.</p>
        </div>
        <h3 id="rbac-selected-role-title" class="rbac-role-heading">Access for Agent</h3>
        <div id="rbac-matrix-wrap"></div>
      </div>`;

    try {
      await loadData(api);
    } catch (e) {
      root.innerHTML = `<div class="page-header"><h1>Access Control</h1></div>
        <div class="card"><p class="muted">${helpers.escapeHtml(e.message || "Failed to load RBAC data.")}</p></div>`;
      return;
    }

    const sel = root.querySelector("#rbac-role-select");
    sel.innerHTML = (catalog.roles || [])
      .map((r) => `<option value="${r}" ${r === selectedRole ? "selected" : ""}>${roleLabel(r)}</option>`)
      .join("");

    bindRolePicker(root);
    renderMatrix(root);
    updateSaveState(root);

    root.querySelector("#rbac-save")?.addEventListener("click", async () => {
      const entries = [];
      for (const [k, allowed] of pending.entries()) {
        const [role, permissionKey] = k.split("::");
        entries.push({ role, permissionKey, allowed });
      }
      if (!entries.length) return;
      try {
        await api("/rbac/overrides", { method: "PUT", body: JSON.stringify({ entries }) });
        pending.clear();
        await loadData(api);
        renderMatrix(root);
        updateSaveState(root);
        if (typeof helpers.refreshStatus === "function") await helpers.refreshStatus();
        helpers.showSaveIndicator?.("Permissions saved");
      } catch (e) {
        alert(e.message);
      }
    });

    root.querySelector("#rbac-reset-role")?.addEventListener("click", async () => {
      if (!confirm(`Reset all overrides for ${roleLabel(selectedRole)} to built-in defaults?`)) return;
      try {
        await api("/rbac/reset", { method: "POST", body: JSON.stringify({ role: selectedRole }) });
        pending.clear();
        await loadData(api);
        renderMatrix(root);
        updateSaveState(root);
        if (typeof helpers.refreshStatus === "function") await helpers.refreshStatus();
        helpers.showSaveIndicator?.("Role reset to defaults");
      } catch (e) {
        alert(e.message);
      }
    });

    root.querySelector("#rbac-sales-perms")?.addEventListener("click", () => {
      if (window.SalesModule?.openSalesPermissionsModal) {
        window.SalesModule.openSalesPermissionsModal(api, helpers, () => {});
      } else {
        alert("Sales module not loaded.");
      }
    });
  }

  return { renderAccessControlPage };
})();
