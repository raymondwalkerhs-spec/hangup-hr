/**
 * Full-page Sales field permissions and log column config (admin/RTM).
 */
window.SalesPermissionsPages = (function () {
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

  function buildFieldPermMatrix(fields, permMap, escapeHtml) {
    const sections = [...new Set(fields.map((f) => f.section || "general"))];
    return sections
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
  }

  async function renderSalesFieldPermissionsPage(root, api, helpers) {
    const { escapeHtml, showSaveIndicator } = helpers;
    root.innerHTML = `<div class="page-header flex-between">
      <div><h1>Sales field permissions</h1><p class="muted">Control who can view and edit each sales form field (Add sale, Edit sale, Quality ticket).</p></div>
      <div class="btn-row">
        <button class="btn btn-sm" id="sf-perms-seed" type="button">Reset defaults</button>
        <button class="btn btn-primary" id="sf-perms-save" type="button">Save permissions</button>
      </div>
    </div>
    <div id="sf-perms-wrap" class="card"><p class="muted">Loading…</p></div>`;

    const catalog = await api("/sales/field-catalog?allFields=1");
    const perms = catalog.permissions || [];
    const permMap = Object.fromEntries(perms.map((p) => [p.fieldKey, p]));
    const fields = (catalog.fields && catalog.fields.length)
      ? catalog.fields
      : perms.map((p) => ({ key: p.fieldKey, label: p.label || p.fieldKey, section: p.section || "general" }));

    const headerCells = PERM_ROLE_GROUPS.map((g) => `<th colspan="2" class="perm-group-head">${g.label}</th>`).join("");
    const subHeader = PERM_ROLE_GROUPS.map(() => `<th class="perm-sub">View</th><th class="perm-sub">Edit</th>`).join("");
    const rows = buildFieldPermMatrix(fields, permMap, escapeHtml);

    root.querySelector("#sf-perms-wrap").innerHTML = `
      <div class="table-wrap sales-perms-wrap"><table class="sales-perms-table sales-perms-table-wide">
        <thead><tr><th class="perm-sticky-col">Field</th>${headerCells}</tr>
        <tr><th class="perm-sticky-col"></th>${subHeader}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;

    root.querySelector("#sf-perms-seed")?.addEventListener("click", () => {
      openConfirmModal({
        title: "Reset permissions",
        message: "Reset all sales field permissions to catalog defaults?",
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
      const byField = {};
      for (const input of root.querySelectorAll("[data-field][data-group]")) {
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
        showSaveIndicator?.("Permissions saved", "saved");
      } catch (e) {
        alert(e.message);
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

    root.querySelector("#sl-cols-seed")?.addEventListener("click", async () => {
      if (!confirm("Reset log columns to defaults?")) return;
      await api("/sales/list-columns/seed", { method: "POST", body: "{}" });
      showSaveIndicator?.("Columns reset", "saved");
      renderSalesLogColumnsPage(root, api, helpers);
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
