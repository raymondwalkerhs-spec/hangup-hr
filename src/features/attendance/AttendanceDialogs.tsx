import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { fileToBase64 } from "@/lib/files";
import { Dialog, ConfirmDialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { FormField, FormGrid, FormSection } from "@/ui/FormGrid";

export function FpImportDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const month = useAppStore((s) => s.month);
  const [file, setFile] = useState<File | null>(null);
  const [policy, setPolicy] = useState("skip_manual");
  const [preview, setPreview] = useState<{ preview?: { fpNumber?: string; date: string; checkIn?: string; checkOut?: string; status: string }[]; unmatchedFp?: string[] } | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const previewMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file");
      const base64 = await fileToBase64(file);
      return api<typeof preview>("/attendance/import", {
        method: "POST",
        body: JSON.stringify({ month, base64, fileName: file.name, dryRun: true, overwritePolicy: policy }),
      });
    },
    onSuccess: (data) => setPreview(data),
  });

  const applyMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file");
      const base64 = await fileToBase64(file);
      return api<{ rowsApplied?: number; rowsSkipped?: number }>("/attendance/import", {
        method: "POST",
        body: JSON.stringify({ month, base64, fileName: file.name, dryRun: false, overwritePolicy: policy }),
      });
    },
    onSuccess: (res) => {
      setResultMsg(`Imported ${res.rowsApplied || 0} day(s). Skipped ${res.rowsSkipped || 0}.`);
      onDone?.();
      onOpenChange(false);
    },
  });

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange} title="Import fingerprint attendance" wide scrollBody footer={
      <>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="secondary" onClick={() => previewMut.mutate()} disabled={!file}>Preview</Button>
        <Button onClick={() => setConfirmApply(true)} disabled={!file || applyMut.isPending}>Apply import</Button>
      </>
    }>
      <FormGrid>
        <FormField label="CSV or XLS file" span="full">
          <input type="file" accept=".csv,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </FormField>
        <FormField label="On conflict">
          <select value={policy} onChange={(e) => setPolicy(e.target.value)}>
            <option value="skip_manual">Skip days with manual edits</option>
            <option value="overwrite">Overwrite all</option>
          </select>
        </FormField>
      </FormGrid>
      {preview?.preview?.length ? (
        <div style={{ marginTop: "1rem", maxHeight: "16rem", overflow: "auto" }}>
          <table style={{ width: "100%", fontSize: "0.8rem" }}>
            <thead><tr><th>FP</th><th>Date</th><th>In</th><th>Out</th><th>Status</th></tr></thead>
            <tbody>
              {preview.preview.slice(0, 100).map((r, i) => (
                <tr key={i}><td>{r.fpNumber}</td><td>{r.date}</td><td>{r.checkIn || "—"}</td><td>{r.checkOut || "—"}</td><td>{r.status}</td></tr>
              ))}
            </tbody>
          </table>
          {preview.unmatchedFp?.length ? <p className="muted">Unmatched FP: {preview.unmatchedFp.join(", ")}</p> : null}
        </div>
      ) : null}
    </Dialog>
    <ConfirmDialog
      open={confirmApply}
      onOpenChange={setConfirmApply}
      title="Apply FP import?"
      message="This writes attendance rows for the selected month."
      confirmLabel="Apply"
      onConfirm={() => applyMut.mutate()}
    />
    <ConfirmDialog
      open={Boolean(resultMsg)}
      onOpenChange={(o) => !o && setResultMsg(null)}
      title="Import complete"
      message={resultMsg || ""}
      confirmLabel="OK"
      cancelLabel="Close"
      onConfirm={() => setResultMsg(null)}
    />
    </>
  );
}

type FpRules = {
  checkIn?: Record<string, string>;
  checkOut?: Record<string, string>;
};

export function FpRulesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const month = useAppStore((s) => s.month);
  const { path } = useCompanyScope();
  const [rules, setRules] = useState<FpRules>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api<{ rules: FpRules }>(path(`/attendance/fp-rules/${month}`))
      .then((d) => setRules(d.rules || {}))
      .finally(() => setLoading(false));
  }, [open, month, path]);

  const save = useMutation({
    mutationFn: () => api(path(`/attendance/fp-rules/${month}`), { method: "PUT", body: JSON.stringify({ rules }) }),
    onSuccess: () => onOpenChange(false),
  });

  const ci = rules.checkIn || {};
  const co = rules.checkOut || {};
  const setCi = (k: string, v: string) => setRules({ ...rules, checkIn: { ...ci, [k]: v } });
  const setCo = (k: string, v: string) => setRules({ ...rules, checkOut: { ...co, [k]: v } });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="FP rules" wide scrollBody footer={
      <>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={() => save.mutate()}>Save rules</Button>
      </>
    }>
      {loading && <p className="muted">Loading…</p>}
      <FormSection title="Check-in">
        <FormGrid wide>
          {["onTimeBefore", "latenessAUntil", "latenessBUntil", "quarterDayUntil", "halfDayAfter"].map((k) => (
            <FormField key={k} label={k}>
              <input value={ci[k] || ""} onChange={(e) => setCi(k, e.target.value)} />
            </FormField>
          ))}
        </FormGrid>
      </FormSection>
      <FormSection title="Check-out">
        <FormGrid wide>
          {["expected", "graceUntil", "halfDayFrom", "halfDayUntil", "quarterDayFrom", "quarterDayUntil"].map((k) => (
            <FormField key={k} label={k}>
              <input value={co[k] || ""} onChange={(e) => setCo(k, e.target.value)} />
            </FormField>
          ))}
          <FormField label="Note" span="full">
            <textarea rows={2} value={co.note || ""} onChange={(e) => setCo("note", e.target.value)} />
          </FormField>
        </FormGrid>
      </FormSection>
    </Dialog>
  );
}
