const express = require("express");
const bcrypt = require("bcrypt");
const roles = require("../lib/roles");
const usersAdmin = require("../lib/users-admin");
const hrms = require("../lib/hrms-repo");
const { getSession, destroySession, updateSession, demoteSessionsForUser } = require("../lib/session-store");
const { fetchAuthUsers } = require("../lib/auth");
const authBridge = require("../lib/auth-bridge");
const { authDebug, authDebugError } = require("../lib/auth-debug");

const router = express.Router();
const MIN_PASSWORD_LENGTH = 8;

function requireBridge(res) {
  if (!authBridge.isAuthBridgeEnabled()) {
    res.status(400).json({
      error: "Auth MFA/Google bridge is off. Set AUTH_BACKEND=dual to enable.",
      code: "auth_bridge_off",
    });
    return false;
  }
  return true;
}

function blockIfImpersonating(req, res) {
  if (req.impersonatingAs) {
    res.status(403).json({
      error: "Exit impersonation before changing account security",
      code: "impersonation_blocked",
    });
    return true;
  }
  return false;
}

async function ensureAuthSessionTokens(session, passwordHint = null) {
  if (session.supabaseAccessToken) return session.supabaseAccessToken;
  if (!passwordHint) {
    throw new Error("Auth session expired for MFA. Sign in again with password.");
  }
  const row = await authBridge.fetchAppUserAuthRow(session.username);
  const synthetic = row?.synthetic_email || authBridge.syntheticEmailForUsername(session.username);
  const data = await authBridge.signInAuthWithPassword(synthetic, passwordHint);
  updateSession(session.id, {
    supabaseAccessToken: data.session?.access_token || null,
    supabaseRefreshToken: data.session?.refresh_token || null,
    authUserId: data.user?.id || session.authUserId || null,
  });
  return data.session?.access_token;
}

async function promoteSessionIfReady(session) {
  const row = await authBridge.fetchAppUserAuthRow(session.username);
  const needs = authBridge.setupNeeds(row);
  if (!needs.needsSetup) {
    updateSession(session.id, { sessionKind: "full" });
    try {
      await hrms.upsertAppSession({ ...getSession(session.id) });
    } catch {
      /* ignore */
    }
    return { promoted: true, needs };
  }
  return { promoted: false, needs };
}

