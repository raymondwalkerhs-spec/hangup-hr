const pkg = require("../package.json");

function getAppVersion() {
  return String(pkg.version || "0.0.0").trim();
}

function parseVersion(input) {
  const raw = String(input || "")
    .trim()
    .replace(/^v/i, "");
  if (!raw) return null;

  const [main, pre] = raw.split("-");
  const parts = main.split(".").map((part) => {
    const n = parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  while (parts.length < 3) parts.push(0);

  const preTokens = pre
    ? pre.split(/[.-]/).map((token) => {
        const n = parseInt(token, 10);
        return Number.isFinite(n) ? n : token.toLowerCase();
      })
    : null;

  return { parts, pre: preTokens };
}

function comparePreRelease(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNum = typeof left === "number";
    const rightNum = typeof right === "number";
    if (leftNum && rightNum) return left - right;
    if (leftNum) return -1;
    if (rightNum) return 1;
    return String(left).localeCompare(String(right));
  }
  return 0;
}

function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;

  for (let i = 0; i < 3; i++) {
    if (va.parts[i] !== vb.parts[i]) return va.parts[i] - vb.parts[i];
  }
  return comparePreRelease(va.pre, vb.pre);
}

function isVersionLessThan(appVersion, requiredVersion) {
  return compareVersions(appVersion, requiredVersion) < 0;
}

const FORCE_UPDATE_ROLES = new Set([
  "hr",
  "quality",
  "agent",
  "tl",
  "op",
  "rtm",
  "office_assistant",
]);

function normalizeRoleKey(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function isForceUpdateRole(role) {
  return FORCE_UPDATE_ROLES.has(normalizeRoleKey(role));
}

function evaluateVersionCompatibility(appVersion, policy, userRole = null) {
  const version = appVersion || getAppVersion();
  if (!policy?.currentVersion) {
    return { status: "ok", appVersion: version };
  }

  const currentVersion = policy.currentVersion;
  const minCompatibleVersion =
    policy.minCompatibleVersion || policy.currentVersion;
  const forceUpdateMinVersion = policy.forceUpdateMinVersion || null;
  const roleKey = normalizeRoleKey(userRole);

  if (isVersionLessThan(version, minCompatibleVersion)) {
    return {
      status: "blocked",
      appVersion: version,
      currentVersion,
      minCompatibleVersion,
      forceUpdateMinVersion,
      blockedForRole: roleKey || null,
      message:
        policy.blockedMessage ||
        `This app version (${version}) is no longer supported. Contact Admin for version ${currentVersion}.`,
    };
  }

  if (
    forceUpdateMinVersion &&
    isForceUpdateRole(roleKey) &&
    isVersionLessThan(version, forceUpdateMinVersion)
  ) {
    return {
      status: "blocked",
      appVersion: version,
      currentVersion,
      minCompatibleVersion,
      forceUpdateMinVersion,
      blockedForRole: roleKey,
      message:
        policy.fieldBlockedMessage ||
        `HR and field staff must update to version ${forceUpdateMinVersion} or newer (you have ${version}). Contact Admin for the latest EXE.`,
    };
  }

  if (isVersionLessThan(version, currentVersion)) {
    return {
      status: "update_recommended",
      appVersion: version,
      currentVersion,
      minCompatibleVersion,
      forceUpdateMinVersion,
      message:
        policy.updateMessage ||
        `A newer version (${currentVersion}) is available. Please ask Admin for the latest build.`,
    };
  }

  return {
    status: "ok",
    appVersion: version,
    currentVersion,
    minCompatibleVersion,
    forceUpdateMinVersion,
  };
}

module.exports = {
  getAppVersion,
  compareVersions,
  isVersionLessThan,
  evaluateVersionCompatibility,
  FORCE_UPDATE_ROLES,
  isForceUpdateRole,
};
