const SAVED_USER_KEY = "hr_saved_user";
const SESSION_KEY = "hr_session_id";
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const rememberBox = document.getElementById("remember-user");
const loginForm = document.getElementById("login-form");
const loginBtn = document.getElementById("login-btn");
const err = document.getElementById("login-error");
const blockedBox = document.getElementById("version-blocked");
const blockedMsg = document.getElementById("version-blocked-msg");

let loginPermanentlyBlocked = false;

// Password visibility toggle
const pwToggle = document.getElementById("password-toggle");
pwToggle?.addEventListener("click", () => {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  pwToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  pwToggle.classList.toggle("active", !showing);
});

// ===== View + step switching =====
const loginView = document.getElementById("login-view");
const registerView = document.getElementById("register-view");
let regCompany = "hangup";
function showView(view) {
  loginView.classList.toggle("hidden", view !== "login");
  registerView.classList.toggle("hidden", view !== "register");
  refreshLoginIcons();
}
function refreshLoginIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    try { window.lucide.createIcons(); } catch { /* noop */ }
  }
  document.querySelectorAll("i[data-lucide]").forEach((el) => {
    if (!el.querySelector("svg")) el.textContent = { eye: "👁", "eye-off": "👁", menu: "☰", x: "✕", lock: "🔒", check: "✓" }[el.dataset.lucide] || "•";
  });
}
document.getElementById("show-register")?.addEventListener("click", () => {
  showView("register");
  goToRegStep(1);
  renderRegPinCells();
  document.getElementById("reg-pin")?.focus();
});
document.getElementById("show-login")?.addEventListener("click", () => showView("login"));
document.getElementById("reg-done-btn")?.addEventListener("click", () => showView("login"));
document.getElementById("show-login-from-reg")?.addEventListener("click", () => goToRegStep(1));

function goToRegStep(step) {
  for (const n of [1, 2, 3]) {
    document.getElementById(`reg-step-${n}`)?.classList.toggle("hidden", n !== step);
  }
  document.querySelectorAll("[data-step-dot]").forEach((dot) => {
    const n = Number(dot.dataset.stepDot);
    dot.classList.toggle("active", n === step);
    dot.classList.toggle("done", n < step);
  });
  refreshLoginIcons();
}

// Step 1: registration code (XXXX-1234 or 4-digit PIN)
const regPinInput = document.getElementById("reg-pin");
const regPinCells = document.getElementById("reg-pin-cells");
const regPinWrap = document.getElementById("reg-pin-wrap");
const regPinError = document.getElementById("reg-pin-error");
const regCompanyDisplay = document.getElementById("reg-company-display");