router.get("/security-status", async (req, res) => {
  try {
    const bridgeOn = authBridge.isAuthBridgeEnabled();
    const row = bridgeOn ? await authBridge.fetchAppUserAuthRow(req.appSession.username) : null;
    const needs = authBridge.setupNeeds(row);
    res.json({
      authBackend: authBridge.getAuthBackendMode(),
      bridgeEnabled: bridgeOn,
      sessionKind: req.appSession.sessionKind || "full",
      loginMethod: req.appSession.loginMethod || "password",
      mfaRequired: row ? row.mfa_required !== false : false,
      mfaEnrolled: Boolean(row?.mfa_enrolled_at),
      mfaEnrolledAt: row?.mfa_enrolled_at || null,
      googleLinked: Boolean(row?.google_linked_at && row?.google_email),
      googleEmail: row?.google_email || null,
      emailClaimed: row?.email_claimed || row?.email || null,
      needsMfaEnroll: needs.needsMfaEnroll,
      needsGoogleLink: needs.needsGoogleLink,
      needsSetup: needs.needsSetup,
      oauthRedirect: authBridge.oauthRedirectUri(),
      supabaseHost: authBridge.expectedSupabaseHost(),
    });
  } catch (e) {
    authDebugError("security-status", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/mfa/enroll/start", async (req, res) => {
  if (!requireBridge(res)) return;
  if (blockIfImpersonating(req, res)) return;
  try {
    const session = req.appSession;
    let token = session.supabaseAccessToken;
    if (!token && req.body?.password) {
      await authBridge.syncPasswordToAuth(session.username, req.body.password);
      token = await ensureAuthSessionTokens(session, req.body.password);
    }
    if (!token) {
      return res.status(400).json({
        error: "Re-enter your password to start Authenticator setup.",
        code: "password_required",
      });
    }
    const enroll = await authBridge.enrollMfaStart(token);
    updateSession(session.id, { mfaFactorId: enroll.factorId });
    res.json({
      ok: true,
      factorId: enroll.factorId,
      qrCode: enroll.qrCode,
      secret: enroll.secret,
      uri: enroll.uri,
    });
  } catch (e) {
    const mapped = authBridge.mapAuthError(e);
    authDebugError("mfa.enroll.start", e);
    res.status(400).json({ error: mapped.message, code: mapped.code, retryable: mapped.retryable });
  }
});

router.post("/mfa/enroll/verify", async (req, res) => {
  if (!requireBridge(res)) return;
  if (blockIfImpersonating(req, res)) return;
  try {
    const session = req.appSession;
    const code = String(req.body?.code || "").trim();
    const factorId = String(req.body?.factorId || session.mfaFactorId || "").trim();
    if (!code || code.length < 6) {
      return res.status(400).json({ error: "Enter the 6-digit authenticator code", code: "invalid_totp" });
    }
    if (!factorId) {
      return res.status(400).json({ error: "Start MFA enroll first", code: "enroll_required" });
    }
    let token = session.supabaseAccessToken;
    if (!token && req.body?.password) {
      token = await ensureAuthSessionTokens(session, req.body.password);
    }
    if (!token) {
      return res.status(400).json({ error: "Auth session missing. Sign in again.", code: "auth_session_missing" });
    }
    await authBridge.enrollMfaVerify(token, factorId, code);
    await authBridge.patchAppUserAuth(session.username, {
      mfa_enrolled_at: new Date().toISOString(),
    });
    updateSession(session.id, { mfaFactorId: null });
    const promo = await promoteSessionIfReady(session);
    res.json({
      ok: true,
      mfaEnrolled: true,
      sessionKind: getSession(session.id)?.sessionKind || session.sessionKind,
      needsMfaEnroll: promo.needs.needsMfaEnroll,
      needsGoogleLink: promo.needs.needsGoogleLink,
      needsSetup: promo.needs.needsSetup,
    });
  } catch (e) {
    const mapped = authBridge.mapAuthError(e);
    authDebugError("mfa.enroll.verify", e);
    res.status(400).json({ error: mapped.message, code: mapped.code, retryable: mapped.retryable });
  }
});

router.put("/change-password", async (req, res) => {
  if (blockIfImpersonating(req, res)) return;
  authDebug("change-password.start", { username: req.appSession?.username });
  const { currentPassword, newPassword, totpCode } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Current and new password (min ${MIN_PASSWORD_LENGTH} chars) required`,
    });
  }

  const session = req.appSession;
  const users = await fetchAuthUsers();
  const record = users.find((u) => u.user.toLowerCase() === session.username.toLowerCase());
  if (!record) return res.status(400).json({ error: "User not found" });

  const valid = record.passwordIsHash
    ? await bcrypt.compare(String(currentPassword), record.password)
    : record.password === currentPassword;
  if (!valid) {
    authDebug("change-password.fail", { username: session.username, reason: "bad_current_password" });
    return res.status(400).json({ error: "Current password is incorrect" });
  }

  try {
    if (authBridge.isAuthBridgeEnabled()) {
      const row = await authBridge.fetchAppUserAuthRow(session.username);
      if (row?.mfa_enrolled_at) {
        if (!totpCode || String(totpCode).trim().length < 6) {
          return res.status(400).json({
            error: "Authenticator code required to change password",
            code: "totp_required",
          });
        }
        await authBridge.syncPasswordToAuth(session.username, currentPassword, row);
        const token =
          session.supabaseAccessToken || (await ensureAuthSessionTokens(session, currentPassword));
        await authBridge.verifyTotpForUser(token, totpCode);
      }
    }

    const updated = await usersAdmin.updateAppUser(
      session.username,
      { password: newPassword },
      session.username,
      { keepSessionId: session.id }
    );
    const warnings = [];
    try {
      await hrms.revokeOtherSessionsForUser(session.username, session.id);
      authDebug("change-password.revoke_other_sessions.ok", { username: session.username });
    } catch (err) {
      warnings.push("sessions_revoke_failed");
      authDebugError("change-password.revokeOtherSessions", err, { username: session.username });
    }

    if (authBridge.isAuthBridgeEnabled()) {
      const sync = await authBridge.syncPasswordToAuth(session.username, newPassword);
      if (!sync.synced && !sync.skipped) warnings.push("auth_password_sync_failed");
      try {
        const fresh = { ...getSession(session.id), supabaseAccessToken: null };
        const token = await ensureAuthSessionTokens(fresh, newPassword);
        updateSession(session.id, {
          supabaseAccessToken: token,
          passwordChangedAtSnapshot: updated.passwordChangedAt || new Date().toISOString(),
        });
      } catch (err) {
        warnings.push("auth_relogin_failed");
        authDebugError("change-password.authRelogin", err);
      }
    }

    updateSession(session.id, {
      passwordChangedAtSnapshot: updated.passwordChangedAt || new Date().toISOString(),
    });
    authDebug("change-password.ok", { username: session.username, sessionId: session.id });
    res.json({ ok: true, warnings: warnings.length ? warnings : undefined });
  } catch (e) {
    const mapped = authBridge.mapAuthError(e);
    authDebugError("change-password.exception", e, { username: session.username });
    res.status(400).json({ error: mapped.message || e.message, code: mapped.code });
  }
});

router.post("/google/start-link", async (req, res) => {
  if (!requireBridge(res)) return;
  if (blockIfImpersonating(req, res)) return;
  try {
    const session = req.appSession;
    // Recover: Google may already be on Auth from a prior attempt while app_users is empty.
    try {
      const synced = await authBridge.syncGoogleLinkFromAuthUser(session.username);
      if (synced.synced) {
        const promo = await promoteSessionIfReady(session);
        return res.json({
          ok: true,
          alreadyLinked: true,
          googleEmail: synced.googleEmail,
          sessionKind: getSession(session.id)?.sessionKind || session.sessionKind,
          needsMfaEnroll: promo.needs.needsMfaEnroll,
          needsGoogleLink: promo.needs.needsGoogleLink,
          needsSetup: promo.needs.needsSetup,
        });
      }
    } catch (syncErr) {
      authDebugError("google.start-link.syncExisting", syncErr, { username: session.username });
    }

    let token = session.supabaseAccessToken;
    if (!token && req.body?.password) {
      await authBridge.syncPasswordToAuth(session.username, req.body.password);
      token = await ensureAuthSessionTokens(session, req.body.password);
    }
    if (!token) {
      return res.status(400).json({
        error: "Re-enter your password to link Google.",
        code: "password_required",
      });
    }
    const oauth = await authBridge.getGoogleAuthUrlViaClient({ accessToken: token });
    if (!oauth.url) {
      return res.status(500).json({ error: "Could not build Google OAuth URL", code: "oauth_url_missing" });
    }
    require("../lib/oauth-pending-store").beginOauth("link");
    updateSession(session.id, { googleLinkPending: true });
    res.json({ ok: true, url: oauth.url, redirectTo: oauth.redirectTo, mode: "link" });
  } catch (e) {
    const mapped = authBridge.mapAuthError(e);
    // If linkIdentity failed because Auth already has Google, sync Hangup row and continue.
    if (mapped.code === "identity_already_linked") {
      try {
        const synced = await authBridge.syncGoogleLinkFromAuthUser(req.appSession.username);
        if (synced.synced) {
          const promo = await promoteSessionIfReady(req.appSession);
          return res.json({
            ok: true,
            alreadyLinked: true,
            googleEmail: synced.googleEmail,
            needsMfaEnroll: promo.needs.needsMfaEnroll,
            needsGoogleLink: promo.needs.needsGoogleLink,
            needsSetup: promo.needs.needsSetup,
          });
        }
      } catch (syncErr) {
        authDebugError("google.start-link.recoverAlreadyLinked", syncErr);
      }
    }
    authDebugError("google.start-link", e);
    res.status(400).json({ error: mapped.message, code: mapped.code, retryable: mapped.retryable });
  }
});

router.post("/google/sync-link", async (req, res) => {
  if (!requireBridge(res)) return;
  if (blockIfImpersonating(req, res)) return;
  try {
    const session = req.appSession;
    const synced = await authBridge.syncGoogleLinkFromAuthUser(session.username);
    if (!synced.synced) {
      return res.status(400).json({
        error:
          synced.reason === "no_google_identity"
            ? "No Google account is connected yet. Use Continue with Google."
            : "Could not sync Google link. Sign in with password and try again.",
        code: synced.reason || "sync_failed",
      });
    }
    const promo = await promoteSessionIfReady(session);
    res.json({
      ok: true,
      alreadyLinked: true,
      googleEmail: synced.googleEmail,
      sessionKind: getSession(session.id)?.sessionKind || session.sessionKind,
      needsMfaEnroll: promo.needs.needsMfaEnroll,
      needsGoogleLink: promo.needs.needsGoogleLink,
      needsSetup: promo.needs.needsSetup,
    });
  } catch (e) {
    const mapped = authBridge.mapAuthError(e);
    authDebugError("google.sync-link", e);
    res.status(400).json({ error: mapped.message, code: mapped.code, retryable: mapped.retryable });
  }
});

router.post("/google/complete-link", async (req, res) => {
  if (!requireBridge(res)) return;
  if (blockIfImpersonating(req, res)) return;
  try {
    const session = req.appSession;
    const rowPre = await authBridge.fetchAppUserAuthRow(session.username);
    // Either-or policy: Google link is allowed without MFA when user chose Google as their setup path.
    const code = String(req.body?.code || "").trim();
    if (!code) {
      // No code — try Auth identity sync (browser returned "already linked").
      const synced = await authBridge.syncGoogleLinkFromAuthUser(session.username);
      if (synced.synced) {
        const promo = await promoteSessionIfReady(session);
        return res.json({
          ok: true,
          alreadyLinked: true,
          googleEmail: synced.googleEmail,
          sessionKind: getSession(session.id)?.sessionKind || session.sessionKind,
          needsMfaEnroll: promo.needs.needsMfaEnroll,
          needsGoogleLink: promo.needs.needsGoogleLink,
          needsSetup: promo.needs.needsSetup,
        });
      }
      return res.status(400).json({ error: "Missing OAuth code", code: "oauth_code_missing" });
    }

    let exchanged;
    try {
      exchanged = await authBridge.exchangeOAuthCode(code);
    } catch (exErr) {
      const mapped = authBridge.mapAuthError(exErr);
      if (mapped.code === "identity_already_linked") {
        const synced = await authBridge.syncGoogleLinkFromAuthUser(session.username);
        if (synced.synced) {
          const promo = await promoteSessionIfReady(session);
          return res.json({
            ok: true,
            alreadyLinked: true,
            googleEmail: synced.googleEmail,
            needsMfaEnroll: promo.needs.needsMfaEnroll,
            needsGoogleLink: promo.needs.needsGoogleLink,
            needsSetup: promo.needs.needsSetup,
          });
        }
      }
      throw exErr;
    }
    const googleEmail =
      exchanged.user?.email ||
      exchanged.user?.user_metadata?.email ||
      exchanged.session?.user?.email;
    const authUserId = exchanged.user?.id || exchanged.session?.user?.id || null;
    const identities = exchanged.user?.identities || exchanged.session?.user?.identities || [];
    const fromIdentity = authBridge.googleEmailFromIdentities(identities);

    // Prefer Hangup user's auth_user_id when exchange returns a different Auth user.
    const hangupRow = await authBridge.fetchAppUserAuthRow(session.username);
    const hangupAuthId = hangupRow?.auth_user_id || null;
    let emailToApply = fromIdentity || googleEmail;
    if (hangupAuthId && authUserId && hangupAuthId !== authUserId) {
      // OAuth session is a different Auth user — read Google off the Hangup Auth user instead.
      const synced = await authBridge.syncGoogleLinkFromAuthUser(session.username);
      if (synced.synced) {
        emailToApply = synced.googleEmail;
      }
    }

    await authBridge.applyGoogleLink(session.username, emailToApply, hangupAuthId || authUserId);
    updateSession(session.id, {
      googleLinkPending: false,
      supabaseAccessToken: exchanged.session?.access_token || session.supabaseAccessToken,
      supabaseRefreshToken: exchanged.session?.refresh_token || session.supabaseRefreshToken,
      authUserId: hangupAuthId || authUserId || session.authUserId,
    });
    const promo = await promoteSessionIfReady(session);
    const row = await authBridge.fetchAppUserAuthRow(session.username);
    res.json({
      ok: true,
      googleEmail: row?.google_email || null,
      sessionKind: getSession(session.id)?.sessionKind || session.sessionKind,
      needsMfaEnroll: promo.needs.needsMfaEnroll,
      needsGoogleLink: promo.needs.needsGoogleLink,
      needsSetup: promo.needs.needsSetup,
    });
  } catch (e) {
    const mapped = authBridge.mapAuthError(e);
    if (mapped.code === "identity_already_linked") {
      try {
        const synced = await authBridge.syncGoogleLinkFromAuthUser(req.appSession.username);
        if (synced.synced) {
          const promo = await promoteSessionIfReady(req.appSession);
          return res.json({
            ok: true,
            alreadyLinked: true,
            googleEmail: synced.googleEmail,
            needsMfaEnroll: promo.needs.needsMfaEnroll,
            needsGoogleLink: promo.needs.needsGoogleLink,
            needsSetup: promo.needs.needsSetup,
          });
        }
      } catch (syncErr) {
        authDebugError("google.complete-link.recover", syncErr);
      }
    }
    authDebugError("google.complete-link", e);
    res.status(400).json({ error: mapped.message, code: mapped.code, retryable: mapped.retryable });
  }
});

router.post("/google/unlink", async (req, res) => {
  if (!requireBridge(res)) return;
  if (blockIfImpersonating(req, res)) return;
  try {
    const session = req.appSession;
    const totpCode = String(req.body?.totpCode || "").trim();
    const password = req.body?.password;
    const row = await authBridge.fetchAppUserAuthRow(session.username);
    if (!row?.google_email) {
      return res.status(400).json({ error: "Google is not linked", code: "not_linked" });
    }
    if (!totpCode) {
      return res.status(400).json({
        error: "Authenticator code required to unlink Google",
        code: "totp_required",
      });
    }
    let token = session.supabaseAccessToken;
    if (!token && password) {
      await authBridge.syncPasswordToAuth(session.username, password, row);
      token = await ensureAuthSessionTokens(session, password);
    }
    if (!token) {
      return res.status(400).json({ error: "Re-enter password to unlink Google", code: "password_required" });
    }
    await authBridge.verifyTotpForUser(token, totpCode);
    await authBridge.unlinkGoogle(session.username);
    updateSession(session.id, { sessionKind: "pending_setup" });
    try {
      await hrms.upsertAppSession({ ...getSession(session.id), sessionKind: "pending_setup" });
    } catch {
      /* ignore */
    }
    res.json({ ok: true, needsGoogleLink: true, sessionKind: "pending_setup" });
  } catch (e) {
    const mapped = authBridge.mapAuthError(e);
    authDebugError("google.unlink", e);
    res.status(400).json({ error: mapped.message, code: mapped.code, retryable: mapped.retryable });
  }
});

router.post("/setup/complete", async (req, res) => {
  try {
    const promo = await promoteSessionIfReady(req.appSession);
    if (!promo.promoted) {
      return res.status(400).json({
        error: "Finish Authenticator setup and Google link first",
        needsMfaEnroll: promo.needs.needsMfaEnroll,
        needsGoogleLink: promo.needs.needsGoogleLink,
        needsSetup: true,
      });
    }
    res.json({ ok: true, sessionKind: "full" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/mfa/admin-reset/:username", async (req, res) => {
  if (!roles.canManageAppUsers(req.realUsername || req.username)) {
    return res.status(403).json({ error: "Admin only" });
  }
  if (!requireBridge(res)) return;
  try {
    const target = String(req.params.username || "").trim();
    const result = await authBridge.adminResetMfa(target);
    demoteSessionsForUser(target);
    res.json({ ok: true, ...result, message: "MFA cleared. User must re-enroll on next login." });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/admin/reset-password/:username", async (req, res) => {
  if (!roles.canManageAppUsers(req.realUsername || req.username)) {
    return res.status(403).json({ error: "Admin only" });
  }
  try {
    const target = String(req.params.username || "").trim();
    const password = String(req.body?.password || "");
    const clearMfa = req.body?.clearMfa !== false;
    const unlinkGoogle = req.body?.unlinkGoogle !== false;
    const result = await authBridge.adminResetPassword(target, password, {
      clearMfa: authBridge.isAuthBridgeEnabled() ? clearMfa : false,
      unlinkGoogle: authBridge.isAuthBridgeEnabled() ? unlinkGoogle : false,
      actor: req.realUsername || req.username,
    });
    if (result.clearedMfa || result.unlinkedGoogle) demoteSessionsForUser(target);
    res.json({
      ok: true,
      ...result,
      message:
        "Password reset. User should sign in with the new password" +
        (result.clearedMfa || result.unlinkedGoogle
          ? " and complete Authenticator + Google setup again."
          : "."),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/admin/unlink-google/:username", async (req, res) => {
  if (!roles.canManageAppUsers(req.realUsername || req.username)) {
    return res.status(403).json({ error: "Admin only" });
  }
  if (!requireBridge(res)) return;
  try {
    const target = String(req.params.username || "").trim();
    await authBridge.unlinkGoogle(target);
    demoteSessionsForUser(target);
    res.json({ ok: true, message: "Google unlinked. User must link again on next login." });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/admin/force-resetup/:username", async (req, res) => {
  if (!roles.canManageAppUsers(req.realUsername || req.username)) {
    return res.status(403).json({ error: "Admin only" });
  }
  if (!requireBridge(res)) return;
  try {
    const target = String(req.params.username || "").trim();
    const result = await authBridge.adminForceResetup(target, {
      actor: req.realUsername || req.username,
    });
    demoteSessionsForUser(target);
    res.json({
      ok: true,
      ...result,
      message: "MFA + Google cleared. User must complete setup again after password login.",
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/sessions", async (req, res) => {
  if (!roles.canManageSessions(req.username)) {
    return res.status(403).json({ error: "System administrator only" });
  }
  try {
    const sessions = await hrms.listAppSessions();
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/sessions/:id/revoke", async (req, res) => {
  if (!roles.canManageSessions(req.username)) {
    return res.status(403).json({ error: "System administrator only" });
  }
  try {
    await hrms.revokeAppSession(req.params.id);
    destroySession(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
