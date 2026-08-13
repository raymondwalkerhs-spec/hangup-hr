import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { api, getSessionId } from "@/api/client";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { FormField, FormGrid, FormSection } from "@/ui/FormGrid";
import { saleCellValue } from "@/lib/salesCells";
import { filterEmployeesForSaleField, type SalePickerEmployee } from "@/lib/salesEmployeeFilters";
import {
  downloadApiFile,
  fileToBase64,
  isInlineMediaFileName,
  isVideoFileName,
  mediaMimeFromFileName,
  MAX_SALE_ATTACHMENT_BYTES,
} from "@/lib/files";

const PLAYABLE_ATTACH_KINDS = new Set(["recording", "raw_call", "quality_record"]);
import { SaleCatalogPicker } from "./SaleCatalogPicker";
import { SaleAssignmentPicker, initAssignmentFromScope, initAssignmentFromSale, useSaleSubmitScope, useRpmSubmitScope } from "./SaleAssignmentPicker";
import styles from "./SaleModals.module.css";

type Sale = Record<string, unknown>;
type CatalogField = {
  key: string;
  label?: string;
  section?: string;
  type?: string;
  canView?: boolean;
  canEdit?: boolean;
  options?: string[];
  hideOnEdit?: boolean;
  hideOnCreate?: boolean;
  employeeFilter?: string;
};

type AttachKind = { key: string; label?: string; canView?: boolean; canEdit?: boolean; canUpload?: boolean };

type EmpMap = Map<string, SalePickerEmployee>;

function deviceLabel(device: unknown) {
  const key = String(device || "").toLowerCase();
  const map: Record<string, string> = { smartwatch: "Smartwatch", bracelet: "Bracelet", necklace: "Necklace" };
  return map[key] || (device ? String(device) : "—");
}

function SaleSummary({ sale, empById }: { sale: Sale; empById: Map<string, { american_name?: string }> }) {
  const fd = (sale.formData as Record<string, unknown>) || {};
  const agent = empById.get(String(sale.agentId || ""));
  const closer = empById.get(String(sale.closerId || ""));
  return (
    <div className={styles.summary}>
      <div><span className="muted">Customer</span><strong>{String(sale.fullName || "—")}</strong><div className="muted">{String(sale.phoneNumber || "")}</div></div>
      <div><span className="muted">Client</span><div>{String(sale.client || fd.client || "—")}</div></div>
      <div><span className="muted">Device</span><div>{deviceLabel(sale.device || fd.deviceType)}</div></div>
      <div><span className="muted">Agent</span><div>{String(sale.agentId || "—")} — {agent?.american_name || String(sale.agentDisplayName || "")}</div></div>
      <div><span className="muted">Closer</span><div>{String(sale.closerId || "—")} — {closer?.american_name || String(sale.closerDisplayName || fd.closerName || "")}</div></div>
      <div><span className="muted">Status</span><div><span className={styles.badge}>{String(sale.status || "")}</span></div></div>
    </div>
  );
}

function FieldGrid({
  fields,
  sale,
  empById,
  form,
  setForm,
  editable,
}: {
  fields: CatalogField[];
  sale: Sale;
  empById: EmpMap;
  form: Record<string, string>;
  setForm: (k: string, v: string) => void;
  editable: boolean;
}) {
  const sections = [...new Set(fields.map((f) => f.section || "general"))];
  const fd = (sale.formData as Record<string, unknown>) || {};

  return (
    <>
      {sections.map((sec) => {
        const secFields = fields.filter((f) => (f.section || "general") === sec);
        if (!secFields.length) return null;
        return (
          <FormSection key={sec} title={sec}>
            <FormGrid wide>
              {secFields.map((f) => {
                const val = String(form[f.key] ?? fd[f.key] ?? sale[f.key] ?? "");
                if (!editable || !f.canEdit) {
                  const display = f.type === "employee"
                    ? empById.get(val)?.american_name || val
                    : saleCellValue(f.key, sale, empById);
                  return (
                    <FormField key={f.key} label={f.label || f.key}>
                      <div className={styles.readonly}>{display || "—"}</div>
                    </FormField>
                  );
                }
                if (f.type === "select" && f.options) {
                  return (
                    <FormField key={f.key} label={f.label || f.key}>
                      <select value={val} onChange={(e) => setForm(f.key, e.target.value)}>
                        <option value="">—</option>
                        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </FormField>
                  );
                }
                if (f.type === "textarea") {
                  return (
                    <FormField key={f.key} label={f.label || f.key} span="full">
                      <textarea rows={4} value={val} onChange={(e) => setForm(f.key, e.target.value)} />
                    </FormField>
                  );
                }
                if (f.type === "date") {
                  return (
                    <FormField key={f.key} label={f.label || f.key}>
                      <input type="date" value={val} onChange={(e) => setForm(f.key, e.target.value)} />
                    </FormField>
                  );
                }
                if (f.type === "email") {
                  return (
                    <FormField key={f.key} label={f.label || f.key}>
                      <input type="email" value={val} onChange={(e) => setForm(f.key, e.target.value)} />
                    </FormField>
                  );
                }
                if (f.type === "tel") {
                  return (
                    <FormField key={f.key} label={f.label || f.key}>
                      <input type="tel" value={val} onChange={(e) => setForm(f.key, e.target.value)} />
                    </FormField>
                  );
                }
                if (f.type === "multi-checkbox" && f.options) {
                  const raw = form[f.key] ?? fd[f.key] ?? sale[f.key];
                  const selected = new Set(
                    Array.isArray(raw)
                      ? raw.map(String)
                      : String(raw || "").split(",").map((s) => s.trim()).filter(Boolean)
                  );
                  if (!editable || !f.canEdit) {
                    return (
                      <FormField key={f.key} label={f.label || f.key} span="full">
                        <div className={styles.readonly}>{[...selected].join(", ") || "—"}</div>
                      </FormField>
                    );
                  }
                  return (
                    <FormField key={f.key} label={f.label || f.key} span="full">
                      <div className={styles.checkboxGrid}>
                        {f.options.map((o) => (
                          <label key={o} className={styles.checkboxItem}>
                            <input
                              type="checkbox"
                              checked={selected.has(o)}
                              onChange={(e) => {
                                const next = new Set(selected);
                                if (e.target.checked) next.add(o);
                                else next.delete(o);
                                setForm(f.key, [...next].join(","));
                              }}
                            />
                            <span>{o}</span>
                          </label>
                        ))}
                      </div>
                    </FormField>
                  );
                }
                if (f.type === "employee") {
                  const options = filterEmployeesForSaleField([...empById.values()], f.employeeFilter, val);
                  return (
                    <FormField key={f.key} label={f.label || f.key}>
                      <select value={val} onChange={(e) => setForm(f.key, e.target.value)}>
                        <option value="">—</option>
                        {options.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.id} — {e.american_name || e.id}
                            {f.employeeFilter === "reviewers" && String(e.role || "").toLowerCase() === "quality" ? " ★" : ""}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  );
                }
                return (
                  <FormField key={f.key} label={f.label || f.key}>
                    <input value={val} onChange={(e) => setForm(f.key, e.target.value)} />
                  </FormField>
                );
              })}
            </FormGrid>
          </FormSection>
        );
      })}
    </>
  );
}