function formatRegPin(raw) {
  const clean = String(raw || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

function pinCells(pin) {
  const compact = String(pin || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  const slots = ["", "", "", "", "", "", "", ""];
  for (let i = 0; i < Math.min(compact.length, 8); i += 1) slots[i] = compact[i];
  return slots;
}

function otpCellHtml(char, active) {
  const filled = Boolean(char);
  return `<div class="otp-node${filled ? " has-value" : ""}${active ? " active" : ""}">
    <svg viewBox="0 0 44 52" aria-hidden="true"><rect class="trace" x="2" y="2" width="40" height="48" rx="8" fill="none" pathLength="100"/></svg>
    <span class="otp-char">${char || ""}</span>
  </div>`;
}

function renderRegPinCells() {
  if (!regPinCells || !regPinInput) return;
  const cells = pinCells(regPinInput.value);
  const compactLen = regPinInput.value.replace(/[^A-Za-z0-9]/g, "").length;
  const activeIndex = document.activeElement === regPinInput ? Math.min(compactLen, 7) : -1;
  const html = [];
  for (let i = 0; i < 4; i += 1) html.push(otpCellHtml(cells[i], activeIndex === i));
  html.push('<span class="otp-dash">-</span>');
  for (let i = 4; i < 8; i += 1) html.push(otpCellHtml(cells[i], activeIndex === i));
  regPinCells.innerHTML = html.join("");
}

regPinInput?.addEventListener("input", () => {
  const formatted = formatRegPin(regPinInput.value);
  if (formatted !== regPinInput.value) regPinInput.value = formatted;
  renderRegPinCells();
});
regPinInput?.addEventListener("focus", renderRegPinCells);
regPinInput?.addEventListener("blur", renderRegPinCells);
regPinWrap?.addEventListener("click", () => regPinInput?.focus());
renderRegPinCells();

async function verifyPinAndAdvance() {
  const pinErr = regPinError;
  const code = regPinInput?.value?.trim() || "";
  const compact = code.replace(/[^A-Za-z0-9]/g, "");
  if (!/^\d{4}$/.test(compact) && compact.length < 8) {
    pinErr.textContent = "Enter today's registration code from your supervisor.";
    pinErr.classList.remove("hidden");
    return;
  }
  pinErr.classList.add("hidden");
  try {
    const res = await fetch("/api/registration/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Invalid PIN");
    regCompany = data.company || "hangup";
    const companyLabel = document.getElementById("reg-company-label");
    if (companyLabel) companyLabel.textContent = regCompany === "hs2" ? "HS-2" : "Main Hangup";
    if (regCompanyDisplay) regCompanyDisplay.textContent = `Detected company: ${regCompany === "hs2" ? "HS-2" : "Main Hangup"}`;
    const unitWrap = document.getElementById("reg-unit-wrap");
    const unitNote = document.getElementById("reg-unit-note");
    if (regCompany === "hs2") {
      if (unitWrap) unitWrap.classList.add("hidden");
      if (unitNote) unitNote.textContent = "You will be assigned to HS-2 automatically.";
    } else {
      if (unitWrap) unitWrap.classList.remove("hidden");
      if (unitNote) unitNote.textContent = "Team is assigned later by Admin/HR after approval.";
    }
    goToRegStep(2);
    document.getElementById("reg-full-name")?.focus();
  } catch (e) {
    pinErr.textContent = e.message || "Invalid or expired PIN";
    pinErr.classList.remove("hidden");
  }
}

document.getElementById("reg-next-1")?.addEventListener("click", verifyPinAndAdvance);
regPinInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    verifyPinAndAdvance();
  }
});

document.getElementById("reg-back-2")?.addEventListener("click", () => {
  regPinInput?.focus();
  goToRegStep(1);
});

function setLoginBlocked(message) {
  loginPermanentlyBlocked = true;
  err.classList.add("hidden");
  blockedBox.classList.remove("hidden");
  blockedMsg.textContent = message || "This app version is no longer supported.";
  loginBtn.disabled = true;
  loginForm.querySelectorAll("input").forEach((el) => {
    el.disabled = true;
  });
}

function showLoginUpdateBanner({ title, message, urgent }) {
  const banner = document.getElementById("login-update-banner");
  const titleEl = document.getElementById("login-update-title");
  const msg = document.getElementById("login-update-msg");
  const btn = document.getElementById("login-update-btn");
  if (!banner || !msg) return;
  banner.classList.remove("hidden");
  banner.classList.toggle("alert-warn", !urgent);
  banner.classList.toggle("alert-danger", Boolean(urgent));
  if (titleEl) titleEl.textContent = title || "Update available";
  msg.textContent = message;
  if (btn && window.hrDesktop?.applyGitHubUpdate) {
    btn.style.display = "inline-block";
    btn.disabled = false;
    btn.textContent = "Update now";
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Downloading…";
      try {
        const result = await window.hrDesktop.applyGitHubUpdate();
        if (result?.needsQuit) {
          btn.textContent = "Installer started…";
          return;
        }
        btn.textContent = "Restarting…";
        setTimeout(() => window.hrDesktop.relaunchApp?.(), 800);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Update now";
        alert(e.message || "Update failed");
      }
    };
  }
}

