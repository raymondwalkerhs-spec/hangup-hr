/**
 * Auth bridge — dual-run bcrypt ↔ Supabase Auth + MFA/Google helpers.
 *
 * AUTH_BACKEND (optional local override):
 *   legacy | off | false | 0 | disabled → bcrypt-only (emergency rollback)
 *   dual | supabase | on | true | 1 → Auth sync, MFA enroll gate, Google link
 *   unset → use app_config.authBackend when synced, else **dual** (fleet default)
 *
 * Product rules:
 *   - Daily login NEVER challenges Authenticator OTP (password or Google only)
 *   - TOTP for: MFA enroll, change-password, forgot-password reset, unlink Google
 *   - Forgot password = username + Authenticator OTP + new password (no email)
 *   - Registration email is claimed only; confirmed Gmail via OAuth/linkIdentity
 *   - Cold Google login only when google_email already linked; never auto-create
 */
const crypto = require("crypto");
const {
  getSupabaseAdmin,
  getSupabaseAnon,
  getSupabaseForUser,
  getSupabasePublicConfig,
} = require("./supabase-client");
const { authDebug, authDebugError } = require("./auth-debug");

const SYNTHETIC_DOMAIN = "users.hangup.local";
const DEFAULT_OIDC_HOST = "ugntjwqimgosuiodsnnk.supabase.co";
const PROTOCOL_SCHEME = "hangup-portal";
/** Custom protocol — opens Hangup Portal directly (no localhost shown to users). */
const OAUTH_REDIRECT = `${PROTOCOL_SCHEME}://auth/callback`;

function normalizeAuthBackendMode(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return null;
  if (v === "legacy" || v === "off" || v === "false" || v === "0" || v === "disabled") {
    return "legacy";
  }
  if (v === "dual" || v === "supabase" || v === "on" || v === "true" || v === "1") {
    return v === "supabase" ? "supabase" : "dual";
  }
  return null;
}

function readRemoteAuthBackendMode() {
  try {
    const cache = require("./cache");
    if (typeof cache.getConfigRaw !== "function") return null;
    const cfg = cache.getConfigRaw();
    return normalizeAuthBackendMode(cfg?.authBackend);
  } catch {
    return null;
  }
}

function getAuthBackendMode() {
  // Explicit .env wins (ops rollback). Otherwise remote app_config, else dual.
  const fromEnv = Object.prototype.hasOwnProperty.call(process.env, "AUTH_BACKEND")
    ? normalizeAuthBackendMode(process.env.AUTH_BACKEND)
    : null;
  if (fromEnv) return fromEnv;
  const fromRemote = readRemoteAuthBackendMode();
  if (fromRemote) return fromRemote;
  return "dual";
}

function isAuthBridgeEnabled() {
  return getAuthBackendMode() !== "legacy";
}

function syntheticEmailForUsername(username) {
  const base = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  const safe = base || `user-${crypto.randomBytes(4).toString("hex")}`;
  return `${safe}@${SYNTHETIC_DOMAIN}`;
}

function normalizeEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return e || null;
}

function oauthRedirectUri() {
  return (
    process.env.AUTH_GOOGLE_REDIRECT_URI ||
    process.env.AUTH_OAUTH_REDIRECT_URI ||
    OAUTH_REDIRECT
  );
}

function expectedSupabaseHost() {
  try {
    const cfg = getSupabasePublicConfig();
    return new URL(cfg.url || `https://${DEFAULT_OIDC_HOST}`).host;
  } catch {
    return DEFAULT_OIDC_HOST;
  }
}

async function fetchAppUserAuthRow(username) {
  const name = String(username || "").trim();
  if (!name) return null;
  const admin = getSupabaseAdmin();
  let { data, error } = await admin
    .from("app_users")
    .select(
      "id, username, email, email_claimed, google_email, google_linked_at, auth_user_id, synthetic_email, mfa_required, mfa_enrolled_at, auth_password_synced_at, password_changed_at, employee_id, status, role"
    )
    .ilike("username", name)
    .maybeSingle();
  if (
    error &&
    /email_claimed|google_email|auth_user_id|mfa_required|synthetic_email|auth_password_synced/i.test(
      error.message
    )
  ) {
    authDebug("fetchAppUserAuthRow.fallback_legacy_columns", { error: error.message });
    ({ data, error } = await admin
      .from("app_users")
      .select("id, username, email, employee_id, status, role, password_changed_at")
      .ilike("username", name)
      .maybeSingle());
  }
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    ...data,
    mfa_required: data.mfa_required !== false,
    email_claimed: data.email_claimed || null,
    google_email: data.google_email || null,
    google_linked_at: data.google_linked_at || null,
    auth_user_id: data.auth_user_id || null,
    synthetic_email: data.synthetic_email || null,
    mfa_enrolled_at: data.mfa_enrolled_at || null,
    auth_password_synced_at: data.auth_password_synced_at || null,
  };
}

