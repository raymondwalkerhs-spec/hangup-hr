import { useState } from "react";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import {
  type GitHubUpdateInfo,
  type VersionCheck,
  applyDesktopUpdate,
  formatUpdateSize,
  getHrDesktop,
  updateActionHint,
} from "@/lib/desktopUpdate";
import styles from "./UpdateNoticeDialog.module.css";

export function UpdateNoticeDialog({
  open,
  onOpenChange,
  notice,
  githubInfo,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notice?: VersionCheck | null;
  githubInfo?: GitHubUpdateInfo | null;
  onContinue?: () => void;
}) {
  const [status, setStatus] = useState("");
  const [updating, setUpdating] = useState(false);

  const latest = githubInfo?.latest || notice?.currentVersion;
  const current = notice?.appVersion || githubInfo?.current || "this version";
  const canUpdate = Boolean(
    githubInfo?.updateAvailable &&
    (githubInfo.assetUrl || githubInfo.assetId || githubInfo.assetName) &&
    getHrDesktop()?.applyGitHubUpdate
  );

  const message =
    (githubInfo?.updateAvailable
      ? `Version ${githubInfo.latest} is available on GitHub (you have ${githubInfo.current || current}).`
      : "") ||
    notice?.message ||
    "A newer app version is available.";

  const handleUpdate = async () => {
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

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Update available"
      footer={
        <>
          {canUpdate && (
            <Button onClick={handleUpdate} disabled={updating}>
              {updating ? "Updating…" : "Update now"}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              onContinue?.();
              onOpenChange(false);
            }}
          >
            Continue
          </Button>
        </>
      }
    >
      <div className={styles.warn}>{message}</div>
      <p className="muted">
        You are on <strong>{current}</strong>. The latest version is <strong>{latest || "unknown"}</strong>.
      </p>
      {canUpdate ? (
        <p className="muted">
          Click <strong>Update now</strong> to {updateActionHint(githubInfo)}
          {githubInfo?.assetSize ? ` Download size: ${formatUpdateSize(githubInfo.assetSize)}.` : ""}
        </p>
      ) : (
        <p className="muted">You can keep working for now. Install the latest build when convenient.</p>
      )}
      {status && <p className={styles.status}>{status}</p>}
    </Dialog>
  );
}