async function loadVersionInfo() {
  try {
    const res = await fetch("/api/version-info");
    const data = await res.json();
    const line = document.getElementById("app-version-line");
    if (line && data.appVersion) {
      line.textContent = `App version ${data.appVersion}`;
    }
    if (data.versionCheck?.status === "blocked") {
      setLoginBlocked(data.versionCheck.message);
    }
    if (data.installHealth && !data.installHealth.ok) {
      showLoginUpdateBanner({
        title: "Reinstall required",
        message: data.installHealth.message,
        urgent: true,
      });
    }
    const githubInfo =
      data.githubUpdate ||
      (await fetch("/api/github-update").then((r) => (r.ok ? r.json() : null)).catch(() => null));
    const blocked = data.versionCheck?.status === "blocked";
    if (blocked) {
      showLoginUpdateBanner({
        title: "Update required",
        message: githubInfo?.latest
          ? `Version ${githubInfo.latest} is ready (you have ${githubInfo.current || data.appVersion}). Use Update now to continue.`
          : `${data.versionCheck?.message || "This app version is no longer supported."} Use Update now to install the latest version.`,
        urgent: true,
      });
    } else if (githubInfo?.enabled && githubInfo.updateAvailable) {
      if (data.installHealth && !data.installHealth.ok) {
        const msg = document.getElementById("login-update-msg");
        if (msg) {
          msg.textContent += ` Version ${githubInfo.latest} is ready on GitHub.`;
        }
      } else {
        showLoginUpdateBanner({
          title: "Update available",
          message: `Version ${githubInfo.latest} is on GitHub (you have ${githubInfo.current || data.appVersion}). ${
            githubInfo.updateDescription || "Update now to install the latest version."
          }`,
          urgent: false,
        });
      }
    } else if (data.installHealth && !data.installHealth.ok) {
      const btn = document.getElementById("login-update-btn");
      if (btn) btn.style.display = "none";
    }
  } catch (_) {}
}

loadVersionInfo();
refreshLoginIcons();

window.hrAuthDebug?.log("login.page.load", {
  savedSession: Boolean(sessionStorage.getItem(SESSION_KEY)),
  sessionId: window.hrAuthDebug?.maskSessionId(sessionStorage.getItem(SESSION_KEY)),
});

(async () => {
  try {
    const statusRes = await fetch("/api/auth-debug/status");
    const status = await statusRes.json().catch(() => ({}));
    window.hrAuthDebug?.log("login.auth-debug.status", status);
  } catch (e) {
    window.hrAuthDebug?.logError("login.auth-debug.status", e);
  }
})();

(async () => {
  try {
    const sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) return;
    window.hrAuthDebug?.log("login.session-check.auto", { sessionId: window.hrAuthDebug?.maskSessionId(sid) });
    const res = await fetch("/api/session-check", {
      credentials: "same-origin",
      headers: { "x-session-id": sid },
    });
    const data = await res.json().catch(() => ({}));
    window.hrAuthDebug?.log("login.session-check.result", { status: res.status, action: data.action, error: data.error });
    if (res.ok && (data.action === "ok" || !data.action)) {
      window.hrAuthDebug?.log("login.redirect.home", { reason: "existing_session" });
      window.location.href = "/";
    }
  } catch (e) {
    window.hrAuthDebug?.logError("login.session-check.auto", e);
  }
})();

function regNationalityValue() {
  const sel = document.getElementById("reg-nationality");
  if (!sel) return "";
  if (sel.value === "__other__") return document.getElementById("reg-nationality-other")?.value?.trim() || "";
  return sel.value?.trim() || "";
}
function regIsEgyptian(n) {
  const x = String(n || "").trim().toLowerCase();
  return x === "egyptian" || x === "egypt" || x === "egyptain";
}
function refreshRegIdentityFields() {
  const nat = regNationalityValue();
  const egyptian = regIsEgyptian(nat);
  const other = document.getElementById("reg-nationality-other");
  const sel = document.getElementById("reg-nationality");
  if (other && sel) other.classList.toggle("hidden", sel.value !== "__other__");
  document.getElementById("reg-national-id-wrap")?.classList.toggle("hidden", nat && !egyptian);
  document.getElementById("reg-passport-wrap")?.classList.toggle("hidden", !nat || egyptian);
}
document.getElementById("reg-nationality")?.addEventListener("change", refreshRegIdentityFields);
document.getElementById("reg-nationality-other")?.addEventListener("input", refreshRegIdentityFields);
refreshRegIdentityFields();

