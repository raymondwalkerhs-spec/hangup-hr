import { useEffect, useState } from "react";
import { api, clearSessionId } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { Button } from "@/ui/Button";
import { UpdateNoticeDialog } from "./UpdateNoticeDialog";
import {
  type GitHubUpdateInfo,
  type VersionCheck,
  applyDesktopUpdate,
  dismissNotice,
  fetchGitHubUpdateInfo,
  getHrDesktop,
  githubReleasePageUrl,
  isNoticeDismissed,
  updateActionHint,
} from "@/lib/desktopUpdate";
import styles from "./VersionUpdateGate.module.css";

type SessionCheck = {
  action?: string;
  message?: string;
  versionNotice?: VersionCheck;
  versionCheck?: VersionCheck;
};

export function VersionUpdateGate() {
  const { user, logout } = useAuth();
  const [blocked, setBlocked] = useState<SessionCheck | null>(null);
  const [notice, setNotice] = useState<VersionCheck | null>(null);
  const [githubInfo, setGithubInfo] = useState<GitHubUpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const session = await api<SessionCheck>("/session-check");
        if (cancelled) return;

        if (session.action === "session_revoked") {
          clearSessionId();
          window.location.href = "/login";
          return;
        }

        let gh: GitHubUpdateInfo | null = null;
        try {
          gh = await fetchGitHubUpdateInfo();
        } catch {
          /* non-fatal */
        }
        if (cancelled) return;
        setGithubInfo(gh);

        if (session.action === "version_blocked") {
          setBlocked(session);
          return;
        }

        const versionNotice = session.versionNotice || null;
        const latest = gh?.latest || versionNotice?.currentVersion;
        if (gh?.updateAvailable || versionNotice?.message) {
          if (!isNoticeDismissed(latest)) {
            setNotice(versionNotice);
            setOpen(true);
          }
        }
      } catch {
        /* non-fatal */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleBlockedUpdate = async () => {
    setUpdating(true);
    setStatus("Downloading update…");
    try {
      const result = await applyDesktopUpdate();
      if (result?.needsQuit) {
        setStatus("Installer started. The app will close…");
        return;
      }
      setStatus("Update ready. Restarting…");
    } catch (e) {
      setUpdating(false);
      setStatus((e as Error).message || "Update failed");
    }
  };

  if (blocked) {
    const details = blocked.versionCheck;
    const latest = githubInfo?.latest || details?.currentVersion;
    const canUpdate = Boolean(getHrDesktop()?.applyGitHubUpdate);
    return (
      <div className={styles.blocked}>
        <div className={styles.blockedCard}>
          <h2>App update required</h2>
          <p className={styles.warn}>{blocked.message || "This app version is no longer supported."}</p>
          {details && (
            <p className="muted">
              Your version: <strong>{details.appVersion || "unknown"}</strong>
              <br />
              Required version: <strong>{latest || details.currentVersion || "unknown"}</strong>
            </p>
          )}
          <p className="muted">
            {canUpdate
              ? `Use Update now to install the latest version. ${updateActionHint(githubInfo)}`
              : "Download the latest installer, then install it over this copy."}
          </p>
          {status && <p className={styles.status}>{status}</p>}
          <div className={styles.blockedActions}>
            {canUpdate ? (
              <Button onClick={handleBlockedUpdate} disabled={updating}>
                {updating ? "Updating…" : "Update now"}
              </Button>
            ) : (
              <a
                className={styles.downloadLink}
                href={githubReleasePageUrl(githubInfo)}
                target="_blank"
                rel="noreferrer"
              >
                Download latest installer
              </a>
            )}
            <button type="button" className={styles.linkBtn} onClick={() => logout()}>
              Return to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <UpdateNoticeDialog
      open={open}
      onOpenChange={setOpen}
      notice={notice}
      githubInfo={githubInfo}
      onContinue={() => dismissNotice(githubInfo?.latest || notice?.currentVersion)}
    />
  );
}
