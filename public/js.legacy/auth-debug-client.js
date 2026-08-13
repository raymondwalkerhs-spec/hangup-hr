/** Browser-side auth debug — mirrors steps to console and POSTs to server terminal. */
(function () {
  const KEY = "hr_auth_debug";
  const enabled =
    localStorage.getItem(KEY) === "1" ||
    /(?:^|[?&])auth_debug=1(?:&|$)/.test(location.search || "");

  function ts() {
    return new Date().toISOString().slice(11, 23);
  }

  function log(step, detail) {
    const line = `[auth-debug ${ts()}] ${step}`;
    console.log(line, detail || "");
    appendPanel(line, detail);
    fetch("/api/auth-debug/client-log", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, detail: detail || {}, at: new Date().toISOString() }),
    }).catch(() => {});
  }

  function logError(step, err, detail) {
    const msg = err?.message || String(err || "error");
    const line = `[auth-debug ${ts()}] ${step} ERROR: ${msg}`;
    console.error(line, detail || "");
    appendPanel(line, { ...(detail || {}), error: msg });
    fetch("/api/auth-debug/client-log", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step: `${step}:error`,
        detail: { ...(detail || {}), error: msg },
        at: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  function appendPanel(line, detail) {
    const panel = document.getElementById("auth-debug-log");
    if (!panel) return;
    const row = document.createElement("div");
    row.className = "auth-debug-row";
    const extra =
      detail && Object.keys(detail).length
        ? " " + JSON.stringify(detail, (_, v) => (v && typeof v === "string" && v.length > 40 ? v.slice(0, 8) + "…" : v))
        : "";
    row.textContent = line + extra;
    panel.appendChild(row);
    panel.scrollTop = panel.scrollHeight;
  }

  function initPanel() {
    if (document.getElementById("auth-debug-wrap")) return;
    const wrap = document.createElement("div");
    wrap.id = "auth-debug-wrap";
    wrap.className = "auth-debug-wrap";
    wrap.innerHTML =
      '<button type="button" class="auth-debug-toggle" id="auth-debug-toggle">Auth debug log</button>' +
      '<pre id="auth-debug-log" class="auth-debug-log hidden" aria-live="polite"></pre>';
    document.body.appendChild(wrap);
    const toggle = document.getElementById("auth-debug-toggle");
    const panel = document.getElementById("auth-debug-log");
    toggle?.addEventListener("click", () => {
      panel?.classList.toggle("hidden");
      toggle.textContent = panel?.classList.contains("hidden") ? "Auth debug log" : "Hide auth debug";
    });
    if (enabled) {
      panel?.classList.remove("hidden");
      if (toggle) toggle.textContent = "Hide auth debug";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPanel);
  } else {
    initPanel();
  }

  window.hrAuthDebug = { enabled, log, logError, maskSessionId(id) {
    const s = String(id || "");
    return s.length > 12 ? s.slice(0, 8) + "…" : s || "(none)";
  }};
})();