export function ViewSaleModal({
  sale,
  open,
  onOpenChange,
}: {
  sale: Sale | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { path, companyContext } = useSaleApiScope();
  const { data: catalog } = useQuery({
    queryKey: ["sale-catalog-view", sale?.id, companyContext],
    queryFn: () =>
      api<{ fields: CatalogField[]; attachmentKinds?: AttachKind[] }>(
        path(`/sales/field-catalog?surface=main&saleId=${encodeURIComponent(String(sale?.id))}`)
      ),
    enabled: open && !!sale?.id,
  });
  const { data: empData } = useQuery({
    queryKey: ["employees-sales-modals", companyContext],
    queryFn: () => api<{ employees: { id: string; american_name?: string }[] }>(path("/employees")),
    enabled: open,
  });
  const { data: attachments } = useQuery({
    queryKey: ["sale-attachments-view", sale?.id, companyContext],
    queryFn: () =>
      api<{ attachments: { id: string; kind: string; fileName: string }[] }>(
        path(`/sales/${sale?.id}/attachments`)
      ),
    enabled: open && !!sale?.id,
  });
  const empById = useMemo(() => new Map((empData?.employees || []).map((e) => [e.id, e])), [empData?.employees]);
  const fields = (catalog?.fields || []).filter((f) => f.canView !== false && !f.hideOnEdit);
  const attachKinds = (catalog?.attachmentKinds || []).filter((k) => k.canView !== false);

  if (!sale) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="View sale" size="wide" scrollBody footer={
      <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
    }>
      <SaleSummary sale={sale} empById={empById} />
      <FieldGrid fields={fields} sale={sale} empById={empById} form={{}} setForm={() => {}} editable={false} />
      <SaleAttachmentsPanel
        attachments={attachments?.attachments || []}
        attachKinds={attachKinds}
        downloadPath={(id) => path(`/sales/attachments/${id}/download`)}
        streamPath={(id) => path(`/sales/attachments/${id}/file`)}
        inlinePlayback={attachKinds.some((k) => PLAYABLE_ATTACH_KINDS.has(k.key) && k.canView !== false)}
      />
    </Dialog>
  );
}

function InlineMediaPlayer({ streamPath, fileName }: { streamPath: string; fileName?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const video = isVideoFileName(fileName || "");

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const sessionId = getSessionId();
        const res = await fetch(`/api${streamPath}`, {
          credentials: "same-origin",
          headers: sessionId ? { "x-session-id": sessionId } : {},
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || "Could not load media");
        }
        const blob = await res.blob();
        if (cancelled) return;
        const headerMime = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        const mime =
          headerMime && headerMime !== "application/octet-stream"
            ? headerMime
            : mediaMimeFromFileName(fileName || "") || blob.type || "application/octet-stream";
        const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
        objectUrl = URL.createObjectURL(typed);
        setUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message || "Playback failed");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [streamPath, fileName]);

  if (err) return <span className="muted" style={{ fontSize: "0.8rem" }}>{err}</span>;
  if (!url) return <span className="muted" style={{ fontSize: "0.8rem" }}>Loading media…</span>;
  if (video) {
    return (
      <video
        controls
        preload="metadata"
        src={url}
        style={{ width: "100%", maxWidth: 560, marginTop: "0.25rem", borderRadius: 8 }}
      />
    );
  }
  return <audio controls preload="metadata" src={url} style={{ width: "100%", maxWidth: 420, marginTop: "0.25rem" }} />;
}

