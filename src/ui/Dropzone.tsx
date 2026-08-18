import { useCallback, useRef, useState } from "react";
import { clsx } from "clsx";
import { Upload } from "lucide-react";
import { Button } from "./Button";
import { uploadWithProgress, type UploadProgress } from "@/lib/uploadWithProgress";
import styles from "./Dropzone.module.css";

export function Dropzone({
  accept,
  disabled,
  label = "Drop a file or click to browse",
  hint,
  maxBytes = 35 * 1024 * 1024,
  onFile,
  uploadUrl,
  extraFields,
  onUploaded,
}: {
  accept?: string;
  disabled?: boolean;
  label?: string;
  hint?: string;
  maxBytes?: number;
  onFile?: (file: File) => void;
  uploadUrl?: string;
  extraFields?: Record<string, string>;
  onUploaded?: (data: unknown) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const startUpload = useCallback(
    async (f: File) => {
      if (!uploadUrl) {
        onFile?.(f);
        return;
      }
      setBusy(true);
      setError("");
      setProgress({ loaded: 0, total: f.size, pct: 0, speedBps: 0, etaSec: 0 });
      try {
        const data = await uploadWithProgress({
          url: `/api${uploadUrl}`,
          file: f,
          fields: extraFields,
          onProgress: setProgress,
        });
        onUploaded?.(data);
        setFile(null);
        setProgress(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setBusy(false);
      }
    },
    [extraFields, onFile, onUploaded, uploadUrl]
  );

  const take = useCallback(
    (f: File | undefined) => {
      if (!f || disabled || busy) return;
      if (f.size > maxBytes) {
        setError(`File is over ${Math.round(maxBytes / (1024 * 1024))} MB`);
        return;
      }
      if (accept) {
        const ok = accept.split(",").some((part) => {
          const p = part.trim();
          if (p.startsWith(".")) return f.name.toLowerCase().endsWith(p.toLowerCase());
          if (p.endsWith("/*")) return f.type.startsWith(p.slice(0, -1));
          return f.type === p || f.name.toLowerCase().endsWith(p.replace(".", "").toLowerCase());
        });
        if (!ok && accept) {
          setError("This file type is not allowed");
          return;
        }
      }
      setError("");
      setFile(f);
      void startUpload(f);
    },
    [accept, busy, disabled, maxBytes, startUpload]
  );

  const etaCopy =
    progress && progress.etaSec > 30 ? "Wait or walk away" : progress ? `${Math.ceil(progress.etaSec)}s left` : "";

  return (
    <div>
      <div
        className={clsx(styles.zone, over && styles.over, error && styles.err, disabled && styles.disabled)}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files?.[0]);
        }}
        onClick={() => {
          if (!disabled && !busy) inputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <Upload size={18} />
        <span>{label}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          disabled={disabled || busy}
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {progress && (
        <div className={styles.progress}>
          <div className={styles.bar} style={{ width: `${progress.pct}%` }} />
          <div className={styles.meta}>
            {progress.pct}% · {Math.round(progress.speedBps / 1024)} KB/s · {etaCopy}
          </div>
        </div>
      )}
      {error && (
        <div className={styles.errorRow}>
          <span>{error}</span>
          {file && (
            <Button size="sm" variant="secondary" onClick={() => void startUpload(file)}>
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
