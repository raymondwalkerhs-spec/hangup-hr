import { useEffect, useState } from "react";
import { api, clearSessionId } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { UpdateNoticeDialog } from "./UpdateNoticeDialog";
import {
  type GitHubUpdateInfo,
  type VersionCheck,
  dismissNotice,
  fetchGitHubUpdateInfo,
  isNoticeDismissed,
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

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const session = await api<SessionCheck>("/session-check");
        if (cancelled) return;

        if (session.action === "version_blocked") {
          setBlocked(session);
          return;
        }
        if (session.action === "session_revoked") {
          clearSessionId();
          window.location.href = "/login";
          return;
        }

        const gh = await fetchGitHubUpdateInfo();
        if (cancelled) return;

        const versionNotice = session.versionNotice || null;
        const latest = gh?.latest || versionNotice?.currentVersion;
        if (gh?.updateAvailable || versionNotice?.message) {
          if (!isNoticeDismissed(latest)) {
            setNotice(versionNotice);
            setGithubInfo(gh);
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

  if (blocked) {
    const details = blocked.versionCheck;
    return (
      <div className={styles.blocked}>
        <div className={styles.blockedCard}>
          <h2>App update required</h2>
          <p className={styles.warn}>{blocked.message || "This app version is no longer supported."}</p>
          {details && (
            <p className="muted">
              Your version: <strong>{details.appVersion || "unknown"}</strong>
              <br />
              Required version: <strong>{details.currentVersion || "unknown"}</strong>
            </p>
          )}
          <div className={styles.blockedActions}>
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