function setupNeeds(appUser) {
  if (!isAuthBridgeEnabled() || !appUser) {
    return {
      needsMfaEnroll: false,
      needsGoogleLink: false,
      needsSetup: false,
      hasMfa: false,
      hasGoogle: false,
    };
  }
  const hasMfa = Boolean(appUser.mfa_enrolled_at);
  const hasGoogle = Boolean(appUser.google_linked_at && normalizeEmail(appUser.google_email));
  // Either Authenticator OR linked Google completes mandatory setup (not both).
  const needsSetup = !hasMfa && !hasGoogle;
  return {
    hasMfa,
    hasGoogle,
    needsMfaEnroll: needsSetup,
    needsGoogleLink: needsSetup,
    needsSetup,
  };
}

async function patchAppUserAuth(username, patch) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("app_users")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .ilike("username", String(username).trim())
    .select(
      "id, username, email, email_claimed, google_email, google_linked_at, auth_user_id, synthetic_email, mfa_required, mfa_enrolled_at, auth_password_synced_at, employee_id"
    )
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Ensure Supabase Auth user exists and password matches bcrypt login password.
 * Soft-fail when Auth APIs unavailable — bcrypt login still succeeds.
 */
async function syncPasswordToAuth(username, plaintextPassword, appUserRow = null) {
  if (!isAuthBridgeEnabled()) {
    return { synced: false, skipped: true, reason: "legacy" };
  }
  if (!plaintextPassword) {
    return { synced: false, skipped: true, reason: "no_password" };
  }
  try {
    const admin = getSupabaseAdmin();
    let row = appUserRow || (await fetchAppUserAuthRow(username));
    if (!row) return { synced: false, skipped: true, reason: "no_app_user" };

    const synthetic = row.synthetic_email || syntheticEmailForUsername(row.username || username);
    let authUserId = row.auth_user_id || null;

    if (!authUserId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: synthetic,
        password: String(plaintextPassword),
        email_confirm: true,
        user_metadata: {
          hangup_username: row.username || username,
          hangup_app_user_id: row.id,
        },
      });
      if (createErr) {
        const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const found = (listed.data?.users || []).find(
          (u) => String(u.email || "").toLowerCase() === synthetic.toLowerCase()
        );
        if (!found) throw createErr;
        authUserId = found.id;
        await admin.auth.admin.updateUserById(authUserId, { password: String(plaintextPassword) });
      } else {
        authUserId = created.user.id;
      }
      row = await patchAppUserAuth(row.username || username, {
        auth_user_id: authUserId,
        synthetic_email: synthetic,
        auth_password_synced_at: new Date().toISOString(),
      });
    } else {
      const { error: updErr } = await admin.auth.admin.updateUserById(authUserId, {
        password: String(plaintextPassword),
        email: synthetic,
      });
      if (updErr) throw updErr;
      row = await patchAppUserAuth(row.username || username, {
        synthetic_email: synthetic,
        auth_password_synced_at: new Date().toISOString(),
      });
    }

    authDebug("syncPasswordToAuth.ok", { username: row.username, authUserId });
    return { synced: true, authUserId, syntheticEmail: synthetic, appUser: row };
  } catch (err) {
    authDebugError("syncPasswordToAuth", err, { username });
    return { synced: false, error: err.message || String(err) };
  }
}

async function signInAuthWithPassword(syntheticEmail, password) {
  const anon = getSupabaseAnon();
  const { data, error } = await anon.auth.signInWithPassword({
    email: syntheticEmail,
    password: String(password),
  });
  if (error) throw new Error(error.message);
  return data;
}

