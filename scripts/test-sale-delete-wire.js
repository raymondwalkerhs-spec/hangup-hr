#!/usr/bin/env node
/**
 * Regression: sale delete confirm must resolve elements inside modal/form scope.
 * getElementById only exists on Document — not on <form> or <div> roots.
 */
const assert = require("assert");

function resolveDeleteScope(root) {
  const scope = root && typeof root.querySelector === "function" ? root : null;
  if (!scope) return null;
  return {
    panel: scope.querySelector("#sale-delete-confirm-panel"),
    input: scope.querySelector("#sale-delete-confirm-input"),
    confirmBtn: scope.querySelector("#sale-delete-confirm-btn"),
  };
}

function syncConfirmEnabled(input, confirmBtn) {
  confirmBtn.disabled = input.value.trim() !== "DELETE";
}

function makeScope(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  const node = tpl.content.firstElementChild;
  return node;
}

// Minimal DOM shim (Node has no document)
const { JSDOM } = (() => {
  try {
    return { JSDOM: require("jsdom").JSDOM };
  } catch (_) {
    return { JSDOM: null };
  }
})();

if (!JSDOM) {
  // Fallback without jsdom: mock scope object
  const input = { value: "", trim() { return this.value.trim(); } };
  const confirmBtn = { disabled: true };
  const scope = {
    querySelector(sel) {
      if (sel === "#sale-delete-confirm-panel") return { id: "panel" };
      if (sel === "#sale-delete-confirm-input") return input;
      if (sel === "#sale-delete-confirm-btn") return confirmBtn;
      return null;
    },
  };
  assert.strictEqual(typeof scope.getElementById, "undefined");
  const els = resolveDeleteScope(scope);
  assert(els.panel && els.input && els.confirmBtn, "querySelector finds delete controls in form scope");
  input.value = "DELETE";
  syncConfirmEnabled(input, confirmBtn);
  assert.strictEqual(confirmBtn.disabled, false, "DELETE enables confirm button");
  input.value = "delete";
  syncConfirmEnabled(input, confirmBtn);
  assert.strictEqual(confirmBtn.disabled, true, "lowercase delete stays disabled");
  console.log("sale-delete-wire tests passed (mock DOM).");
  process.exit(0);
}

const dom = new JSDOM(
  `<form id="sale-form">
    <div id="sale-delete-confirm-panel">
      <input id="sale-delete-confirm-input" />
      <button id="sale-delete-confirm-btn" disabled></button>
    </div>
  </form>`
);
global.document = dom.window.document;

const form = document.getElementById("sale-form");
assert.strictEqual(typeof form.getElementById, "undefined", "form must not expose getElementById");
const broken = form.getElementById?.("sale-delete-confirm-input");
assert.strictEqual(broken, undefined, "getElementById on form returns nothing");

const els = resolveDeleteScope(form);
assert(els.input && els.confirmBtn, "querySelector resolves controls inside form");

els.input.value = "DELETE";
syncConfirmEnabled(els.input, els.confirmBtn);
assert.strictEqual(els.confirmBtn.disabled, false);

console.log("sale-delete-wire tests passed.");
