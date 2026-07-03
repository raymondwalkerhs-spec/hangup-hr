/**
 * Costs / expenses UI (finance + HR submit).
 */
window.ExpensesModule = (function () {
  function canManage() {
    return state.user?.canAccessCosts === true;
  }

  function canSubmit() {
    return state.user?.canSubmitExpense === true;
  }

  function isOverdue(e) {
    if (!e.dueDate || e.status === "paid" || e.status === "archived" || e.status === "denied") return false;
    return String(e.dueDate).slice(0, 10) < new Date().toISOString().slice(0, 10);
  }

  function statusBadge(status, e) {
    if (isOverdue(e)) return `${status} (overdue)`;
    if (status === "denied" && e.denyReason) return `denied: ${e.denyReason}`;
    return status;
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function renderCostsPage(root, api, state, helpers) {
    const { escapeHtml, fmt, openModal, closeModal } = helpers;
    if (!canManage() && !canSubmit()) {
      root.innerHTML = '<p class="muted">You do not have access to Costs.</p>';
      return;
    }

    const showArchived = Boolean(state.showArchivedExpenses);
    const statusFilter = state.expenseStatusFilter || "";
    const reqs = [api(showArchived ? "/expenses?archived=true" : "/expenses")];
    if (canManage()) {
      reqs.push(api("/expenses/bills"), api("/expenses/petty-cash/funds"));
      if (state.pettyFundId) {
        reqs.push(api(`/expenses/petty-cash/ledger?fundId=${state.pettyFundId}`).catch(() => ({ ledger: [] })));
      }
    }
    const results = await Promise.all(reqs);
    const expenseData = results[0];
    const billsData = canManage() ? results[1] : { bills: [] };
    const fundsData = canManage() ? results[2] : { funds: [] };
    const ledgerData = canManage() && state.pettyFundId ? results[3] : { ledger: [] };
    let expenses = expenseData.expenses || [];
    if (statusFilter) expenses = expenses.filter((e) => e.status === statusFilter);
    if (statusFilter === "overdue") {
      expenses = (expenseData.expenses || []).filter((e) => isOverdue(e));
    }
    const pendingApproval = (expenseData.expenses || []).filter((e) => e.status === "pending_approval");
    const starred = expenses.filter((e) => e.starred || e.priority === "emergency");
    const bills = (billsData.bills || []).sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));
    const funds = fundsData.funds || [];
    const ledger = ledgerData.ledger || [];
    const billTypes = billsData.billTypes || [];

    root.innerHTML = `
      <div class="page-header">
        <div><h1>Costs</h1><p class="muted">${expenses.length} ${showArchived ? "archived" : "active"} receipts · ${bills.length} monthly bills</p></div>
        <div class="btn-row">
          ${canManage() ? `<label class="toggle-label" style="margin-right:.5rem"><input type="checkbox" id="show-archived-toggle" ${showArchived ? "checked" : ""} /> Show archived</label>` : ""}
          ${canManage() ? `<select id="expense-status-filter" class="btn btn-sm">
            <option value="">All statuses</option>
            <option value="pending_approval" ${statusFilter === "pending_approval" ? "selected" : ""}>Pending approval</option>
            <option value="pending" ${statusFilter === "pending" ? "selected" : ""}>Pending payment</option>
            <option value="denied" ${statusFilter === "denied" ? "selected" : ""}>Denied</option>
            <option value="overdue" ${statusFilter === "overdue" ? "selected" : ""}>Overdue</option>
            <option value="paid" ${statusFilter === "paid" ? "selected" : ""}>Paid</option>
          </select>` : ""}
          ${canSubmit() ? '<button class="btn btn-primary" id="add-expense-btn">+ Submit receipt</button>' : ""}
        </div>
      </div>
      ${canManage() && pendingApproval.length ? `<div class="card" style="margin-bottom:1rem;border-left:4px solid var(--warn)">
        <h3>Executive approval queue (${pendingApproval.length})</h3>
        <table><thead><tr><th>Vendor</th><th>Amount</th><th>Submitted by</th><th></th></tr></thead>
        <tbody>${pendingApproval.map((e) => `<tr>
          <td>${escapeHtml(e.vendorName)}</td><td>${fmt(e.amount)}</td><td>${escapeHtml(e.submittedBy)}</td>
          <td class="btn-row">
            <button class="btn btn-sm btn-primary" data-approve="${e.id}">Approve</button>
            <button class="btn btn-sm" data-deny="${e.id}">Deny</button>
          </td>
        </tr>`).join("")}</tbody></table></div>` : ""}
      ${canManage() && funds.length ? `<div class="card" style="margin-bottom:1rem">
        <h3>Petty cash</h3>
        ${funds.map((f) => `<p><strong>${escapeHtml(f.fundName)}</strong>: ${fmt(f.balance)} EGP
          <button class="btn btn-sm" data-deposit="${f.id}">Add funds</button>
          <button class="btn btn-sm" data-ledger="${f.id}">Ledger</button></p>`).join("")}
        ${ledger.length ? `<div class="table-wrap" style="margin-top:.75rem"><table><thead><tr><th>When</th><th>Type</th><th>Amount</th><th>Balance</th><th>Notes</th>${canManage() ? "<th></th>" : ""}</tr></thead>
        <tbody>${ledger.slice(0, 20).map((l) => `<tr>
          <td>${l.createdAt ? new Date(l.createdAt).toLocaleString() : "—"}</td>
          <td>${escapeHtml(l.transactionType)}</td>
          <td>${fmt(l.amount)}</td>
          <td>${fmt(l.balanceAfter)}</td>
          <td>${escapeHtml(l.notes || "")}</td>
          ${canManage() && (l.transactionType === "deposit" || l.transactionType === "adjustment")
            ? `<td><button type="button" class="btn btn-sm" data-edit-ledger="${l.id}" data-ledger-amount="${l.amount}" data-ledger-notes="${escapeHtml(l.notes || "")}" data-ledger-type="${escapeHtml(l.transactionType)}">Edit</button></td>`
            : canManage() ? "<td></td>" : ""}
        </tr>`).join("")}</tbody></table></div>` : ""}
      </div>` : ""}
      ${starred.length ? `<div class="card" style="margin-bottom:1rem"><h3>⭐ Priority</h3>
        <ul>${starred.map((e) => `<li>${escapeHtml(e.vendorName)} — ${fmt(e.amount)} (${e.status})</li>`).join("")}</ul></div>` : ""}
      ${canManage() ? `<div class="card" style="margin-bottom:1rem"><h3>Monthly bills
        <button class="btn btn-sm" id="add-bill-btn" style="margin-left:.5rem">+ Add bill</button></h3>
        ${bills.length ? `<table><thead><tr><th>Type</th><th>Vendor</th><th>Due day</th><th>Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>${bills.map((b) => `<tr>
          <td>${escapeHtml(b.billType)}</td><td>${escapeHtml(b.vendor)}</td>
          <td>${b.dueDayOfMonth || "—"}</td><td>${b.amount != null ? fmt(b.amount) : "—"}</td>
          <td>${escapeHtml(b.status)}${b.starred ? " ⭐" : ""}</td>
          <td class="btn-row">
            <button class="btn btn-sm" data-bill-edit="${b.id}">Edit</button>
            <button class="btn btn-sm" data-bill-paid="${b.id}">Mark paid</button>
            <button class="btn btn-sm btn-danger" data-bill-delete="${b.id}">Delete</button>
          </td>
        </tr>`).join("")}</tbody></table>` : '<p class="muted">No monthly bills yet.</p>'}
      </div>` : ""}
      <div class="table-wrap card"><table>
        <thead><tr><th>Vendor</th><th>Amount</th><th>Status</th><th>Receipt</th><th>Priority</th><th>Due</th><th>Submitted by</th>${canManage() ? "<th></th>" : ""}</tr></thead>
        <tbody>${expenses.length ? expenses.map((e) => `<tr class="${isOverdue(e) ? "row-warn" : ""}">
          <td><strong>${escapeHtml(e.vendorName)}</strong><br><span class="muted">${escapeHtml(e.description || "")}</span></td>
          <td>${fmt(e.amount)}</td>
          <td>${escapeHtml(statusBadge(e.status, e))}</td>
          <td>${e.receiptFileId ? `<a href="/api/expenses/${e.id}/receipt" target="_blank" rel="noopener">View</a>` : "—"}</td>
          <td>${escapeHtml(e.priority)}${e.starred ? " ⭐" : ""}</td>
          <td>${e.dueDate || "—"}</td>
          <td>${escapeHtml(e.submittedBy)}</td>
          ${canManage() ? `<td class="btn-row">
            ${e.status === "pending_approval" ? `<button class="btn btn-sm btn-primary" data-approve="${e.id}">Approve</button><button class="btn btn-sm" data-deny="${e.id}">Deny</button>` : ""}
            ${e.status === "on_hold" ? `<button class="btn btn-sm" data-release="${e.id}">Release from hold</button>` : ""}
            ${e.paymentMethod === "own_pocket" && e.settlementStatus === "awaiting_settlement" ? `<button class="btn btn-sm" data-settle="${e.id}">Settle</button>` : ""}
            <button class="btn btn-sm" data-edit="${e.id}">Edit</button>
            ${e.status !== "paid" && e.status !== "archived" && e.status !== "denied" ? `<button class="btn btn-sm" data-paid="${e.id}" data-amount="${e.amount}">Mark paid</button>` : ""}
            <button class="btn btn-sm" data-hold="${e.id}">On hold</button>
            <button class="btn btn-sm" data-archive="${e.id}">Archive</button>
            <button class="btn btn-sm btn-danger" data-delete="${e.id}">Delete</button>
          </td>` : ""}
        </tr>`).join("") : '<tr><td colspan="8" class="muted">No expenses</td></tr>'}
        </tbody>
      </table></div>`;

    root.querySelector("#add-expense-btn")?.addEventListener("click", () =>
      openExpenseModal(api, helpers, funds, () => renderCostsPage(root, api, state, helpers))
    );
    root.querySelector("#show-archived-toggle")?.addEventListener("change", (e) => {
      state.showArchivedExpenses = e.target.checked;
      renderCostsPage(root, api, state, helpers);
    });
    root.querySelector("#expense-status-filter")?.addEventListener("change", (e) => {
      state.expenseStatusFilter = e.target.value;
      renderCostsPage(root, api, state, helpers);
    });
    root.querySelector("#add-bill-btn")?.addEventListener("click", () =>
      openBillModal(api, helpers, billTypes, null, () => renderCostsPage(root, api, state, helpers))
    );
    root.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.onclick = async () => {
        await api(`/expenses/${btn.dataset.approve}/approve`, { method: "POST" });
        renderCostsPage(root, api, state, helpers);
      };
    });
    root.querySelectorAll("[data-deny]").forEach((btn) => {
      btn.onclick = () => {
        openPromptModal({
          title: "Deny expense",
          message: "Optional denial reason:",
          placeholder: "Reason",
          confirmLabel: "Deny",
          onSubmit: async (reason) => {
            await api(`/expenses/${btn.dataset.deny}/deny`, {
              method: "POST",
              body: JSON.stringify({ denyReason: reason }),
            });
            renderCostsPage(root, api, state, helpers);
          },
        });
      };
    });
    root.querySelectorAll("[data-bill-edit]").forEach((btn) => {
      const bill = bills.find((b) => b.id === btn.dataset.billEdit);
      if (bill) btn.onclick = () => openBillModal(api, helpers, billTypes, bill, () => renderCostsPage(root, api, state, helpers));
    });
    root.querySelectorAll("[data-bill-delete]").forEach((btn) => {
      btn.onclick = () => {
        openConfirmModal({
          title: "Delete bill",
          message: "Delete this bill?",
          confirmLabel: "Delete",
          danger: true,
          onConfirm: async () => {
            await api(`/expenses/bills/${btn.dataset.billDelete}`, { method: "DELETE" });
            renderCostsPage(root, api, state, helpers);
          },
        });
      };
    });
    root.querySelectorAll("[data-bill-paid]").forEach((btn) => {
      btn.onclick = async () => {
        const bill = bills.find((b) => b.id === btn.dataset.billPaid);
        if (!bill) return;
        await api("/expenses/bills", {
          method: "POST",
          body: JSON.stringify({ ...bill, status: "paid", lastPaidAt: new Date().toISOString() }),
        });
        renderCostsPage(root, api, state, helpers);
      };
    });
    root.querySelectorAll("[data-edit]").forEach((btn) => {
      const expense = (expenseData.expenses || []).find((x) => x.id === btn.dataset.edit);
      if (expense) {
        btn.onclick = () =>
          openEditExpenseModal(api, helpers, expense, () => renderCostsPage(root, api, state, helpers));
      }
    });
    root.querySelectorAll("[data-settle]").forEach((btn) => {
      const expense = (expenseData.expenses || []).find((x) => x.id === btn.dataset.settle);
      if (expense) {
        btn.onclick = () => openSettleModal(api, helpers, expense, () => renderCostsPage(root, api, state, helpers));
      }
    });
    root.querySelectorAll("[data-release]").forEach((btn) => {
      btn.onclick = async () => {
        await api(`/expenses/${btn.dataset.release}`, { method: "PATCH", body: JSON.stringify({ status: "pending" }) });
        renderCostsPage(root, api, state, helpers);
      };
    });
    root.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Permanently delete this expense?")) return;
        await api(`/expenses/${btn.dataset.delete}`, { method: "DELETE" });
        renderCostsPage(root, api, state, helpers);
      };
    });
    root.querySelectorAll("[data-paid]").forEach((btn) => {
      btn.onclick = () => openMarkPaidModal(api, helpers, funds, btn.dataset.paid, Number(btn.dataset.amount), () =>
        renderCostsPage(root, api, state, helpers)
      );
    });
    root.querySelectorAll("[data-hold]").forEach((btn) => {
      btn.onclick = async () => {
        await api(`/expenses/${btn.dataset.hold}`, { method: "PATCH", body: JSON.stringify({ status: "on_hold" }) });
        renderCostsPage(root, api, state, helpers);
      };
    });
    root.querySelectorAll("[data-archive]").forEach((btn) => {
      btn.onclick = () => {
        openPromptModal({
          title: "Archive expense",
          message: "Optional cash receipt number:",
          placeholder: "Receipt #",
          confirmLabel: "Archive",
          onSubmit: async (num) => {
            await api(`/expenses/${btn.dataset.archive}`, {
              method: "PATCH",
              body: JSON.stringify({ status: "archived", cashReceiptNumber: num }),
            });
            renderCostsPage(root, api, state, helpers);
          },
        });
      };
    });
    root.querySelectorAll("[data-deposit]").forEach((btn) => {
      btn.onclick = () => openDepositModal(api, helpers, btn.dataset.deposit, () =>
        renderCostsPage(root, api, state, helpers)
      );
    });
    root.querySelectorAll("[data-ledger]").forEach((btn) => {
      btn.onclick = () => {
        state.pettyFundId = btn.dataset.ledger;
        renderCostsPage(root, api, state, helpers);
      };
    });
    root.querySelectorAll("[data-edit-ledger]").forEach((btn) => {
      btn.onclick = () => openEditLedgerModal(api, helpers, {
        id: btn.dataset.editLedger,
        amount: Number(btn.dataset.ledgerAmount),
        notes: btn.dataset.ledgerNotes || "",
        transactionType: btn.dataset.ledgerType || "deposit",
      }, () => renderCostsPage(root, api, state, helpers));
    });
  }

  function openEditLedgerModal(api, helpers, entry, onDone) {
    const { openModal, closeModal, escapeHtml } = helpers;
    const label = entry.transactionType === "adjustment" ? "adjustment" : "deposit";
    openModal(`
      <div class="modal-header"><h2>Edit petty cash ${escapeHtml(label)}</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="edit-ledger-form" class="form-grid modal-body-scroll">
        <label class="field"><span>Amount (EGP)</span><input name="amount" type="number" step="0.01" value="${entry.amount}" required /></label>
        <label class="field" style="grid-column:1/-1"><span>Notes</span><input name="notes" value="${escapeHtml(entry.notes)}" /></label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button></div>
      </form>
    `, true);
    document.getElementById("edit-ledger-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/expenses/petty-cash/ledger/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            amount: Number(fd.get("amount")),
            notes: fd.get("notes") || "",
          }),
        });
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  function openBillModal(api, helpers, billTypes, bill, onDone) {
    const { openModal, closeModal, escapeHtml } = helpers;
    const b = bill || {};
    const typeOpts = billTypes.map((t) => `<option value="${t}" ${b.billType === t ? "selected" : ""}>${t}</option>`).join("");
    openModal(`
      <div class="modal-header"><h2>${bill ? "Edit" : "Add"} monthly bill</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="bill-form" class="form-grid modal-body-scroll">
        <label class="field"><span>Type</span><select name="billType" required>${typeOpts}</select></label>
        <label class="field"><span>Vendor</span><input name="vendor" value="${escapeHtml(b.vendor || "")}" required /></label>
        <label class="field"><span>Due day (1–31)</span><input name="dueDayOfMonth" type="number" min="1" max="31" value="${b.dueDayOfMonth || ""}" /></label>
        <label class="field"><span>Amount (EGP)</span><input name="amount" type="number" step="0.01" value="${b.amount != null ? b.amount : ""}" /></label>
        <label class="field"><span>Status</span><select name="status">
          <option value="pending" ${b.status === "pending" ? "selected" : ""}>Pending</option>
          <option value="paid" ${b.status === "paid" ? "selected" : ""}>Paid</option>
          <option value="on_hold" ${b.status === "on_hold" ? "selected" : ""}>On hold</option>
        </select></label>
        <label class="field" style="grid-column:1/-1"><span>Notes</span><input name="notes" value="${escapeHtml(b.notes || "")}" /></label>
        <label class="field"><input name="starred" type="checkbox" ${b.starred ? "checked" : ""} /> Star</label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button></div>
      </form>
    `, true);
    document.getElementById("bill-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        id: bill?.id,
        billType: fd.get("billType"),
        vendor: fd.get("vendor"),
        dueDayOfMonth: fd.get("dueDayOfMonth") ? Number(fd.get("dueDayOfMonth")) : null,
        amount: fd.get("amount") ? Number(fd.get("amount")) : null,
        status: fd.get("status"),
        notes: fd.get("notes"),
        starred: fd.get("starred") === "on",
      };
      try {
        await api("/expenses/bills", { method: "POST", body: JSON.stringify(body) });
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  function openSettleModal(api, helpers, expense, onDone) {
    const { openModal, closeModal } = helpers;
    openModal(`
      <div class="modal-header"><h2>Settle own-pocket expense</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="settle-form" class="form-grid modal-body-scroll">
        <p class="muted">${helpers.escapeHtml(expense.vendorName)} — ${helpers.fmt(expense.amount)} EGP</p>
        <label class="field"><span>Employee ID (for Instapay lookup)</span><input name="employeeId" placeholder="Agent ID" /></label>
        <label class="field"><span>Settlement method</span><select name="settlementMethod">
          <option value="instapay">Instapay</option><option value="cash">Cash</option><option value="wallet">Wallet</option>
        </select></label>
        <label class="field" style="grid-column:1/-1"><span>Instapay / reference</span><input name="settlementRef" id="settlement-ref" /></label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Mark settled</button></div>
      </form>
    `, true);
    const empInput = document.querySelector('#settle-form input[name="employeeId"]');
    empInput?.addEventListener("blur", async () => {
      const id = empInput.value.trim();
      if (!id) return;
      try {
        const emp = await api(`/employees/${encodeURIComponent(id)}`);
        const ref = document.getElementById("settlement-ref");
        if (ref && emp.payment_details_insta_wallet) ref.value = emp.payment_details_insta_wallet;
      } catch { /* ignore */ }
    });
    document.getElementById("settle-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/expenses/${expense.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            settlementStatus: "settled",
            settlementMethod: fd.get("settlementMethod"),
            description: `${expense.description || ""}\nSettled via ${fd.get("settlementMethod")}: ${fd.get("settlementRef")}`.trim(),
          }),
        });
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  function openDepositModal(api, helpers, fundId, onDone) {
    const { openModal, closeModal } = helpers;
    openModal(`
      <div class="modal-header"><h2>Add petty cash funds</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="deposit-form" class="form-grid modal-body-scroll">
        <label class="field"><span>Amount (EGP)</span><input name="amount" type="number" step="0.01" required /></label>
        <label class="field" style="grid-column:1/-1"><span>Notes</span><input name="notes" /></label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Deposit</button></div>
      </form>
    `, true);
    document.getElementById("deposit-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api("/expenses/petty-cash/deposit", {
          method: "POST",
          body: JSON.stringify({
            fundId,
            amount: Number(fd.get("amount")),
            notes: fd.get("notes") || "",
          }),
        });
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  function openMarkPaidModal(api, helpers, funds, expenseId, amount, onDone) {
    const { openModal, closeModal, escapeHtml, fmt } = helpers;
    const fundOpts = funds.map((f) =>
      `<option value="${f.id}">${escapeHtml(f.fundName)} (${fmt(f.balance)} EGP)</option>`
    ).join("");
    openModal(`
      <div class="modal-header"><h2>Mark paid</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="paid-form" class="form-grid modal-body-scroll">
        <label class="field"><span>Payment method</span><select name="paymentMethod" id="pay-method">
          <option value="cash">Cash</option><option value="instapay">Instapay</option>
          <option value="wallet">Wallet</option><option value="petty_cash">Petty cash</option>
          <option value="own_pocket">Own pocket</option>
        </select></label>
        <label class="field hidden" id="fund-field"><span>Petty cash fund</span><select name="pettyCashFundId">${fundOpts}</select></label>
        <p class="muted" id="balance-hint" style="grid-column:1/-1"></p>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Confirm (${fmt(amount)} EGP)</button></div>
      </form>
    `, true);
    const methodSel = document.getElementById("pay-method");
    const fundField = document.getElementById("fund-field");
    const fundSel = fundField?.querySelector("select");
    const balanceHint = document.getElementById("balance-hint");
    function updateHint() {
      if (methodSel.value !== "petty_cash" || !fundSel) {
        balanceHint.textContent = "";
        return;
      }
      const fund = funds.find((f) => f.id === fundSel.value);
      if (fund) {
        const after = fund.balance - amount;
        balanceHint.textContent = `Balance after: ${fmt(after)} EGP${after < 0 ? " (insufficient funds)" : ""}`;
      }
    }
    methodSel.onchange = () => {
      fundField.classList.toggle("hidden", methodSel.value !== "petty_cash");
      updateHint();
    };
    fundSel?.addEventListener("change", updateHint);
    document.getElementById("paid-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        status: "paid",
        paymentMethod: fd.get("paymentMethod"),
        paidBy: state.user?.username,
      };
      if (body.paymentMethod === "petty_cash") {
        body.pettyCashFundId = fd.get("pettyCashFundId");
        if (!body.pettyCashFundId) return alert("Select a petty cash fund");
      }
      if (body.paymentMethod === "own_pocket") {
        body.settlementStatus = "awaiting_settlement";
      }
      try {
        await api(`/expenses/${expenseId}`, { method: "PATCH", body: JSON.stringify(body) });
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  function openEditExpenseModal(api, helpers, expense, onDone) {
    const { openModal, closeModal } = helpers;
    openModal(`
      <div class="modal-header"><h2>Edit expense</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="edit-expense-form" class="form-grid modal-body-scroll">
        <label class="field"><span>Vendor</span><input name="vendorName" value="${helpers.escapeHtml(expense.vendorName || "")}" required /></label>
        <label class="field"><span>Amount (EGP)</span><input name="amount" type="number" step="0.01" value="${expense.amount}" required /></label>
        <label class="field" style="grid-column:1/-1"><span>Notes</span><textarea name="description" rows="3">${helpers.escapeHtml(expense.description || "")}</textarea></label>
        <label class="field" style="grid-column:1/-1"><span>Receipt (replace)</span><input name="receipt" type="file" accept="image/*,application/pdf" /></label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button></div>
      </form>
    `, true);
    document.getElementById("edit-expense-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        vendorName: fd.get("vendorName"),
        description: fd.get("description"),
        amount: Number(fd.get("amount")),
      };
      try {
        await api(`/expenses/${expense.id}`, { method: "PATCH", body: JSON.stringify(body) });
        const file = fd.get("receipt");
        if (file && file.size) {
          const base64 = await fileToBase64(file);
          await api(`/expenses/${expense.id}/receipt`, {
            method: "POST",
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type || "application/pdf",
              base64,
            }),
          });
        }
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  function openExpenseModal(api, helpers, funds, onDone) {
    const { openModal, closeModal } = helpers;
    openModal(`
      <div class="modal-header"><h2>Submit receipt / invoice</h2><button class="btn btn-sm" data-close>✕</button></div>
      <form id="expense-form" class="form-grid modal-body-scroll">
        <label class="field"><span>Vendor</span><input name="vendorName" required /></label>
        <label class="field" style="grid-column:1/-1"><span>Description</span><textarea name="description" rows="3"></textarea></label>
        <label class="field"><span>Amount (EGP)</span><input name="amount" type="number" step="0.01" required /></label>
        <label class="field"><span>Due date (optional)</span><input name="dueDate" type="date" /></label>
        <label class="field"><span>Priority</span><select name="priority">
          <option value="normal">Normal</option><option value="important">Important</option><option value="emergency">Emergency</option>
        </select></label>
        <label class="field"><span>Receipt (image or PDF)</span><input name="receipt" type="file" accept="image/*,application/pdf" /></label>
        <label class="field"><input name="starred" type="checkbox" /> Star (show first)</label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Submit</button></div>
      </form>
    `, true);
    document.getElementById("expense-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        vendorName: fd.get("vendorName"),
        description: fd.get("description"),
        amount: Number(fd.get("amount")),
        dueDate: fd.get("dueDate") || null,
        priority: fd.get("priority"),
        starred: fd.get("starred") === "on",
      };
      try {
        const res = await api("/expenses", { method: "POST", body: JSON.stringify(body) });
        const file = fd.get("receipt");
        if (file && file.size && res.expense?.id) {
          const base64 = await fileToBase64(file);
          await api(`/expenses/${res.expense.id}/receipt`, {
            method: "POST",
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type || "application/pdf",
              base64,
            }),
          });
        }
        closeModal();
        onDone();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  return { renderCostsPage };
})();