async function enrollMfaStart(accessToken, opts = {}) {
  const client = getSupabaseForUser(accessToken);
  // Drop unfinished enrollments so "Add another" / retry aren't blocked.
  try {
    const listed = await client.auth.mfa.listFactors();
    const all = [
      ...(listed.data?.all || []),
      ...(listed.data?.totp || []),
    ];
    const seen = new Set();
    for (const f of all) {
      if (!f?.id || seen.has(f.id)) continue;
      seen.add(f.id);
      if (String(f.status || "").toLowerCase() !== "unverified") continue;
      try {
        await client.auth.mfa.unenroll({ factorId: f.id });
      } catch (err) {
        authDebugError("enrollMfaStart.unenrollUnverified", err, { factorId: f.id });
      }
    }
  } catch (err) {
    authDebugError("enrollMfaStart.listFactors", err);
  }

  const label = String(opts.friendlyName || "").trim() || "Hangup Portal";
  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: label.slice(0, 64),
    issuer: "Hangup Portal",
  });
  if (error) throw new Error(error.message);
  return {
    factorId: data.id,
    qrCode: data.totp?.qr_code || null,
    secret: data.totp?.secret || null,
    uri: data.totp?.uri || null,
    friendlyName: label,
  };
}

async function enrollMfaVerify(accessToken, factorId, code) {
  const client = getSupabaseForUser(accessToken);
  const challenge = await client.auth.mfa.challenge({ factorId });
  if (challenge.error) throw new Error(challenge.error.message);
  const verified = await client.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: String(code || "").trim(),
  });
  if (verified.error) throw new Error(verified.error.message);
  return verified.data;
}

/** Challenge + verify an enrolled TOTP factor for the signed-in Auth user. */
async function verifyTotpForUser(accessToken, code) {
  const client = getSupabaseForUser(accessToken);
  const factors = await client.auth.mfa.listFactors();
  if (factors.error) throw new Error(factors.error.message);
  const totp =
    (factors.data?.totp || []).find((f) => f.status === "verified") ||
    (factors.data?.all || []).find((f) => f.factor_type === "totp" && f.status === "verified") ||
    (factors.data?.totp || [])[0];
  if (!totp?.id) throw new Error("No Authenticator enrolled. Complete setup first.");
  const challenge = await client.auth.mfa.challenge({ factorId: totp.id });
  if (challenge.error) throw new Error(challenge.error.message);
  const verified = await client.auth.mfa.verify({
    factorId: totp.id,
    challengeId: challenge.data.id,
    code: String(code || "").trim(),
  });
  if (verified.error) throw new Error(verified.error.message || "Invalid authenticator code");
  return verified.data;
}

/**
 * Server-side Auth session without the user's password (no outbound email).
 * Uses admin generateLink + verifyOtp so MFA can be challenged for forgot-password.
 */
async function createAuthSessionWithoutPassword(syntheticEmail) {
  const admin = getSupabaseAdmin();
  const email = String(syntheticEmail || "").trim().toLowerCase();
  if (!email) throw new Error("Missing Auth identity");

  let linkData = null;
  let linkError = null;
  let linkType = "magiclink";
  for (const type of ["magiclink", "recovery"]) {
    const result = await admin.auth.admin.generateLink({ type, email });
    if (!result.error && result.data) {
      linkData = result.data;
      linkType = type;
      linkError = null;
      break;
    }
    linkError = result.error;
  }
  if (!linkData) {
    throw new Error(linkError?.message || "Could not start password reset");
  }

  const tokenHash = linkData.properties?.hashed_token || linkData.hashed_token || null;
  if (!tokenHash) throw new Error("Could not start password reset");

  const verifyType = linkType === "recovery" ? "recovery" : "email";
  const anon = getSupabaseAnon();
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: verifyType,
  });
  if (error) throw new Error(error.message || "Could not start password reset");
  if (!data?.session?.access_token) throw new Error("Could not start password reset");
  return data;
}

/**
 * Step 1 — verify username + Authenticator OTP.
 * Returns a short-lived resetToken (2 minutes) for step 2 (set new password).
 */