document.getElementById("reg-submit")?.addEventListener("click", async () => {
  const msg = document.getElementById("reg-msg");
  const btn = document.getElementById("reg-submit");
  msg.classList.add("hidden");
  btn.classList.add("is-loading");
  btn.disabled = true;
  try {
    const legalName = document.getElementById("reg-legal-name")?.value?.trim() || "";
    const email = document.getElementById("reg-email")?.value?.trim() || "";
    const rawAmerican = document.getElementById("reg-american-name")?.value?.trim() || "";
    const americanName = rawAmerican.replace(/\s+/g, " ").trim();
    const americanWords = americanName.split(" ").filter(Boolean);
    if (americanWords.length !== 2) throw new Error("American name must be exactly 2 words (First and Last name).");
    const legalWords = legalName.split(/\s+/).filter(Boolean);
    if (legalWords.length < 3) throw new Error("Legal name must contain at least 3 words.");
    if (!email || !email.includes("@")) throw new Error("A valid email is required.");
    const password = document.getElementById("reg-password")?.value || "";
    const passwordConfirm = document.getElementById("reg-password-confirm")?.value || "";
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    if (password !== passwordConfirm) throw new Error("Password confirmation does not match.");
    const nationality = regNationalityValue();
    const res = await fetch("/api/registration/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pin: document.getElementById("reg-pin")?.value?.trim(),
        fullName: legalName,
        americanName,
        email,
        nationality,
        nationalId: document.getElementById("reg-national-id")?.value?.trim(),
        passportNumber: document.getElementById("reg-passport")?.value?.trim(),
        phone: document.getElementById("reg-phone")?.value?.trim(),
        unit: document.getElementById("reg-unit")?.value,
        company: regCompany,
        password,
        passwordConfirm,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    const successMsg = document.getElementById("reg-success-msg");
    if (successMsg && data.message) successMsg.textContent = data.message;
    goToRegStep(3);
  } catch (e) {
    msg.textContent = e.message || "Registration failed";
    msg.classList.remove("hidden");
  } finally {
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
});

// Prefill remembered username on this device; purge legacy saved passwords.
try {
  localStorage.removeItem("hr_saved_password");
  const savedUser = localStorage.getItem(SAVED_USER_KEY);
  if (savedUser) {
    usernameInput.value = savedUser;
    rememberBox.checked = true;
  }
  if (savedUser) passwordInput.focus();
} catch (_) {}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");
  err.classList.add("hidden");
  btn.classList.add("is-loading");
  btn.disabled = true;
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  window.hrAuthDebug?.log("login.submit", { username });
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    let data = {};
    try {
      data = await res.json();
    } catch (parseErr) {
      window.hrAuthDebug?.logError("login.response.parse", parseErr, { status: res.status });
      throw new Error(res.ok ? "Invalid server response" : "Login failed");
    }
    window.hrAuthDebug?.log("login.response", {
      status: res.status,
      ok: data.ok,
      error: data.error,
      sessionId: window.hrAuthDebug?.maskSessionId(data.sessionId),
      versionBlocked: data.versionBlocked,
      offline: data.offline,
    });
    if (data.versionBlocked) {
      setLoginBlocked(data.versionCheck?.message || data.error);
      return;
    }
    if (data.terminated && window.hrDesktop) {
      await window.hrDesktop.triggerUninstall();
      return;
    }
    if (!res.ok) throw new Error(data.error || "Login failed");
    if (!data.sessionId) throw new Error("Login succeeded but no session was returned. Try again.");
    try {
      if (rememberBox.checked) localStorage.setItem(SAVED_USER_KEY, username);
      else localStorage.removeItem(SAVED_USER_KEY);
    } catch (_) {}
    try {
      sessionStorage.setItem(SESSION_KEY, data.sessionId);
      window.hrAuthDebug?.log("login.sessionStorage.set", { sessionId: window.hrAuthDebug?.maskSessionId(data.sessionId) });
    } catch (storageErr) {
      window.hrAuthDebug?.logError("login.sessionStorage.set", storageErr);
    }
    if (window.hrDesktop) {
      try {
        await window.hrDesktop.setSession(data.sessionId);
        window.hrAuthDebug?.log("login.electron.setSession.ok");
      } catch (deskErr) {
        window.hrAuthDebug?.logError("login.electron.setSession", deskErr);
      }
    }
    try {
      sessionStorage.setItem("hr_check_app_update", "1");
    } catch (_) {}
    if (data.versionNotice) {
      try {
        sessionStorage.setItem(
          "hr_pending_version_notice",
          JSON.stringify(data.versionNotice)
        );
      } catch (_) {}
    }
    window.hrAuthDebug?.log("login.redirect.home", { reason: "login_success" });
    window.location.href = "/";
  } catch (ex) {
    window.hrAuthDebug?.logError("login.submit", ex, { username });
    err.textContent = ex.message;
    err.classList.remove("hidden");
    err.classList.remove("shake");
    void err.offsetWidth; /* restart shake animation */
    err.classList.add("shake");
  } finally {
    btn.classList.remove("is-loading");
    if (!loginPermanentlyBlocked) btn.disabled = false;
  }
});
  