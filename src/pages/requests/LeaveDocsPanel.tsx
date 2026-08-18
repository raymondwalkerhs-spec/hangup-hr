import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { uploadWithProgress } from "@/lib/uploadWithProgress";
import { Dropzone } from "@/ui/Dropzone";
import { Button } from "@/ui/Button";
import { isMedicalLeaveKind } from "./leaveRequestHelpers";
import styles from "./RequestsPage.module.css";

type LeaveDoc = {
  id?: string;
  fileName?: string;
  notes?: string;
  uploadedBy?: string;
  createdAt?: string;
  driveFileId?: string;
};

export type PendingLeaveDoc = {
  file: File;
  notes: string;
};

function docTypeForKind(requestKind?: string) {
  return requestKind === "exam" ? "Exam Note" : "Medical Note";
}

function docLabelForKind(requestKind?: string) {
  return requestKind === "exam" ? "Exam schedule" : "Sick note / Medical certificate";
}

export async function uploadPendingLeaveDocs(
  leaveId: string,
  files: PendingLeaveDoc[],
  requestKind: string,
  path: (p: string) => string,
) {
  const docType = docTypeForKind(requestKind);
  for (const item of files) {
    await uploadWithProgress({
      url: `/api${path(`/hrms/leave/${leaveId}/documents`)}`,
      file: item.file,
      fields: { docType, notes: item.notes },
    });
  }
}

export function LeaveDocsPanel({
  leaveId,
  employeeId,
  requestKind,
  path,
  pendingFiles,
  onPendingFilesChange,
}: {
  leaveId?: string;
  employeeId: string;
  requestKind: string;
  path: (p: string) => string;
  pendingFiles?: PendingLeaveDoc[];
  onPendingFilesChange?: (files: PendingLeaveDoc[]) => void;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [uploadMsg, setUploadMsg] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["leave-docs", leaveId, path],
    queryFn: () => api<{ documents?: LeaveDoc[] }>(path(`/hrms/leave/${leaveId}/documents`)),
    enabled: Boolean(leaveId),
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!leaveId || !file) throw new Error("Select a file");
      return uploadWithProgress({
        url: `/api${path(`/hrms/leave/${leaveId}/documents`)}`,
        file,
        fields: { docType: docTypeForKind(requestKind), notes },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-docs", leaveId] });
      setFile(null);
      setNotes("");
      setUploadMsg("Uploaded");
    },
    onError: (e: Error) => setUploadMsg(e.message),
  });

  if (!isMedicalLeaveKind(requestKind)) return null;

  const docs = data?.documents || [];
  const label = docLabelForKind(requestKind);

  const addPending = () => {
    if (!file || !onPendingFilesChange || !pendingFiles) return;
    onPendingFilesChange([...pendingFiles, { file, notes }]);
    setFile(null);
    setNotes("");
  };

  return (
    <div className={styles.docsPanel}>
      <h4 className={styles.docsTitle}>📎 {label}</h4>
      <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
        Upload supporting documents for this {requestKind === "exam" ? "exam" : "medical"} leave request.
      </p>

      {leaveId ? (
        <>
          {isLoading && <p className="muted">Loading documents…</p>}
          {!isLoading && !docs.length && <p className="muted">No documents uploaded yet.</p>}
          {docs.map((d) => (
            <div key={d.id || d.driveFileId || d.fileName} className={styles.docRow}>
              <span>
                📄 {d.fileName}
                {d.notes ? <span className="muted"> — {d.notes}</span> : null}
                <span className="muted" style={{ display: "block", fontSize: "0.75rem" }}>
                  {d.uploadedBy ? `By ${d.uploadedBy} · ` : ""}
                  {d.createdAt ? new Date(d.createdAt).toLocaleDateString() : ""}
                </span>
              </span>
              {d.driveFileId && (
                <a
                  href={`/api/documents/${encodeURIComponent(employeeId)}/${encodeURIComponent(d.driveFileId)}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm"
                >
                  View
                </a>
              )}
            </div>
          ))}
        </>
      ) : (
        <>
          {pendingFiles?.length ? (
            <ul className={styles.pendingDocs}>
              {pendingFiles.map((p, i) => (
                <li key={`${p.file.name}-${i}`}>
                  📄 {p.file.name}
                  {p.notes ? <span className="muted"> — {p.notes}</span> : null}
                  {onPendingFilesChange && (
                    <button
                      type="button"
                      className={styles.removePending}
                      onClick={() => onPendingFilesChange(pendingFiles.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No files queued — add documents below (uploaded after submit).</p>
          )}
        </>
      )}

      <div className={styles.docsUpload}>
        <Dropzone
          label={`Upload ${label}`}
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
          onFile={(f) => setFile(f)}
        />
        <label>
          <span className="muted">Notes (optional)</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Dr. Smith, issued 2026-07-08"
          />
        </label>
        {leaveId ? (
          <Button size="sm" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
        ) : (
          <Button size="sm" disabled={!file} onClick={addPending}>
            Add to request
          </Button>
        )}
        {uploadMsg && <span className="muted" style={{ fontSize: "0.85rem" }}>{uploadMsg}</span>}
      </div>
    </div>
  );
}
