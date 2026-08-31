export type GitHubUpdateInfo = {
  enabled?: boolean;
  current?: string;
  latest?: string | null;
  updateAvailable?: boolean;
  installKind?: string;
  updateDescription?: string;
  assetSize?: number;
  assetName?: string | null;
  assetUrl?: string | null;
  assetId?: number | null;
  releaseUrl?: string | null;
};

export const GITHUB_RELEASES_LATEST =
  "https://github.com/raymondwalkerhs-spec/hangup-hr/releases/latest";

export function canApplyDesktopUpdate(info?: GitHubUpdateInfo | null, opts?: { requireAvailable?: boolean }) {
  const desktop = Boolean(getHrDesktop()?.applyGitHubUpdate);
  if (!desktop) return false;
  if (opts?.requireAvailable === false) return true;
  return Boolean(info?.updateAvailable && (info.assetUrl || info.assetId || info.assetName));
}

export function githubReleasePageUrl(info?: GitHubUpdateInfo | null) {
  return info?.releaseUrl || GITHUB_RELEASES_LATEST;
}

export type VersionCheck = {
  status?: string;
  message?: string;
  appVersion?: string;
  currentVersion?: string;
};

export type VersionInfoResponse = {
  appVersion?: string;
  versionCheck?: VersionCheck | null;
  githubUpdate?: GitHubUpdateInfo | null;
  installHealth?: { ok?: boolean; message?: string };
};

export type HrDesktop = {
  checkGitHubUpdate?: () => Promise<GitHubUpdateInfo>;
  applyGitHubUpdate?: () => Promise<{ needsQuit?: boolean }>;
  relaunchApp?: () => Promise<void>;
  isDesktop?: boolean;
};

export function getHrDesktop(): HrDesktop | undefined {
  return (window as { hrDesktop?: HrDesktop }).hrDesktop;
}

export function versionNoticeDismissKey(latest?: string) {
  return `hr_version_notice_dismissed_${latest || "unknown"}`;
}

export function isNoticeDismissed(latest?: string) {
  try {
    return sessionStorage.getItem(versionNoticeDismissKey(latest)) === "1";
  } catch {
    return false;
  }
}

export function dismissNotice(latest?: string) {
  try {
    sessionStorage.setItem(versionNoticeDismissKey(latest), "1");
  } catch {
    /* ignore */
  }
}

export function formatUpdateSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `~${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
  return `~${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function updateActionHint(info?: GitHubUpdateInfo | null) {
  if (info?.updateDescription) return info.updateDescription;
  if (info?.installKind === "nsis") {
    return "Downloads the installer and upgrades silently. The app will close so the installer can finish.";
  }
  if (info?.installKind === "mac") {
    return "Downloads the full app and replaces it. The app will restart when finished.";
  }
  return "Downloads the full update package and applies it. The app will restart when finished.";
}

export async function fetchVersionInfo(): Promise<VersionInfoResponse> {
  const res = await fetch("/api/version-info");
  if (!res.ok) throw new Error("Could not load version info");
  return res.json();
}

export async function fetchGitHubUpdateInfo(): Promise<GitHubUpdateInfo | null> {
  const desktop = getHrDesktop();
  if (desktop?.checkGitHubUpdate) {
    try {
      const info = await desktop.checkGitHubUpdate();
      if (info?.enabled !== false) return info;
    } catch {
      /* fall through */
    }
  }
  try {
    const res = await fetch("/api/github-update");
    if (res.ok) return res.json();
  } catch {
    /* non-fatal */
  }
  return null;
}

export async function applyDesktopUpdate(): Promise<{ needsQuit?: boolean }> {
  const desktop = getHrDesktop();
  if (!desktop?.applyGitHubUpdate) {
    throw new Error("In-app updates are only available in the desktop app.");
  }
  const result = await desktop.applyGitHubUpdate();
  if (result?.needsQuit) return result;
  setTimeout(() => desktop.relaunchApp?.(), 800);
  return result;
}