async function beginPasswordResetWithTotp(username, totpCode) {
  const code = String(totpCode || "").trim();
  if (code.length < 6) throw new Error("Authenticator code required");

  const row = await fetchAppUserAuthRow(username);
  if (!row) {
    const err = new Error("Invalid username or authenticator code");
    err.code = "invalid_reset";
    throw err;
  }
  const status = String(row.status || "active").toLowerCase();
  if (status === "inactive" || status === "terminated") {
    const err = new Error("This account cannot reset a password");
    err.code = "account_blocked";
    throw err;
  }
  if (!row.mfa_enrolled_at || !row.auth_user_id) {
    const err = new Error(
      "Authenticator is required to reset your password. Contact HR if you have not set it up yet."
    );
    err.code = "mfa_required";
    throw err;
  }

  const synthetic = row.synthetic_email || syntheticEmailForUsername(row.username);
  const authSession = await createAuthSessionWithoutPassword(synthetic);
  const accessToken = authSession.session.access_token;
  const refreshToken = authSession.session.refresh_token || null;

  try {
    await verifyTotpForUser(accessToken, code);
  } catch (err) {
    try {
      const client = getSupabaseForUser(accessToken);
      await client.auth.signOut();
    } catch {
      /* ignore */
    }
    const mapped = mapAuthError(err);
    const e = new Error(mapped.message || "Invalid authenticator code");
    e.code = mapped.code || "invalid_totp";
    throw e;
  }

  try {
    const client = getSupabaseForUser(accessToken);
    if (refreshToken) {
      await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    }
    await client.auth.signOut();
  } catch {
    /* ignore */
  }

  const pendingStore = require("./password-reset-pending-store");
  const ticket = pendingStore.createResetToken(row.username);
  return {
    ok: true,
    username: row.username,
    resetToken: ticket.resetToken,
    expiresAt: ticket.expiresAt,
    expiresInSec: ticket.expiresInSec,
  };
}

/**
 * Step 2 — set new password using a resetToken from beginPasswordResetWithTotp.
 * Token expires after 2 minutes; then a new OTP is required.
 */
async function completePasswordResetWithToken(resetToken, newPassword) {
  const pwd = String(newPassword || "");
  if (pwd.length < 8) throw new Error("Password must be at least 8 characters");

  const pendingStore = require("./password-reset-pending-store");
  const ticket = pendingStore.consumeResetToken(resetToken);
  if (!ticket) {
    const err = new Error("Authenticator session expired. Enter a new Authenticator code.");
    err.code = "reset_expired";
    throw err;
  }

  const row = await fetchAppUserAuthRow(ticket.username);
  if (!row) {
    const err = new Error("Invalid username or authenticator code");
    err.code = "invalid_reset";
    throw err;
  }
  const status = String(row.status || "active").toLowerCase();
  if (status === "inactive" || status === "terminated") {
    const err = new Error("This account cannot reset a password");
    err.code = "account_blocked";
    throw err;
  }

  const usersAdmin = require("./users-admin");
  await usersAdmin.updateAppUser(row.username, { password: pwd }, "forgot-password-totp");

  const sync = await syncPasswordToAuth(row.username, pwd);
  if (!sync.synced && !sync.skipped) {
    authDebugError("completePasswordResetWithToken.syncPasswordToAuth", new Error(sync.error || "sync failed"), {
      username: row.username,
    });
  }

  return { ok: true, username: row.username };
}

/** One-shot helper (tests / legacy): OTP + new password in a single call. */
async function resetPasswordWithTotp(username, totpCode, newPassword) {
  const begun = await beginPasswordResetWithTotp(username, totpCode);
  return completePasswordResetWithToken(begun.resetToken, newPassword);
}

async function listMfaFactorsForToken(accessToken) {
  const client = getSupabaseForUser(accessToken);
  const listed = await client.auth.mfa.listFactors();
  if (listed.error) throw new Error(listed.error.message);
  const totp = listed.data?.totp || [];
  const all = listed.data?.all || totp;
  return (all.length ? all : totp).map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name || f.friendlyName || "Authenticator",
    status: f.status || "verified",
    factorType: f.factor_type || f.factorType || "totp",
    createdAt: f.created_at || null,
  }));
}

async function listMfaFactorsForUsername(username) {
  const row = await fetchAppUserAuthRow(username);
  if (!row?.auth_user_id) return [];
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: row.auth_user_id });
  if (error) throw new Error(error.message);
  const list = data?.all || data?.factors || data?.totp || [];
  return list.map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name || f.friendlyName || "Authenticator",
    status: f.status || "verified",
    factorType: f.factor_type || f.factorType || "totp",
    createdAt: f.created_at || null,
  }));
}