function SaleAttachmentsPanel({
  attachments,
  attachKinds,
  onUpload,
  onDelete,
  downloadPath,
  streamPath,
  inlinePlayback,
  uploadPending,
  loadingKinds,
}: {
  attachments: { id: string; kind: string; fileName: string }[];
  attachKinds: AttachKind[];
  onUpload?: (file: File, kind: string) => void;
  onDelete?: (id: string) => void;
  downloadPath: (id: string) => string;
  streamPath?: (id: string) => string;
  inlinePlayback?: boolean;
  uploadPending?: boolean;
  loadingKinds?: boolean;
}) {
  const kindEditable = (k: AttachKind) => k.canEdit === true || k.canUpload === true;
  const kindCanEdit = useMemo(
    () => Object.fromEntries(attachKinds.map((k) => [k.key, k.canEdit === true || k.canUpload === true])),
    [attachKinds]
  );
  const uploadable = onUpload ? attachKinds.filter((k) => kindEditable(k) && k.canView !== false) : [];
  const viewOnlyKinds = attachKinds.filter((k) => k.canView !== false && !kindEditable(k));
  if (!uploadable.length && !attachments.length && !viewOnlyKinds.length && !loadingKinds) return null;

  const onPickFile = (file: File, kind: string) => {
    if (!onUpload) return;
    if (file.size > MAX_SALE_ATTACHMENT_BYTES) {
      const mb = Math.round(MAX_SALE_ATTACHMENT_BYTES / (1024 * 1024));
      window.alert(`File is too large (max ~${mb} MB). Try a shorter recording or compress the file.`);
      return;
    }
    onUpload(file, kind);
  };

  return (
    <FormSection title="Records">
      {loadingKinds && !uploadable.length && (
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          Loading upload options…
        </p>
      )}
      {viewOnlyKinds.length > 0 && !uploadable.length && !loadingKinds && (
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          You can listen to recordings below. Upload is not available for your role.
        </p>
      )}
      <ul style={{ fontSize: "0.85rem", margin: "0 0 0.75rem", paddingLeft: 0, listStyle: "none" }}>
        {attachments.map((a) => {
          const canRemove = onDelete && kindCanEdit[a.kind] === true;
          const playInline =
            inlinePlayback &&
            streamPath &&
            PLAYABLE_ATTACH_KINDS.has(a.kind) &&
            isInlineMediaFileName(a.fileName);
          return (
            <li key={a.id} style={{ marginBottom: "0.75rem", paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <span>{a.kind}: {a.fileName}</span>
                {playInline ? (
                  <Button size="sm" variant="outline" onClick={() => downloadApiFile(streamPath(a.id), a.fileName)}>Open</Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => downloadApiFile(downloadPath(a.id), a.fileName)}>Download</Button>
                {canRemove && (
                  <Button size="sm" variant="danger" onClick={() => onDelete(a.id)}>Remove</Button>
                )}
              </div>
              {playInline && <InlineMediaPlayer streamPath={streamPath(a.id)} fileName={a.fileName} />}
            </li>
          );
        })}
        {!attachments.length && <li className="muted">No records uploaded</li>}
      </ul>
      {uploadable.map((k) => (
        <label key={k.key} style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
          Upload {k.label || k.key}
          <input
            type="file"
            accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.webm,.ogg,.aac,.3gp,.amr,.mov,.opus,.flac,.mpeg,.wma"
            disabled={uploadPending}
            style={{ display: "block", marginTop: "0.25rem" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f, k.key);
              e.target.value = "";
            }}
          />
        </label>
      ))}
    </FormSection>
  );
}

export function QualityTicketModal({
  sale,
  open,
  onOpenChange,
  onSaved,
}: {
  sale: Sale | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [agentId, setAgentId] = useState("");
  const [closerId, setCloserId] = useState("");
  const [unit, setUnit] = useState("");
  const [team, setTeam] = useState("");
  const formInitialized = useRef(false);

  const { user: meUser } = useAppStatus();
  const canReassign = Boolean(meUser?.canReassignSaleLead);
  const { path, withCompany, companyContext } = useSaleApiScope();

  const { data: catalog, isError: catalogIsError, error: catalogError, isLoading: catalogLoading } = useQuery({
    queryKey: ["sale-catalog-quality", sale?.id, companyContext],
    queryFn: () =>
      api<{ fields: CatalogField[]; attachmentKinds?: AttachKind[] }>(
        path(`/sales/field-catalog?surface=quality&saleId=${encodeURIComponent(String(sale?.id))}`)
      ),
    enabled: open && !!sale?.id,
  });
  const { data: empData } = useQuery({
    queryKey: ["employees-sales-modals", companyContext],
    queryFn: () => api<{ employees: SalePickerEmployee[] }>(path("/employees")),
    enabled: open,
  });
  const { data: attachments, refetch: refetchAtt } = useQuery({
    queryKey: ["sale-attachments", sale?.id, companyContext],
    queryFn: () =>
      api<{ attachments: { id: string; kind: string; fileName: string }[] }>(
        path(`/sales/${sale?.id}/attachments`)
      ),
    enabled: open && !!sale?.id,
  });
  const { data: submitScope } = useSaleSubmitScope(open && canReassign);

  const empById = useMemo(() => new Map((empData?.employees || []).map((e) => [e.id, e])), [empData?.employees]);

  const fields = useMemo(
    () =>
      (catalog?.fields || []).filter(
        (f) =>
          f.canView !== false &&
          !["agentName", "closerName", "leadType", "client", "deviceType", "unit", "team"].includes(f.key)
      ),
    [catalog?.fields]
  );

  const attachKinds = (catalog?.attachmentKinds || []).filter((k) => k.canView !== false);

  const canSaveQuality = useMemo(
    () => (catalog?.fields || []).some((f) => f.canEdit === true) || attachKinds.some((k) => k.canEdit !== false),
    [catalog?.fields, attachKinds]
  );

  useEffect(() => {
    if (!open || !sale) return;
    if (formInitialized.current) return;
    const fd = (sale.formData as Record<string, unknown>) || {};
    const init: Record<string, string> = {};
    fields.forEach((f) => {
      init[f.key] = String(fd[f.key] ?? sale[f.key] ?? "");
    });
    setForm(init);
    const assignment = initAssignmentFromSale(sale);
    setAgentId(assignment.agentId);
    setCloserId(assignment.closerId);
    setUnit(assignment.unit);
    setTeam(assignment.team);
    formInitialized.current = true;
  }, [open, sale, fields]);

  useEffect(() => {
    if (!open) formInitialized.current = false;
  }, [open]);

  const save = useMutation({
    mutationFn: () =>
      api(path(`/sales/${sale?.id}`), {
        method: "PATCH",
        body: JSON.stringify(withCompany({
          edit: true,
          qualityTicket: true,
          formData: form,
          agentId: canReassign ? agentId : sale?.agentId,
          closerId: canReassign ? closerId : sale?.closerId,
          unit: canReassign ? unit : sale?.unit,
          team: canReassign ? team : sale?.team,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      onSaved?.();
      onOpenChange(false);
    },
  });

  const uploadAtt = useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: string }) => {
      const contentBase64 = await fileToBase64(file);
      return api(path(`/sales/${sale?.id}/attachments`), {
        method: "POST",
        body: JSON.stringify(withCompany({ fileName: file.name, contentBase64, kind })),
      });
    },
    onSuccess: () => refetchAtt(),
  });

  const deleteAtt = useMutation({
    mutationFn: (id: string) => api(path(`/sales/attachments/${id}`), { method: "DELETE" }),
    onSuccess: () => refetchAtt(),
  });

  if (!sale) return null;

  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quality ticket"
      size="wide"
      scrollBody
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          {canSaveQuality && (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save ticket</Button>
          )}
        </>
      }
    >
      <SaleSummary sale={sale} empById={empById} />
      {canReassign && submitScope && (
        <SaleAssignmentPicker
          scope={submitScope}
          unit={unit}
          team={team}
          agentId={agentId}
          closerId={closerId}
          onChange={(patch) => {
            if (patch.unit !== undefined) setUnit(patch.unit);
            if (patch.team !== undefined) setTeam(patch.team);
            if (patch.agentId !== undefined) setAgentId(patch.agentId);
            if (patch.closerId !== undefined) setCloserId(patch.closerId);
          }}
        />
      )}
      {catalogIsError && (
        <p style={{ color: "var(--err)" }}>{(catalogError as Error)?.message || "Could not load quality ticket fields"}</p>
      )}
      <SaleAttachmentsPanel
        attachments={attachments?.attachments || []}
        attachKinds={attachKinds}
        uploadPending={uploadAtt.isPending}
        loadingKinds={catalogLoading}
        downloadPath={(id) => path(`/sales/attachments/${id}/download`)}
        streamPath={(id) => path(`/sales/attachments/${id}/file`)}
        inlinePlayback={attachKinds.some((k) => PLAYABLE_ATTACH_KINDS.has(k.key) && k.canView !== false)}
        onUpload={(file, kind) => uploadAtt.mutate({ file, kind })}
        onDelete={(id) => deleteAtt.mutate(id)}
      />
      <FieldGrid fields={fields} sale={sale} empById={empById} form={form} setForm={setField} editable />
      {(save.isError || uploadAtt.isError || deleteAtt.isError) && (
        <p style={{ color: "var(--err)" }}>
          {(save.error || uploadAtt.error || deleteAtt.error as Error)?.message}
        </p>
      )}
    </Dialog>
  );
}

function RpmSaleSummary({ sale, empById }: { sale: Sale; empById: Map<string, { american_name?: string }> }) {
  const fd = (sale.formData as Record<string, unknown>) || {};
  const agent = empById.get(String(sale.agentId || ""));
  const closer = empById.get(String(sale.closerId || ""));
  return (
    <div className={styles.summary}>
      <div><span className="muted">Customer</span><strong>{String(sale.fullName || "—")}</strong><div className="muted">{String(sale.phoneNumber || "")}</div></div>
      <div><span className="muted">Client</span><div>{String(sale.client || fd.client || "—")}</div></div>
      <div><span className="muted">Member ID</span><div>{String(sale.memberId || fd.memberId || "—")}</div></div>
      <div><span className="muted">Agent</span><div>{String(sale.agentId || "—")} — {agent?.american_name || String(sale.agentDisplayName || "")}</div></div>
      <div><span className="muted">Closer</span><div>{String(sale.closerId || "—")} — {closer?.american_name || String(sale.closerDisplayName || fd.closerName || "")}</div></div>
      <div><span className="muted">Status</span><div><span className={styles.badge}>{String(sale.status || "")}</span></div></div>
    </div>
  );
}

export function RpmQualityTicketModal({
  sale,
  open,
  onOpenChange,
  onSaved,
}: {
  sale: Sale | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [agentId, setAgentId] = useState("");
  const [closerId, setCloserId] = useState("");
  const [unit, setUnit] = useState("");
  const [team, setTeam] = useState("");
  const formInitialized = useRef(false);

  const { user: meUser } = useAppStatus();
  const canReassign = Boolean(meUser?.canReassignSaleLead);
  const { path, withCompany, companyContext } = useSaleApiScope();

  const { data: catalog, isError: catalogIsError, error: catalogError, isLoading: catalogLoading } = useQuery({
    queryKey: ["rpm-sale-catalog-quality", sale?.id, companyContext],
    queryFn: () => api<{ fields: CatalogField[]; attachmentKinds?: AttachKind[] }>(path(`/rpm-sales/field-catalog?surface=quality&saleId=${encodeURIComponent(String(sale?.id))}`)),
    enabled: open && !!sale?.id,
  });
  const { data: empData } = useQuery({
    queryKey: ["employees-rpm-modals", companyContext],
    queryFn: () => api<{ employees: SalePickerEmployee[] }>(path("/employees")),
    enabled: open,
  });
  const { data: attachments, refetch: refetchAtt } = useQuery({
    queryKey: ["rpm-sale-attachments", sale?.id, companyContext],
    queryFn: () => api<{ attachments: { id: string; kind: string; fileName: string }[] }>(path(`/rpm-sales/${sale?.id}/attachments`)),
    enabled: open && !!sale?.id,
  });
  const { data: submitScope } = useRpmSubmitScope(open && canReassign);

  const empById = useMemo(() => new Map((empData?.employees || []).map((e) => [e.id, e])), [empData?.employees]);

  const fields = useMemo(
    () =>
      (catalog?.fields || []).filter(
        (f) =>
          f.canView !== false &&
          !["agentName", "closerName", "leadType", "unit", "team", "status"].includes(f.key)
      ),
    [catalog?.fields]
  );

  const attachKinds = (catalog?.attachmentKinds || []).filter((k) => k.canView !== false);

  const canSaveQuality = useMemo(
    () =>
      (catalog?.fields || []).some((f) => f.canEdit === true) ||
      attachKinds.some((k) => k.canEdit !== false),
    [catalog?.fields, attachKinds]
  );

  useEffect(() => {
    if (!open || !sale) return;
    if (formInitialized.current) return;
    const fd = (sale.formData as Record<string, unknown>) || {};
    const init: Record<string, string> = {};
    fields.forEach((f) => {
      const raw = fd[f.key] ?? sale[f.key];
      init[f.key] = raw != null && raw !== "" ? String(raw) : f.key === "reviewerFeedback" ? "Pending" : f.key === "clientFeedback" ? "Pending" : "";
    });
    setForm(init);
    const assignment = initAssignmentFromSale(sale);
    setAgentId(assignment.agentId);
    setCloserId(assignment.closerId);
    setUnit(assignment.unit);
    setTeam(assignment.team);
    formInitialized.current = true;
  }, [open, sale, fields]);

  useEffect(() => {
    if (!open) formInitialized.current = false;
  }, [open]);

  const save = useMutation({
    mutationFn: () =>
      api(path(`/rpm-sales/${sale?.id}`), {
        method: "PATCH",
        body: JSON.stringify(withCompany({
          edit: true,
          qualityTicket: true,
          formData: form,
          agentId: canReassign ? agentId : sale?.agentId,
          closerId: canReassign ? closerId : sale?.closerId,
          unit: canReassign ? unit : sale?.unit,
          team: canReassign ? team : sale?.team,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rpm-sales"] });
      onSaved?.();
      onOpenChange(false);
    },
  });

  const uploadAtt = useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: string }) => {
      const contentBase64 = await fileToBase64(file);
      return api(path(`/rpm-sales/${sale?.id}/attachments`), {
        method: "POST",
        body: JSON.stringify(withCompany({ fileName: file.name, contentBase64, kind })),
      });
    },
    onSuccess: () => refetchAtt(),
  });

  const deleteAtt = useMutation({
    mutationFn: (id: string) => api(path(`/rpm-sales/attachments/${id}`), { method: "DELETE" }),
    onSuccess: () => refetchAtt(),
  });

  if (!sale) return null;

  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quality ticket — RPM"
      size="wide"
      scrollBody
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          {canSaveQuality && (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save ticket</Button>
          )}
        </>
      }
    >
      <RpmSaleSummary sale={sale} empById={empById} />
      {canReassign && submitScope && (
        <SaleAssignmentPicker
          scope={submitScope}
          unit={unit}
          team={team}
          agentId={agentId}
          closerId={closerId}
          onChange={(patch) => {
            if (patch.unit !== undefined) setUnit(patch.unit);
            if (patch.team !== undefined) setTeam(patch.team);
            if (patch.agentId !== undefined) setAgentId(patch.agentId);
            if (patch.closerId !== undefined) setCloserId(patch.closerId);
          }}
        />
      )}
      {catalogIsError && (
        <p style={{ color: "var(--err)" }}>{(catalogError as Error)?.message || "Could not load quality ticket fields"}</p>
      )}
      <SaleAttachmentsPanel
        attachments={attachments?.attachments || []}
        attachKinds={attachKinds}
        uploadPending={uploadAtt.isPending}
        loadingKinds={catalogLoading}
        downloadPath={(id) => path(`/rpm-sales/attachments/${id}/download`)}
        streamPath={(id) => path(`/rpm-sales/attachments/${id}/file`)}
        inlinePlayback={attachKinds.some((k) => PLAYABLE_ATTACH_KINDS.has(k.key) && k.canView !== false)}
        onUpload={(file, kind) => uploadAtt.mutate({ file, kind })}
        onDelete={(id) => deleteAtt.mutate(id)}
      />
      <FieldGrid fields={fields} sale={sale} empById={empById} form={form} setForm={setField} editable />
      {(save.isError || uploadAtt.isError || deleteAtt.isError) && (
        <p style={{ color: "var(--err)" }}>
          {(save.error || uploadAtt.error || deleteAtt.error as Error)?.message}
        </p>
      )}
    </Dialog>
  );
}

