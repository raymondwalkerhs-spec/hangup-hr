/**
 * Sales permissions admin — tabbed Edit sale / Quality ticket / Attachments / Actions.
 */
window.SalesPermissionsPages = (function () {
  const ROLES = ["agent", "tl", "op", "quality", "rtm", "public_relations", "admin", "ceo", "hr", "finance"];

  let fields = [];
  let permMap = {};
  let attachPerms = [];
  let actionPerms = [];
  let selectedRole = "agent";
  let activeTab = "main";
  const pending = new Map();
  const attachPending = new Map();
  const actionPending = new Map();

  function roleLabel(role) {
    return String(role || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function roleInList(role, list) {
    return (list || []).map((r) => String(r).toLowerCase()).includes(String(role).toLowerCase());
  }

  function pendingKey(role, fieldKey, kind, tab) {
    return `${tab || activeTab}::${role}::${fieldKey}::${kind}`;
  }

  function viewRolesKey(tab) {
    if (tab === "quality") return "qualityViewRoles";
    return "mainViewRoles";
  }

  function rolesOf(perm, kind, tab) {
    if (!perm) return [];
    if (kind === "edit") return perm.editRoles || perm.edit_roles || [];
    const t = tab || activeTab;
    if (t === "quality") return perm.qualityViewRoles || perm.quality_view_roles || [];
    if (t === "main") return perm.mainViewRoles || perm.main_view_roles || perm.viewRoles || perm.view_roles || [];
    return perm.viewRoles || perm.view_roles || [];
  }

  function getEffective(role, fieldKey, kind, tab) {
    const pk = pendingKey(role, fieldKey, kind, tab);
    if (pending.has(pk)) return pending.get(pk);
    return roleInList(role, rolesOf(permMap[fieldKey], kind, tab));
  }

  function isPendingField(role, fieldKey, tab) {
    const t = tab || activeTab;
    return pending.has(pendingKey(role, fieldKey, "view", t)) || pending.has(pendingKey(role, fieldKey, "edit", t));
  }

  function sectionLabel(sec) {
    return String(sec || "general")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function tabLabel(tab) {
    if (tab === "main") return "Edit sale";
    if (tab === "quality") return "Quality ticket";
    if (tab === "attachments") return "Attachments";
    return "Actions";
  }

  function renderFieldMatrix(root, escapeHtml) {
    const roleTitle = root.querySelector("#sf-selected-role-title");
    if (roleTitle) roleTitle.textContent = `${tabLabel(activeTab)} — ${roleLabel(selectedRole)}`;

    const sections = [...new Set(fields.map((f) => f.section || "general"))];
    let rows = "";
    for (const sec of sections) {
      const secFields = fields.filter((f) => (f.section || "general") === sec);
      if (!secFields.length) continue;
      rows += `<tr class="rbac-cat-row"><td colspan="4"><strong>${escapeHtml(sectionLabel(sec))}</strong></td></tr>`;
      for (const f of secFields) {
        const view = getEffective(selectedRole, f.key, "view", activeTab);
        const edit = getEffective(selectedRole, f.key, "edit", activeTab);
        const badge = isPendingField(selectedRole, f.key, activeTab)
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
        const saved = roleInList(selectedRole, rolesOf(permMap[fieldKey], kind, activeTab));
        const pk = pendingKey(selectedRole, fieldKey, kind, activeTab);
        if (input.checked === saved) pending.delete(pk);
        else pending.set(pk, input.checked);
        renderFieldMatrix(root, escapeHtml);
        updateSaveState(root);
      });
    });
  }

  function attachPendingKey(role, attachKey, kind) {
    return `attach::${attachKey}::${role}::${kind}`;
  }

  function attachRolesOf(perm, kind) {
    if (!perm) return [];
    if (kind === "edit") return perm.editRoles || perm.edit_roles || [];
    return perm.viewRoles || perm.view_roles || [];
  }

  function getAttachEffective(role, attachKey, kind) {
    const pk = attachPendingKey(role, attachKey, kind);
    if (attachPending.has(pk)) return attachPending.get(pk);
    const perm = attachPerms.find((a) => a.attachmentKey === attachKey);
    return roleInList(role, attachRolesOf(perm, kind));
  }

  function renderAttachmentMatrix(root, escapeHtml) {
    const roleTitle = root.querySelector("#sf-selected-role-title");
    if (roleTitle) roleTitle.textContent = `Attachments — ${roleLabel(selectedRole)}`;

    let rows = "";
    for (const a of attachPerms) {
      const view = getAttachEffective(selectedRole, a.attachmentKey, "view");
      const edit = getAttachEffective(selectedRole, a.attachmentKey, "edit");
      const unsaved =
        attachPending.has(attachPendingKey(selectedRole, a.attachmentKey, "view")) ||
        attachPending.has(attachPendingKey(selectedRole, a.attachmentKey, "edit"));
      rows += `
        <tr>
          <td><strong>${escapeHtml(a.label || a.attachmentKey)}</strong><div class="muted small">${escapeHtml(a.attachmentKey)}</div></td>
          <td><label class="rbac-toggle"><input type="checkbox" data-attach-toggle="${escapeHtml(a.attachmentKey)}" data-kind="view" ${view ? "checked" : ""} />${view ? "Allow" : "Deny"}</label></td>
          <td><label class="rbac-toggle"><input type="checkbox" data-attach-toggle="${escapeHtml(a.attachmentKey)}" data-kind="edit" ${edit ? "checked" : ""} />${edit ? "Allow" : "Deny"}</label></td>
          <td>${unsaved ? '<span class="badge">unsaved</span>' : '<span class="badge badge-muted">saved</span>'}</td>
        </tr>`;
    }

    root.querySelector("#sf-matrix-wrap").innerHTML = `
      <table class="data-table rbac-table">
        <thead><tr><th>Kind</th><th>View</th><th>Edit</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">No attachment kinds</td></tr>'}</tbody>
      </table>`;

    root.querySelectorAll("[data-attach-toggle]").forEach((input) => {
      input.addEventListener("change", () => {
        const attachKey = input.dataset.attachToggle;
        const kind = input.dataset.kind;
        const perm = attachPerms.find((a) => a.attachmentKey === attachKey);
        const saved = roleInList(selectedRole, attachRolesOf(perm, kind));
        const pk = attachPendingKey(selectedRole, attachKey, kind);
        if (input.checked === saved) attachPending.delete(pk);
        else attachPending.set(pk, input.checked);
        renderAttachmentMatrix(root, escapeHtml);
        updateSaveState(root);
      });
    });
  }

  function updateSaveState(root) {
    const saveBtn = root.querySelector("#sf-perms-save");
    const unsaved = pending.size + attachPending.size + actionPending.size;
    if (saveBtn) saveBtn.disabled = unsaved === 0;
    const status = root.querySelector("#sf-perms-status");
    if (status) {
      status.textContent = unsaved ? `${unsaved} unsaved change(s)` : "";
    }
  }

  async function loadFieldData(api) {
    const catalog = await api("/sales/field-catalog?allFields=1");
    const perms = catalog.permissions || [];
    permMap = Object.fromEntries(perms.map((p) => [p.fieldKey, p]));
    fields = (catalog.fields && catalog.fields.length)
      ? catalog.fields
      : perms.map((p) => ({
          key: p.fieldKey,
          label: p.label || p.fieldKey,
          section: p.section || "general",
          sensitive: p.sensitive,
        }));
    pending.clear();
    const attachRes = await api("/sales/attachment-permissions").catch(() => ({ attachments: [] }));
    attachPerms = attachRes.attachments || catalog.attachmentPermissions || [];
    attachPending.clear();
    const actRes = await api("/sales/action-permissions").catch(() => ({ actions: [] }));
    actionPerms = actRes.actions || [];
    actionPending.clear();
  }

  function actionRoleEnabled(actionKey, role) {
    const pk = `action::${actionKey}::${role}`;
    if (actionPending.has(pk)) return actionPending.get(pk);
    const def = actionPerms.find((a) => a.actionKey === actionKey);
    return roleInList(role, def?.allowedRoles || []);
  }

  function renderActionPermissions(root, escapeHtml) {
    const wrap = root.querySelector("#sf-action-perms-wrap");
    if (!wrap) return;
    if (!actionPerms.length) {
      wrap.innerHTML = "<p class='muted'>No sales action permissions configured.</p>";
      return;
    }
    let rows = "";
    for (const action of actionPerms) {
      const cells = ROLES.map((role) => {
        const on = actionRoleEnabled(action.actionKey, role);
        const pk = `action::${action.actionKey}::${role}`;
        const unsaved = actionPending.has(pk) ? " · unsaved" : "";
        return `<td><label class="rbac-toggle"><input type="checkbox" data-action-toggle="${escapeHtml(action.actionKey)}" data-action-role="${role}" ${on ? "checked" : ""} />${on ? "Allow" : "Deny"}${unsaved ? '<span class="badge">unsaved</span>' : ""}</label></td>`;
      }).join("");
      rows += `<tr><td><strong>${escapeHtml(action.label || action.actionKey)}</strong><div class="muted small">${escapeHtml(action.actionKey)} — requires Access Control <code>approveSales</code> too</div></td>${cells}</tr>`;
    }
    wrap.innerHTML = `
      <table class="data-table rbac-table">
        <thead><tr><th>Action</th>${ROLES.map((r) => `<th>${escapeHtml(roleLabel(r))}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    wrap.querySelectorAll("[data-action-toggle]").forEach((input) => {
      input.addEventListener("change", () => {
        const actionKey = input.dataset.actionToggle;
        const role = input.dataset.actionRole;
        const pk = `action::${actionKey}::${role}`;
        const def = actionPerms.find((a) => a.actionKey === actionKey);
        const saved = roleInList(role, def?.allowedRoles || []);
        if (input.checked === saved) actionPending.delete(pk);
        else actionPending.set(pk, input.checked);
        renderActionPermissions(root, escapeHtml);
        updateSaveState(root);
      });
    });
  }

  function renderActivePanel(root, escapeHtml) {
    const tabs = root.querySelector("#sf-perm-tabs");
    tabs?.querySelectorAll("[data-sf-tab]").forEach((btn) => {
      btn.classList.toggle("btn-primary", btn.dataset.sfTab === activeTab);
      btn.classList.toggle("btn", btn.dataset.sfTab !== activeTab);
    });
    const fieldCard = root.querySelector("#sf-field-card");
    const actionCard = root.querySelector("#sf-action-card");
    if (activeTab === "actions") {
      if (fieldCard) fieldCard.style.display = "none";
      if (actionCard) actionCard.style.display = "";
      renderActionPermissions(root, escapeHtml);
    } else {
      if (fieldCard) fieldCard.style.display = "";
      if (actionCard) actionCard.style.display = "none";
      if (activeTab === "attachments") renderAttachmentMatrix(root, escapeHtml);
      else renderFieldMatrix(root, escapeHtml);
    }
    updateSaveState(root);
  }

  async function renderSalesFieldPermissionsPage(root, api, helpers) {
    const { escapeHtml, showSaveIndicator } = helpers;
    root.innerHTML = `<div class="page-header flex-between">
      <div><h1>Sales permissions</h1><p class="muted">Configure field, attachment, and action access per role. App-level gates (Edit sale, Quality ticket) are on Access Control.</p></div>
      <div class="btn-row">
        <button class="btn btn-sm" id="sf-perms-seed" type="button">Reset all to defaults</button>
        <button class="btn btn-primary" id="sf-perms-save" type="button" disabled>Save changes</button>
      </div>
    </div>
    <p id="sf-perms-status" class="muted small"></p>
    <div class="btn-row" id="sf-perm-tabs" style="margin-bottom:.75rem">
      <button type="button" class="btn btn-primary" data-sf-tab="main">Edit sale</button>
      <button type="button" class="btn" data-sf-tab="quality">Quality ticket</button>
      <button type="button" class="btn" data-sf-tab="attachments">Attachments</button>
      <button type="button" class="btn" data-sf-tab="actions">Actions</button>
    </div>
    <div class="card rbac-layout" id="sf-field-card">
      <div class="rbac-role-picker">
        <label class="field"><span>Select role</span>
          <select id="sf-role-select" class="rbac-role-select"></select>
        </label>
        <p class="muted small" style="margin:.5rem 0 0">Toggle View / Edit for the active tab only. Main and Quality view columns are independent.</p>
      </div>
      <h3 id="sf-selected-role-title" class="rbac-role-heading">Edit sale — Agent</h3>
      <div id="sf-matrix-wrap"><p class="muted">Loading…</p></div>
    </div>
    <div class="card" id="sf-action-card" style="margin-top:1rem;display:none">
      <h3>Sales action permissions</h3>
      <p class="muted small">Fine-grain approve/deny/callback gates (AND with Access Control <strong>approveSales</strong>).</p>
      <div id="sf-action-perms-wrap"><p class="muted">Loading…</p></div>
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
      renderActivePanel(root, escapeHtml);
    });

    root.querySelector("#sf-perm-tabs")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-sf-tab]");
      if (!btn) return;
      activeTab = btn.dataset.sfTab;
      renderActivePanel(root, escapeHtml);
    });

    renderActivePanel(root, escapeHtml);

    root.querySelector("#sf-perms-seed")?.addEventListener("click", () => {
      openConfirmModal({
        title: "Reset permissions",
        message: "Reset ALL sales permissions (fields, attachments, actions) to catalog defaults?",
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
      if (!pending.size && !attachPending.size && !actionPending.size) return;
      const byField = {};
      for (const [pk, enabled] of pending.entries()) {
        const [tab, role, fieldKey, kind] = pk.split("::");
        if (!byField[fieldKey]) {
          const p = permMap[fieldKey] || {};
          byField[fieldKey] = {
            viewRoles: [...rolesOf(p, "view", "main")],
            editRoles: [...rolesOf(p, "edit", "main")],
            mainViewRoles: [...rolesOf(p, "view", "main")],
            qualityViewRoles: [...rolesOf(p, "view", "quality")],
          };
        }
        if (kind === "edit") {
          const set = new Set(byField[fieldKey].editRoles.map((r) => String(r).toLowerCase()));
          if (enabled) set.add(role);
          else set.delete(role);
          byField[fieldKey].editRoles = [...set];
        } else if (kind === "view") {
          const listKey = tab === "quality" ? "qualityViewRoles" : "mainViewRoles";
          const set = new Set(byField[fieldKey][listKey].map((r) => String(r).toLowerCase()));
          if (enabled) set.add(role);
          else set.delete(role);
          byField[fieldKey][listKey] = [...set];
          if (tab === "main") {
            byField[fieldKey].viewRoles = [...set];
          }
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
        const attachKeys = new Set([...attachPending.keys()].map((pk) => pk.split("::")[1]));
        for (const attachKey of attachKeys) {
          const def = attachPerms.find((a) => a.attachmentKey === attachKey);
          const viewSet = new Set(attachRolesOf(def, "view").map((r) => String(r).toLowerCase()));
          const editSet = new Set(attachRolesOf(def, "edit").map((r) => String(r).toLowerCase()));
          for (const [pk, enabled] of attachPending.entries()) {
            const [, ak, role, kind] = pk.split("::");
            if (ak !== attachKey) continue;
            const set = kind === "edit" ? editSet : viewSet;
            if (enabled) set.add(role);
            else set.delete(role);
          }
          await api(`/sales/attachment-permissions/${encodeURIComponent(attachKey)}`, {
            method: "PUT",
            body: JSON.stringify({
              label: def?.label,
              viewRoles: [...viewSet],
              editRoles: [...editSet],
            }),
          });
        }
        const actionKeys = new Set([...actionPending.keys()].map((pk) => pk.split("::")[1]));
        for (const actionKey of actionKeys) {
          const def = actionPerms.find((a) => a.actionKey === actionKey);
          const rolesSet = new Set((def?.allowedRoles || []).map((r) => String(r).toLowerCase()));
          for (const [pk, enabled] of actionPending.entries()) {
            const [, ak, role] = pk.split("::");
            if (ak !== actionKey) continue;
            if (enabled) rolesSet.add(role);
            else rolesSet.delete(role);
          }
          await api(`/sales/action-permissions/${encodeURIComponent(actionKey)}`, {
            method: "PUT",
            body: JSON.stringify({ allowedRoles: [...rolesSet], label: def?.label }),
          });
        }
        await loadFieldData(api);
        renderActivePanel(root, escapeHtml);
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
        const columns = [...root.querySelectorAll("[data-list-col]")].map((input) => ({
          columnKey: input.dataset.listCol,
          enabled: input.checked,
        }));
        await api("/sales/list-columns", {
          method: "PUT",
          body: JSON.stringify({ columns }),
        });
        showSaveIndicator?.("Columns saved", "saved");
        await renderSalesLogColumnsPage(root, api, helpers);
      } catch (e) {
        alert(e.message);
      }
    });
  }

  return { renderSalesFieldPermissionsPage, renderSalesLogColumnsPage };
})();
