import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import { Dropzone } from "@/ui/Dropzone";
import { downloadApiFile } from "@/lib/files";

type Doc = { id?: string; driveFileId?: string; docType?: string; fileName?: string; expiry?: string; driveLink?: string };
type Warning = { id: string; type?: string; title?: string; content?: string; date?: string; severity?: string; warningLevel?: string; createdBy?: string };
type QNote = { id: string; body?: string; noteDate?: string; authorUsername?: string };

export function EmployeeDocsDialog({
  employeeId,
  open,
  onOpenChange,
  canUpload,
  canExportZip,
  selfServiceUpload,
}: {
  employeeId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canUpload?: boolean;
  canExportZip?: boolean;
  /** Agent uploading own docs — restrict types to self-service list */
  selfServiceUpload?: boolean;
}) {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [upload, setUpload] = useState({ docType: "", expiry: "", noExpiry: false, notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["employee-docs", employeeId, companyContext],
    queryFn: () => api<{ documents?: Doc[]; docTypes?: string[] }>(path(`/documents/${encodeURIComponent(employeeId!)}`)),
    enabled: open && !!employeeId,
  });

  const docs = data?.documents || [];
  const docTypes = (data?.docTypes || ["National ID", "Medical Note"]).filter(Boolean);
  const uploadTypes = selfServiceUpload
    ? docTypes.filter((t) => ["National ID", "Medical Note", "Exam Note"].includes(t))
    : docTypes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Documents — ${employeeId}`} wide footer={<Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>}>
      {isLoading && <p className="muted">Loading…</p>}
      {!isLoading && !docs.length && <p className="muted">No documents uploaded yet.</p>}
      {docs.map((d) => {
        const docId = d.id || d.driveFileId;
        const fileUrl = d.driveLink || `/api/documents/${encodeURIComponent(employeeId!)}/${encodeURIComponent(docId!)}/file`;
        return (
          <div key={docId} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span><strong>{d.docType}</strong> — {d.fileName}{d.expiry ? <span className="muted"> (exp: {d.expiry})</span> : null}</span>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm">Open</a>
          </div>
        );
      })}
      {canExportZip && employeeId && (
        <Button size="sm" variant="secondary" style={{ marginBottom: "1rem" }} onClick={() => downloadApiFile(path(`/exports/documents-zip?employeeId=${encodeURIComponent(employeeId)}`), `documents-${employeeId}.zip`)}>
          Download all (ZIP)
        </Button>
      )}
      {canUpload && (
        <FormGrid wide>
          <FormField label="Type">
            <Select
              value={upload.docType || uploadTypes[0] || ""}
              onChange={(docType) => setUpload({ ...upload, docType })}
              options={uploadTypes.map((t) => ({ value: t, label: t }))}
            />
          </FormField>
          <FormField label="Expiry">
            <input type="date" value={upload.expiry} disabled={upload.noExpiry} onChange={(e) => setUpload({ ...upload, expiry: e.target.value })} />
          </FormField>
          <FormField label="No expiry">
            <label><input type="checkbox" checked={upload.noExpiry} onChange={(e) => setUpload({ ...upload, noExpiry: e.target.checked })} /> No expiry date</label>
          </FormField>
          <FormField label="Notes"><input value={upload.notes} onChange={(e) => setUpload({ ...upload, notes: e.target.value })} /></FormField>
          <FormField label="File" span="full">
            <Dropzone
              label="Drop a document or click to browse"
              uploadUrl={path("/documents")}
              extraFields={{
                employeeId: employeeId || "",
                docType: upload.docType || uploadTypes[0] || "",
                notes: upload.notes,
                expiry: upload.noExpiry ? "" : upload.expiry,
                noExpiry: upload.noExpiry ? "true" : "",
              }}
              onUploaded={() => {
                qc.invalidateQueries({ queryKey: ["employee-docs", employeeId] });
              }}
            />
          </FormField>
        </FormGrid>
      )}
    </Dialog>
  );
}

export function EmployeeWarningsDialog({
  employeeId,
  open,
  onOpenChange,
  canRead,
  canWrite,
  canManage,
}: {
  employeeId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canRead?: boolean;
  canWrite?: boolean;
  canManage?: boolean;
}) {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [form, setForm] = useState({ type: "Warning", date: new Date().toISOString().slice(0, 10), title: "", content: "", severity: "normal", warningLevel: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ type: "", date: "", title: "", content: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["employee-warnings", employeeId, companyContext],
    queryFn: () => api<{ warnings?: Warning[] }>(path(`/warnings/${encodeURIComponent(employeeId!)}`)),
    enabled: open && !!employeeId && canRead,
  });

  const add = useMutation({
    mutationFn: () => api(path("/warnings"), { method: "POST", body: JSON.stringify({ employeeId, ...form, warningLevel: form.warningLevel || undefined }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employee-warnings", employeeId] }); setForm({ ...form, title: "", content: "" }); },
  });

  const update = useMutation({
    mutationFn: () => api(path(`/warnings/${encodeURIComponent(editId!)}`), { method: "PUT", body: JSON.stringify(editForm) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employee-warnings", employeeId] }); setEditId(null); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(path(`/warnings/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employee-warnings", employeeId] }),
  });

  const warnings = data?.warnings || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`HR notes — ${employeeId}`} xlarge footer={<Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>}>
      {isLoading && <p className="muted">Loading…</p>}
      {!canRead && <p className="muted">HR notes are restricted to HR/Admin.</p>}
      {canRead && warnings.map((w) => (
        <div key={w.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.65rem", marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><strong>{w.type}: {w.title || "—"}</strong><span className="muted">{w.date}</span></div>
          <p style={{ margin: "0.5rem 0" }}>{w.content}</p>
          <div className="muted" style={{ fontSize: "0.75rem" }}>{w.createdBy} · {w.severity}{w.warningLevel ? ` · ${w.warningLevel}` : ""}</div>
          {canManage && (
            <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.35rem" }}>
              <Button size="sm" variant="secondary" onClick={() => { setEditId(w.id); setEditForm({ type: w.type || "", date: w.date || "", title: w.title || "", content: w.content || "" }); }}>Edit</Button>
              <Button size="sm" variant="danger" onClick={() => { if (confirm("Delete?")) remove.mutate(w.id); }}>Delete</Button>
            </div>
          )}
        </div>
      ))}
      {canRead && !warnings.length && <p className="muted">No HR notes yet.</p>}
      {canWrite && (
        <FormGrid wide>
          <h4>Add HR note / warning</h4>
          <FormField label="Type">
            <Select
              value={form.type}
              onChange={(type) => setForm({ ...form, type })}
              options={["Warning", "Note", "Verbal warning", "Written warning"].map((t) => ({ value: t, label: t }))}
            />
          </FormField>
          <FormField label="Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></FormField>
          <FormField label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></FormField>
          <FormField label="Content"><textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required /></FormField>
          <FormField label="Severity">
            <Select
              value={form.severity}
              onChange={(severity) => setForm({ ...form, severity })}
              options={[
                { value: "normal", label: "Normal" },
                { value: "high", label: "High" },
                { value: "critical", label: "Critical" },
              ]}
            />
          </FormField>
          <FormField label="Warning level">
            <Select
              value={form.warningLevel}
              onChange={(warningLevel) => setForm({ ...form, warningLevel })}
              options={[
                { value: "", label: "—" },
                { value: "1st", label: "1st" },
                { value: "2nd", label: "2nd" },
                { value: "final", label: "Final" },
              ]}
            />
          </FormField>
          <Button size="sm" onClick={() => add.mutate()} disabled={!form.title || !form.content || add.isPending}>Save note</Button>
        </FormGrid>
      )}
      {editId && (
        <Dialog open onOpenChange={() => setEditId(null)} title="Edit note" footer={<><Button variant="secondary" onClick={() => setEditId(null)}>Cancel</Button><Button onClick={() => update.mutate()}>Save</Button></>}>
          <FormGrid>
            <FormField label="Type"><input value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} /></FormField>
            <FormField label="Date"><input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} /></FormField>
            <FormField label="Title"><input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} /></FormField>
            <FormField label="Content"><textarea value={editForm.content} onChange={(e) => setEditForm({ ...editForm, content: e.target.value })} /></FormField>
          </FormGrid>
        </Dialog>
      )}
    </Dialog>
  );
}