async function deleteMfaFactor(username, factorId) {
  const row = await fetchAppUserAuthRow(username);
  if (!row?.auth_user_id) throw new Error("User has no Auth account");
  const id = String(factorId || "").trim();
  if (!id) throw new Error("Factor id required");
  const admin = getSupabaseAdmin();
  const { error } = await admin.auth.admin.mfa.deleteFactor({ id, userId: row.auth_user_id });
  if (error) throw new Error(error.message);
  const remaining = await listMfaFactorsForUsername(username);
  const verifiedLeft = remaining.filter((f) => String(f.status).toLowerCase() === "verified");
  if (!verifiedLeft.length) {
    await patchAppUserAuth(username, { mfa_enrolled_at: null });
  }
  return { ok: true, remaining: verifiedLeft.length, factors: remaining };
}

async function adminResetMfa(username) {
  const row = await fetchAppUserAuthRow(username);
  if (!row) throw new Error("User not found");
  if (row.auth_user_id) {
    const admin = getSupabaseAdmin();
    const { data: factors, error } = await admin.auth.admin.mfa.listFactors({ userId: row.auth_user_id });
    if (error) throw new Error(error.message || "Could not list authenticators");
    const list = factors?.all || factors?.factors || factors?.totp || [];
    const errors = [];
    for (const f of list) {
      const id = f?.id;
      if (!id) continue;
      const deleted = await admin.auth.admin.mfa.deleteFactor({ id, userId: row.auth_user_id });
      if (deleted.error) {
        errors.push(deleted.error.message || id);
        authDebugError("adminResetMfa.deleteFactor", deleted.error, { username, factorId: id });
      }
    }
    const remaining = await listMfaFactorsForUsername(username);
    const verifiedLeft = remaining.filter((f) => String(f.status).toLowerCase() === "verified");
    if (verifiedLeft.length) {
      throw new Error(
        errors[0] ||
          `Could not remove ${verifiedLeft.length} authenticator(s). Ask an admin to Reset MFA.`
      );
    }
  }
  await patchAppUserAuth(username, { mfa_enrolled_at: null });
  return { ok: true, username: row.username };
}