export function RpmViewSaleModal({
  sale,
  open,
  onOpenChange,
}: {
  sale: Sale | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { path, companyContext } = useSaleApiScope();
  const { data: catalog } = useQuery({
    queryKey: ["rpm-sale-catalog-view", sale?.id, companyContext],
    queryFn: () =>
      api<{ fields: CatalogField[]; attachmentKinds?: AttachKind[] }>(
        path(`/rpm-sales/field-catalog?surface=main&saleId=${encodeURIComponent(String(sale?.id))}`)
      ),
    enabled: open && !!sale?.id,
  });
  const { data: empData } = useQuery({
    queryKey: ["employees-rpm-view", companyContext],
    queryFn: () => api<{ employees: { id: string; american_name?: string }[] }>(path("/employees")),
    enabled: open,
  });
  const { data: attachments } = useQuery({
    queryKey: ["rpm-sale-attachments-view", sale?.id, companyContext],
    queryFn: () =>
      api<{ attachments: { id: string; kind: string; fileName: string }[] }>(
        path(`/rpm-sales/${sale?.id}/attachments`)
      ),
    enabled: open && !!sale?.id,
  });
  const empById = useMemo(() => new Map((empData?.employees || []).map((e) => [e.id, e])), [empData?.employees]);
  const fields = (catalog?.fields || []).filter((f) => f.canView !== false && !f.hideOnEdit);
  const attachKinds = (catalog?.attachmentKinds || []).filter((k) => k.canView !== false);

  if (!sale) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="View RPM sale" size="wide" scrollBody footer={
      <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
    }>
      <RpmSaleSummary sale={sale} empById={empById} />
      <FieldGrid fields={fields} sale={sale} empById={empById} form={{}} setForm={() => {}} editable={false} />
      <SaleAttachmentsPanel
        attachments={attachments?.attachments || []}
        attachKinds={attachKinds}
        downloadPath={(id) => path(`/rpm-sales/attachments/${id}/download`)}
        streamPath={(id) => path(`/rpm-sales/attachments/${id}/file`)}
        inlinePlayback={attachKinds.some((k) => PLAYABLE_ATTACH_KINDS.has(k.key) && k.canView !== false)}
      />
    </Dialog>
  );
}