export function EmployeeQualityNotesDialog({
  employeeId,
  open,
  onOpenChange,
  canRead,
  canWrite,
  canManage,
  username,
}: {
  employeeId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canRead?: boolean;
  canWrite?: boolean;
  canManage?: boolean;
  username?: string;
}) {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [form, setForm] = useState({ noteDate: new Date().toISOString().slice(0, 10), body: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState({ noteDate: "", body: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["quality-notes", employeeId, companyContext],
    queryFn: () => api<{ notes?: QNote[] }>(path(`/quality-notes/${encodeURIComponent(employeeId!)}`)),
    enabled: open && !!employeeId && (canRead || canWrite),
  });

  const add = useMutation({
    mutationFn: () => api(path("/quality-notes"), { method: "POST", body: JSON.stringify({ employeeId, ...form }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["quality-notes", employeeId] }); setForm({ ...form, body: "" }); },
  });

  const update = useMutation({
    mutationFn: () => api(path(`/quality-notes/${encodeURIComponent(editId!)}`), { method: "PUT", body: JSON.stringify(editBody) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["quality-notes", employeeId] }); setEditId(null); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(path(`/quality-notes/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quality-notes", employeeId] }),
  });

  const notes = data?.notes || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Quality notes — ${employeeId}`} xlarge footer={<Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>}>
      {isLoading && <p className="muted">Loading…</p>}
      {notes.map((n) => {
        const canEdit = canManage || (canWrite && String(n.authorUsername || "").toLowerCase() === String(username || "").toLowerCase());
        return (
          <div key={n.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.65rem", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><strong>{n.noteDate}</strong><span className="muted">{n.authorUsername}</span></div>
            <p style={{ margin: "0.5rem 0" }}>{n.body}</p>
            {canEdit && (
              <div style={{ display: "flex", gap: "0.25rem" }}>
                <Button size="sm" variant="secondary" onClick={() => { setEditId(n.id); setEditBody({ noteDate: n.noteDate || "", body: n.body || "" }); }}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => { if (confirm("Delete?")) remove.mutate(n.id); }}>Delete</Button>
              </div>
            )}
          </div>
        );
      })}
      {!notes.length && <p className="muted">No quality notes yet.</p>}
      {canWrite && (
        <FormGrid wide>
          <h4>Add quality note</h4>
          <FormField label="Date"><input type="date" value={form.noteDate} onChange={(e) => setForm({ ...form, noteDate: e.target.value })} /></FormField>
          <FormField label="Note"><textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required /></FormField>
          <Button size="sm" onClick={() => add.mutate()} disabled={!form.body || add.isPending}>Save</Button>
        </FormGrid>
      )}
      {editId && (
        <Dialog open onOpenChange={() => setEditId(null)} title="Edit quality note" footer={<><Button variant="secondary" onClick={() => setEditId(null)}>Cancel</Button><Button onClick={() => update.mutate()}>Save</Button></>}>
          <FormGrid>
            <FormField label="Date"><input type="date" value={editBody.noteDate} onChange={(e) => setEditBody({ ...editBody, noteDate: e.target.value })} /></FormField>
            <FormField label="Note"><textarea value={editBody.body} onChange={(e) => setEditBody({ ...editBody, body: e.target.value })} /></FormField>
          </FormGrid>
        </Dialog>
      )}
    </Dialog>
  );
}