async function findAppUserByGoogleEmail(googleEmail) {
  const email = normalizeEmail(googleEmail);
  if (!email) return null;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("app_users")
    .select(
      "id, username, email, email_claimed, google_email, google_linked_at, auth_user_id, synthetic_email, mfa_required, mfa_enrolled_at, password_changed_at, employee_id, status, role"
    )
    .ilike("google_email", email)
    .maybeSingle();
  if (error) {
    if (/google_email/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return data;
}

async function getAuthUserIdentities(authUserId) {
  if (!authUserId) return [];
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.getUserById(authUserId);
  if (error) throw new Error(error.message);
  return data?.user?.identities || [];
}

function googleEmailFromIdentities(identities) {
  const list = Array.isArray(identities) ? identities : [];
  const googleIdent = list.find((i) => i?.provider === "google");
  if (!googleIdent) return null;
  return normalizeEmail(
    googleIdent.identity_data?.email ||
      googleIdent.identity_data?.email_address ||
      googleIdent.identity_data?.preferred_username ||
      null
  );
}

/**
 * If Auth already has a Google identity for this Hangup user, write google_email
 * on app_users (recover from partial link / "Identity is already linked").
 */
async function syncGoogleLinkFromAuthUser(username) {
  const row = await fetchAppUserAuthRow(username);
  if (!row?.auth_user_id) {
    return { synced: false, reason: "no_auth_user" };
  }
  const identities = await getAuthUserIdentities(row.auth_user_id);
  const email = googleEmailFromIdentities(identities);
  if (!email) {
    return { synced: false, reason: "no_google_identity", identities };
  }
  const linked = await applyGoogleLink(row.username || username, email, row.auth_user_id);
  return {
    synced: true,
    googleEmail: linked?.google_email || email,
    appUser: linked,
  };
}

async function applyGoogleLink(username, googleEmail, authUserId = null) {
  const email = normalizeEmail(googleEmail);
  if (!email) throw new Error("Google account did not return an email");
  const existing = await findAppUserByGoogleEmail(email);
  const want = String(username || "").trim().toLowerCase();
  if (existing && String(existing.username || "").toLowerCase() !== want) {
    throw new Error("This Google account is already linked to another Hangup user");
  }
  const patch = {
    google_email: email,
    google_linked_at: new Date().toISOString(),
  };
  if (authUserId) patch.auth_user_id = authUserId;
  const row = await patchAppUserAuth(username, patch);

  try {
    const empId = row?.employee_id;
    if (empId) {
      const store = require("./data-store");
      await store.updateEmployee(empId, { email }, username);
    }
  } catch (err) {
    authDebugError("applyGoogleLink.employeeEmail", err, { username });
  }
  return row;
}

/**
 * Clear Hangup google_* fields AND remove Google identity from Supabase Auth.
 * Clearing only app_users left Auth linked → next linkIdentity failed with
 * "Identity is already linked" while the gate still demanded /link-google.
 */
async function unlinkGoogle(username) {
  const row = await fetchAppUserAuthRow(username);
  if (row?.auth_user_id) {
    const admin = getSupabaseAdmin();
    try {
      const identities = await getAuthUserIdentities(row.auth_user_id);
      for (const ident of identities) {
        if (ident?.provider !== "google" || !ident.id) continue;
        try {
          if (typeof admin.auth.admin.deleteUserIdentity === "function") {
            await admin.auth.admin.deleteUserIdentity({
              id: row.auth_user_id,
              identityId: ident.id,
            });
          } else if (typeof admin.auth.admin.unlinkIdentity === "function") {
            await admin.auth.admin.unlinkIdentity({
              userId: row.auth_user_id,
              identityId: ident.id,
            });
          } else {
            // Fallback: delete identity via GoTrue admin REST if helpers missing
            const cfg = getSupabasePublicConfig();
            const key = process.env.SUPABASE_SECRET_KEY;
            if (cfg?.url && key) {
              await fetch(`${cfg.url}/auth/v1/admin/users/${row.auth_user_id}/identities/${ident.id}`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${key}`,
                  apikey: key,
                },
              });
            }
          }
        } catch (err) {
          authDebugError("unlinkGoogle.deleteIdentity", err, { username, identityId: ident.id });
        }
      }
    } catch (err) {
      authDebugError("unlinkGoogle.listIdentities", err, { username });
    }
  }
  return patchAppUserAuth(username, {
    google_email: null,
    google_linked_at: null,
  });
}

/**
 * Admin recovery: set new password, optionally clear MFA + unlink Google (defaults: clear both).
 * Forces re-setup on next login when bridge is on.
 */
async function adminResetPassword(username, newPassword, opts = {}) {
  const clearMfa = opts.clearMfa !== false;
  const unlink = opts.unlinkGoogle !== false;
  const pwd = String(newPassword || "");
  if (pwd.length < 8) throw new Error("Password must be at least 8 characters");

  const usersAdmin = require("./users-admin");
  await usersAdmin.updateAppUser(username, { password: pwd }, opts.actor || "admin-reset");

  if (clearMfa) await adminResetMfa(username);
  if (unlink) await unlinkGoogle(username);

  // Sync into Supabase Auth so dual-run / Google link stay consistent
  try {
    await syncPasswordToAuth(username, pwd);
  } catch (err) {
    authDebugError("adminResetPassword.syncPasswordToAuth", err, { username });
  }

  return {
    ok: true,
    username: String(username || "").trim(),
    clearedMfa: clearMfa,
    unlinkedGoogle: unlink,
  };
}

async function adminForceResetup(username, opts = {}) {
  await adminResetMfa(username);
  await unlinkGoogle(username);
  return { ok: true, username: String(username || "").trim(), forcedResetup: true, actor: opts.actor || null };
}

async function getGoogleAuthUrlViaClient({ accessToken = null, redirectTo } = {}) {
  const redirect = redirectTo || oauthRedirectUri();
  const client = accessToken ? getSupabaseForUser(accessToken) : getSupabaseAnon();
  const options = {
    provider: "google",
    options: {
      redirectTo: redirect,
      skipBrowserRedirect: true,
      scopes: "email profile",
      queryParams: { access_type: "offline", prompt: "select_account" },
    },
  };
  let result;
  if (accessToken && typeof client.auth.linkIdentity === "function") {
    result = await client.auth.linkIdentity(options);
  } else {
    result = await client.auth.signInWithOAuth(options);
  }
  if (result.error) throw new Error(result.error.message);

  // Persist PKCE verifier for cold-complete (same process) even if storage is cleared.
  try {
    const { captureAnonCodeVerifier } = require("./supabase-client");
    const oauthStore = require("./oauth-pending-store");
    const captured = captureAnonCodeVerifier();
    if (captured) oauthStore.setOauthCodeVerifier(captured.key, captured.value);
  } catch (err) {
    authDebugError("getGoogleAuthUrlViaClient.captureVerifier", err);
  }

  return {
    url: result.data?.url || null,
    redirectTo: redirect,
    provider: "google",
  };
}

async function exchangeOAuthCode(code) {
  const { restoreAnonCodeVerifier, captureAnonCodeVerifier } = require("./supabase-client");
  const oauthStore = require("./oauth-pending-store");
  const saved = oauthStore.getOauthCodeVerifier();
  if (saved) restoreAnonCodeVerifier(saved);
  else {
    const live = captureAnonCodeVerifier();
    if (live) restoreAnonCodeVerifier(live);
  }

  const anon = getSupabaseAnon();
  const { data, error } = await anon.auth.exchangeCodeForSession(String(code || "").trim());
  if (error) throw new Error(error.message);
  return data;
}

function mapAuthError(err) {
  const msg = String(err?.message || err || "Authentication failed");
  const lower = msg.toLowerCase();
  if (lower.includes("already linked") || lower.includes("identity is already")) {
    return {
      code: "identity_already_linked",
      message:
        "This Google account is already connected in Auth. Hangup will sync it — try Continue again, or ask Admin to Unlink Google then retry.",
      retryable: true,
    };
  }
  if (lower.includes("manual linking") || lower.includes("manual_linking")) {
    return {
      code: "manual_linking_disabled",
      message:
        "Google linking is not enabled on Auth yet. Ops must turn on Manual linking in Supabase Authentication settings.",
      retryable: false,
    };
  }
  if (lower.includes("redirect_uri") || lower.includes("redirect")) {
    return {
      code: "redirect_uri_mismatch",
      message:
        "Google OAuth redirect is not allowlisted. Ops must allow hangup-portal://auth/callback in Supabase Auth URL config + Google Cloud.",
      retryable: false,
    };
  }
  if (lower.includes("not authorized") || lower.includes("no app user") || lower.includes("not linked")) {
    return {
      code: "google_not_linked",
      message:
        "This Google account is not linked to a Hangup user. Sign in with password and link Google first.",
      retryable: false,
    };
  }
  if (lower.includes("invalid") && (lower.includes("code") || lower.includes("totp") || lower.includes("mfa"))) {
    return { code: "invalid_totp", message: "Invalid authenticator code. Try again.", retryable: true };
  }
  if (lower.includes("timeout") || lower.includes("network") || lower.includes("fetch")) {
    return { code: "network", message: "Network error talking to Auth. Retry.", retryable: true };
  }
  return { code: "auth_error", message: msg, retryable: true };
}

function pendingSetupPathAllowlist(path) {
  const p = String(path || "");
  const allowed = [
    "/status",
    "/session-check",
    "/logout",
    "/auth/security-status",
    "/auth/mfa",
    "/auth/google",
    "/auth/setup",
    "/auth/change-password",
  ];
  return allowed.some((prefix) => p === prefix || p.startsWith(`${prefix}/`) || p.startsWith(prefix));
}

module.exports = {
  SYNTHETIC_DOMAIN,
  PROTOCOL_SCHEME,
  OAUTH_REDIRECT,
  getAuthBackendMode,
  isAuthBridgeEnabled,
  syntheticEmailForUsername,
  normalizeEmail,
  oauthRedirectUri,
  expectedSupabaseHost,
  fetchAppUserAuthRow,
  setupNeeds,
  patchAppUserAuth,
  syncPasswordToAuth,
  signInAuthWithPassword,
  enrollMfaStart,
  enrollMfaVerify,
  verifyTotpForUser,
  listMfaFactorsForToken,
  listMfaFactorsForUsername,
  deleteMfaFactor,
  createAuthSessionWithoutPassword,
  beginPasswordResetWithTotp,
  completePasswordResetWithToken,
  resetPasswordWithTotp,
  adminResetMfa,
  adminResetPassword,
  adminForceResetup,
  findAppUserByGoogleEmail,
  applyGoogleLink,
  syncGoogleLinkFromAuthUser,
  getAuthUserIdentities,
  googleEmailFromIdentities,
  unlinkGoogle,
  getGoogleAuthUrlViaClient,
  exchangeOAuthCode,
  mapAuthError,
  pendingSetupPathAllowlist,
};