export function RpmSaleFormModal({
  sale,
  open,
  onOpenChange,
  onSaved,
}: {
  sale: Record<string, unknown> | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!sale?.id;
  const [form, setForm] = useState<Record<string, string>>({});
  const [agentId, setAgentId] = useState("");
  const [closerId, setCloserId] = useState("");
  const [unit, setUnit] = useState("");
  const [team, setTeam] = useState("");
  const formInitialized = useRef(false);

  const { user: meUser } = useAppStatus();
  const canReassign = Boolean(meUser?.canReassignSaleLead);
  const { path, withCompany } = useSaleApiScope();

  const { data: catalog } = useQuery({
    queryKey: ["rpm-sale-catalog-form", sale?.id, open],
    queryFn: () => api<{ fields: CatalogField[] }>(path(`/rpm-sales/field-catalog?surface=${isEdit ? `main&saleId=${encodeURIComponent(String(sale?.id))}` : "submit"}`)),
    enabled: open,
  });
  const { data: clientsData } = useQuery({
    queryKey: ["rpm-sales-clients"],
    queryFn: () => api<{ clients: { id: string; name: string }[] }>(path("/rpm-sales/clients")),
    enabled: open && !isEdit,
  });
  const { data: submitScope } = useRpmSubmitScope(open && (!isEdit || canReassign));
  const { data: empData } = useQuery({
    queryKey: ["employees-rpm-form"],
    queryFn: () => api<{ employees: { id: string; american_name?: string }[] }>(path("/employees")),
    enabled: open,
  });
  const empById = useMemo(() => new Map((empData?.employees || []).map((e) => [e.id, e])), [empData?.employees]);

  const fields = useMemo(() => {
    return (catalog?.fields || []).filter((f) => {
      if (f.canView === false) return false;
      if (!isEdit && f.hideOnCreate) return false;
      if (isEdit && f.hideOnEdit) return false;
      if (!isEdit && (f.section === "quality" || f.section === "client")) return false;
      if (f.key === "client" && !isEdit && (clientsData?.clients?.length || 0) > 0) return false;
      return true;
    });
  }, [catalog?.fields, isEdit, clientsData?.clients?.length]);

  useEffect(() => {
    if (!open) { formInitialized.current = false; return; }
    if (!isEdit && !submitScope) return;
    if (!catalog) return;
    if (formInitialized.current) return;
    const fd = (sale?.formData as Record<string, unknown>) || {};
    const init: Record<string, string> = {};
    fields.forEach((f) => {
      const raw = fd[f.key] ?? sale?.[f.key];
      if (f.type === "multi-checkbox" && Array.isArray(raw)) init[f.key] = raw.join(",");
      else init[f.key] = String(raw ?? "");
    });
    if (isEdit) {
      setForm(init);
      setAgentId(String(sale?.agentId || ""));
      setCloserId(String(sale?.closerId || ""));
      setUnit(String(sale?.unit || fd.unit || ""));
      setTeam(String(sale?.team || fd.team || ""));
      formInitialized.current = true;
      return;
    }
    const assignment = initAssignmentFromScope(submitScope!);
    setForm(init);
    setAgentId(assignment.agentId);
    setCloserId(assignment.closerId);
    setUnit(assignment.unit);
    setTeam(assignment.team);
    formInitialized.current = true;
  }, [open, isEdit, submitScope, catalog, fields, sale]);

  const save = useMutation({
    mutationFn: () => {
      const formData: Record<string, unknown> = { ...form };
      if (form.medicalConditions) {
        formData.medicalConditions = String(form.medicalConditions).split(",").map((s) => s.trim()).filter(Boolean);
      }
      const body = {
        edit: isEdit,
        formData,
        agentId,
        closerId,
        unit,
        team,
        phoneNumber: form.phoneNumber,
        fullName: form.fullName,
        client: form.client,
        memberId: form.memberId,
      };
      if (isEdit) return api(path(`/rpm-sales/${sale?.id}`), { method: "PATCH", body: JSON.stringify(withCompany(body)) });
      return api(path("/rpm-sales"), { method: "POST", body: JSON.stringify(withCompany(body)) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rpm-sales"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      onSaved?.();
      onOpenChange(false);
    },
  });

  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit RPM sale" : "Add RPM sale"}
      size="xlarge"
      scrollBody
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{isEdit ? "Save" : "Submit sale"}</Button>
        </>
      }
    >
      {isEdit && sale && <RpmSaleSummary sale={sale} empById={empById} />}
      {!isEdit && submitScope && (
        <SaleAssignmentPicker
          scope={submitScope}
          unit={unit}
          team={team}
          agentId={agentId}
          closerId={closerId}
          onChange={(patch) => {
            if (patch.unit !== undefined) setUnit(patch.unit);
            if (patch.team !== undefined) setTeam(patch.team);
            if (patch.agentId !== undefined) setAgentId(patch.agentId);
            if (patch.closerId !== undefined) setCloserId(patch.closerId);
          }}
        />
      )}
      {isEdit && canReassign && submitScope && (
        <SaleAssignmentPicker
          scope={submitScope}
          unit={unit}
          team={team}
          agentId={agentId}
          closerId={closerId}
          onChange={(patch) => {
            if (patch.unit !== undefined) setUnit(patch.unit);
            if (patch.team !== undefined) setTeam(patch.team);
            if (patch.agentId !== undefined) setAgentId(patch.agentId);
            if (patch.closerId !== undefined) setCloserId(patch.closerId);
          }}
        />
      )}
      {!isEdit && (clientsData?.clients?.length || 0) > 0 && (
        <FormSection title="Client">
          <FormGrid wide>
            <FormField label="Client Name">
              <select value={form.client || ""} onChange={(e) => setField("client", e.target.value)}>
                <option value="">—</option>
                {(clientsData?.clients || []).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </FormField>
          </FormGrid>
        </FormSection>
      )}
      <FieldGrid fields={fields} sale={sale || {}} empById={empById} form={form} setForm={setField} editable />
      {save.isError && <p style={{ color: "var(--err)" }}>{(save.error as Error).message}</p>}
    </Dialog>
  );
}

function useSaleApiScope() {
  const { path, companyContext } = useCompanyScope();
  const withCompany = (body: Record<string, unknown>) =>
    companyContext === "hs2" ? { ...body, company: "hs2" } : body;
  return { path, companyContext, withCompany };
}

function saleDraftKey(username?: string) {
  return `hr_sale_draft_v1_${username || "anon"}`;
}

export function SaleFormModal({
  sale,
  open,
  onOpenChange,
  onSaved,
}: {
  sale: Record<string, unknown> | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!sale?.id;
  const [form, setForm] = useState<Record<string, string>>({});
  const [agentId, setAgentId] = useState("");
  const [closerId, setCloserId] = useState("");
  const [unit, setUnit] = useState("");
  const [team, setTeam] = useState("");
  const [catalogIds, setCatalogIds] = useState({ clientId: "", productId: "", priceId: "" });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formInitialized = useRef(false);

  const { user: meUser } = useAppStatus();
  const draftUsername = meUser?.username as string | undefined;
  const canReassign = Boolean(meUser?.canReassignSaleLead);
  const { path, withCompany } = useSaleApiScope();

  const surface = isEdit ? `main&saleId=${encodeURIComponent(String(sale?.id))}` : "submit";
  const { data: catalog } = useQuery({
    queryKey: ["sale-catalog-form", sale?.id, open],
    queryFn: () => api<{ fields: CatalogField[]; attachmentKinds?: AttachKind[] }>(path(`/sales/field-catalog?surface=${surface}`)),
    enabled: open,
  });

  const { data: submitScope } = useSaleSubmitScope(open && (!isEdit || canReassign));

  const { data: mlaCatalog } = useQuery({
    queryKey: ["sales-config-catalog-mla-form", open],
    queryFn: () => api<{ clients?: { id: string }[] }>(path("/sales-config/catalog?saleProgram=mla")),
    enabled: open && !isEdit,
  });

  const { data: empData } = useQuery({
    queryKey: ["employees-sales-form"],
    queryFn: () => api<{ employees: { id: string; american_name?: string }[] }>(path("/employees")),
    enabled: open,
  });

  const { data: attachments, refetch: refetchAtt } = useQuery({
    queryKey: ["sale-attachments", sale?.id],
    queryFn: () => api<{ attachments: { id: string; kind: string; fileName: string }[] }>(path(`/sales/${sale?.id}/attachments`)),
    enabled: open && isEdit,
  });

  const empById = useMemo(() => new Map((empData?.employees || []).map((e) => [e.id, e])), [empData?.employees]);

  const fields = useMemo(() => {
    const list = (catalog?.fields || []).filter((f) => {
      if (f.canView === false) return false;
      if (!isEdit && f.hideOnCreate) return false;
      if (isEdit && f.hideOnEdit) return false;
      if (!isEdit && f.section === "quality") return false;
      if (!isEdit && (f.key === "unit" || f.key === "team")) return false;
      return true;
    });
    return list;
  }, [catalog?.fields, isEdit]);

  useEffect(() => {
    if (!open) {
      formInitialized.current = false;
      return;
    }
    if (!isEdit && !submitScope) return;
    if (!catalog) return;
    if (formInitialized.current) return;

    const fd = (sale?.formData as Record<string, unknown>) || {};
    const init: Record<string, string> = {};
    fields.forEach((f) => { init[f.key] = String(fd[f.key] ?? sale?.[f.key] ?? ""); });

    if (isEdit) {
      setForm(init);
      setAgentId(String(sale?.agentId || ""));
      setCloserId(String(sale?.closerId || ""));
      setUnit(String(sale?.unit || fd.unit || ""));
      setTeam(String(sale?.team || fd.team || ""));
      formInitialized.current = true;
      return;
    }

    let assignment = initAssignmentFromScope(submitScope!);
    if (draftUsername) {
      try {
        const raw = localStorage.getItem(saleDraftKey(draftUsername));
        if (raw) {
          const draft = JSON.parse(raw) as {
            fields?: Record<string, string>;
            agentId?: string;
            closerId?: string;
            unit?: string;
            team?: string;
          };
          if (draft.fields && Object.keys(draft.fields).length && confirm("Resume your saved sale draft?")) {
            Object.assign(init, draft.fields);
            assignment = {
              agentId: draft.agentId || assignment.agentId,
              closerId: draft.closerId || assignment.closerId,
              unit: draft.unit || assignment.unit,
              team: draft.team || assignment.team,
            };
          }
        }
      } catch { /* ignore */ }
    }

    setForm(init);
    setAgentId(assignment.agentId);
    setCloserId(assignment.closerId);
    setUnit(assignment.unit);
    setTeam(assignment.team);
    formInitialized.current = true;
  }, [open, sale, fields, isEdit, draftUsername, submitScope, catalog]);

  useEffect(() => {
    if (!open || isEdit || !draftUsername) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      localStorage.setItem(saleDraftKey(draftUsername), JSON.stringify({ savedAt: Date.now(), fields: form, agentId, closerId, unit, team }));
    }, 800);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [open, isEdit, draftUsername, form, agentId, closerId, unit, team]);

  const save = useMutation({
    mutationFn: async () => {
      const requiresCatalog = !isEdit && (mlaCatalog?.clients?.length || 0) > 0;
      if (requiresCatalog && (!catalogIds.clientId || !catalogIds.productId || !catalogIds.priceId)) {
        throw new Error("Select client, device, and price from the MLA catalog");
      }
      const body: Record<string, unknown> = {
        edit: isEdit,
        formData: { ...form },
        agentId: agentId || form.agentId,
        closerId: closerId || form.closerId,
        unit: unit || form.unit,
        team: team || form.team,
        phoneNumber: form.phoneNumber,
        fullName: form.fullName || form.customer,
        device: form.device || form.deviceType,
        client: form.client,
        price: form.price ? Number(form.price) : undefined,
      };
      if (catalogIds.clientId) {
        body.salesClientId = catalogIds.clientId;
        (body.formData as Record<string, string>).salesClientId = catalogIds.clientId;
      }
      if (catalogIds.productId) {
        body.salesProductId = catalogIds.productId;
        (body.formData as Record<string, string>).salesProductId = catalogIds.productId;
      }
      if (catalogIds.priceId) {
        body.salesPriceId = catalogIds.priceId;
        (body.formData as Record<string, string>).salesPriceId = catalogIds.priceId;
      }
      if (isEdit) {
        return api(path(`/sales/${sale?.id}`), { method: "PATCH", body: JSON.stringify(withCompany(body)) });
      }
      return api(path("/sales"), { method: "POST", body: JSON.stringify(withCompany(body)) });
    },
    onSuccess: () => {
      if (!isEdit && draftUsername) localStorage.removeItem(saleDraftKey(draftUsername));
      qc.invalidateQueries({ queryKey: ["sales"] });
      onSaved?.();
      onOpenChange(false);
    },
  });

  const deleteSale = useMutation({
    mutationFn: () => api(path(`/sales/${sale?.id}`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      onOpenChange(false);
    },
  });

  const uploadAtt = useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: string }) => {
      const contentBase64 = await fileToBase64(file);
      return api(path(`/sales/${sale?.id}/attachments`), {
        method: "POST",
        body: JSON.stringify(withCompany({ fileName: file.name, contentBase64, kind })),
      });
    },
    onSuccess: () => refetchAtt(),
  });

  const deleteAtt = useMutation({
    mutationFn: (id: string) => api(path(`/sales/attachments/${id}`), { method: "DELETE" }),
    onSuccess: () => refetchAtt(),
  });

  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const attachKinds = (catalog?.attachmentKinds || []).filter((k) => k.canView !== false);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit sale" : "Add sale"}
      size="xlarge"
      scrollBody
      footer={
        <>
          {isEdit && (
            <Button variant="danger" onClick={() => {
              if (confirm("Delete this sale?")) deleteSale.mutate();
            }}>Delete</Button>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </>
      }
    >
      {isEdit && sale && <SaleSummary sale={sale} empById={empById} />}
      {!isEdit && submitScope ? (
        <SaleAssignmentPicker
          scope={submitScope}
          unit={unit}
          team={team}
          agentId={agentId}
          closerId={closerId}
          onChange={(patch) => {
            if (patch.unit !== undefined) setUnit(patch.unit);
            if (patch.team !== undefined) setTeam(patch.team);
            if (patch.agentId !== undefined) setAgentId(patch.agentId);
            if (patch.closerId !== undefined) setCloserId(patch.closerId);
          }}
        />
      ) : isEdit && canReassign && submitScope ? (
        <SaleAssignmentPicker
          scope={submitScope}
          unit={unit}
          team={team}
          agentId={agentId}
          closerId={closerId}
          onChange={(patch) => {
            if (patch.unit !== undefined) setUnit(patch.unit);
            if (patch.team !== undefined) setTeam(patch.team);
            if (patch.agentId !== undefined) setAgentId(patch.agentId);
            if (patch.closerId !== undefined) setCloserId(patch.closerId);
          }}
        />
      ) : null}
      {!isEdit && (
        <SaleCatalogPicker
          clientId={catalogIds.clientId}
          productId={catalogIds.productId}
          priceId={catalogIds.priceId}
          onChange={(patch) => {
            setCatalogIds({ clientId: patch.clientId, productId: patch.productId, priceId: patch.priceId });
            setForm((f) => ({
              ...f,
              ...(patch.client ? { client: patch.client } : {}),
              ...(patch.device ? { device: patch.device, deviceType: patch.device } : {}),
              ...(patch.price ? { price: patch.price } : {}),
            }));
          }}
        />
      )}
      <FieldGrid fields={fields} sale={sale || {}} empById={empById} form={form} setForm={setField} editable />

      {isEdit && attachKinds.length > 0 && (
        <FormSection title="Attachments">
          <ul style={{ fontSize: "0.85rem", margin: "0 0 0.75rem", paddingLeft: "1.25rem" }}>
            {(attachments?.attachments || []).map((a) => (
              <li key={a.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
                <span>{a.kind}: {a.fileName}</span>
                <Button size="sm" variant="outline" onClick={() => downloadApiFile(`/sales/attachments/${a.id}/download`, a.fileName)}>Download</Button>
                <Button size="sm" variant="danger" onClick={() => deleteAtt.mutate(a.id)}>Delete</Button>
              </li>
            ))}
            {!attachments?.attachments?.length && <li className="muted">No attachments</li>}
          </ul>
          {attachKinds.filter((k) => k.canEdit !== false).map((k) => (
            <label key={k.key} style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
              Upload {k.label || k.key}
              <input
                type="file"
                style={{ display: "block", marginTop: "0.25rem" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAtt.mutate({ file: f, kind: k.key });
                }}
              />
            </label>
          ))}
        </FormSection>
      )}
      {save.isError && <p style={{ color: "var(--err)" }}>{(save.error as Error).message}</p>}
    </Dialog>
  );
}
