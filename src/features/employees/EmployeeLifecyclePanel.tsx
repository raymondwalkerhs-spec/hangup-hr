import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStore } from "@/stores/theme-store";
import { downloadApiFile, fileToBase64 } from "@/lib/files";
import { Dialog, ConfirmDialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { DepartDateDialog } from "./DepartDateDialog";
import { defaultDepartForm, departRequestBody, type DepartFormState } from "@/lib/employeeStatus";
import { EmployeeHrmsLifecycle } from "./EmployeeHrmsLifecycle";
import styles from "./EmployeeLifecyclePanel.module.css";

type Emp = Record<string, unknown>;

const LEAD_ROLES = ["TL", "CL", "OP", "HR", "RTM", "IT", "Agent"];

export function EmployeeLifecyclePanel({
  employee,
  canEdit,
  onUpdated,
}: {
  employee: Emp;
  canEdit?: boolean;
  onUpdated?: () => void;
}) {
  const month = useAppStore((s) => s.month);
  const qc = useQueryClient();
  const { path } = useCompanyScope();
  const id = String(employee.id);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [departOpen, setDepartOpen] = useState(false);
  const [releaseConfirm, setReleaseConfirm] = useState(false);
  const [changeIdOpen, setChangeIdOpen] = useState(false);
  const [promoteForm, setPromoteForm] = useState({
    leadRole: "TL",
    newId: "",
    position: "",
    team: String(employee.team || ""),
    effectiveFromMonth: month,
    enforcePrefix: true,
  });
  const [departForm, setDepartForm] = useState<DepartFormState>(defaultDepartForm());
  const [newAppId, setNewAppId] = useState(String(employee.id));

  const { data: rates } = useQuery({
    queryKey: ["position-rates-lifecycle"],
    queryFn: () => api<{ rates: { position: string }[] }>(`/position-rates?month=${month}`),
    enabled: promoteOpen,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["employees-list"] });
    onUpdated?.();
  };

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const contentBase64 = await fileToBase64(file);
      return api(path(`/employees/${id}/profile-photo`), {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentBase64 }),
      });
    },
    onSuccess: invalidate,
  });

  const removePhoto = useMutation({
    mutationFn: () => api(path(`/employees/${id}/profile-photo`), { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const promote = useMutation({
    mutationFn: () =>
      api(path(`/employees/${id}/promote`), { method: "POST", body: JSON.stringify(promoteForm) }),
    onSuccess: () => { setPromoteOpen(false); invalidate(); },
  });

  const depart = useMutation({
    mutationFn: () =>
      api(path(`/hrms/employment-periods/${id}/depart`), {
        method: "POST",
        body: JSON.stringify(departRequestBody(departForm)),
      }),
    onSuccess: () => {
      setDepartOpen(false);
      invalidate();
      qc.invalidateQueries({ queryKey: ["attendance-grid"] });
    },
  });

  const revertPromotion = useMutation({
    mutationFn: () => api(path(`/employees/${id}/revert-promotion`), { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });

  const changeAppId = useMutation({
    mutationFn: () =>
      api(path(`/employees/${id}/change-app-id`), {
        method: "POST",
        body: JSON.stringify({ newId: newAppId, enforcePrefix: true }),
      }),
    onSuccess: () => { setChangeIdOpen(false); invalidate(); },
  });

  const releaseId = useMutation({
    mutationFn: () => api(path(`/employees/${id}/release-app-id`), { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });

  const photoUrl = `/api/employees/${id}/avatar`;

  return (
    <div className={styles.panel}>
      <div className={styles.photoBlock}>
        <img
          src={employee.profile_photo_file_id ? photoUrl : "/img/hr-team.png"}
          alt=""
          className={styles.photo}
          onError={(e) => { (e.target as HTMLImageElement).src = "/img/hr-team.png"; }}
        />
        {canEdit && (
          <div className={styles.photoActions}>
            <label className={styles.uploadLabel}>
              Upload photo
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto.mutate(f);
                }}
              />
            </label>
            {employee.profile_photo_file_id && (
              <Button size="sm" variant="danger" onClick={() => removePhoto.mutate()}>Remove</Button>
            )}
          </div>
        )}
      </div>

      {employee.promoted_from_id && (
        <p className="muted">Promoted from <strong>{String(employee.promoted_from_id)}</strong></p>
      )}
      {employee.promoted_to_id && (
        <p className="muted">Active record: <strong>{String(employee.promoted_to_id)}</strong></p>
      )}

      {canEdit && (
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={() => setPromoteOpen(true)}>Reposition / promote</Button>
          <Button size="sm" variant="secondary" onClick={() => setDepartOpen(true)}>Mark depart</Button>
          <Button size="sm" variant="secondary" onClick={() => setChangeIdOpen(true)}>Change app ID</Button>
          {employee.promoted_from_id && !employee.promoted_to_id && (
            <Button size="sm" variant="secondary" onClick={() => revertPromotion.mutate()}>Revert promotion</Button>
          )}
          <Button size="sm" variant="danger" onClick={() => setReleaseConfirm(true)}>Release app ID</Button>
        </div>
      )}

      <div className={styles.exports}>
        <h4>Exports</h4>
        <div className={styles.exportBtns}>
          <Button size="sm" variant="outline" onClick={() => downloadApiFile(`/employees/${id}/attendance-summary?format=csv`, `attendance-${id}.csv`)}>Attendance CSV</Button>
          <Button size="sm" variant="outline" onClick={() => downloadApiFile(`/employees/${id}/attendance-summary?format=pdf`, `attendance-${id}.pdf`)}>Attendance PDF</Button>
          <Button size="sm" variant="outline" onClick={() => downloadApiFile(`/payslip/${id}/pdf?month=${month}`, `payslip-${id}-${month}.pdf`)}>Payslip PDF</Button>
        </div>
      </div>

      {canEdit && <EmployeeHrmsLifecycle employee={employee} canEdit={canEdit} focus="all" onUpdated={onUpdated} />}

      <Dialog open={promoteOpen} onOpenChange={setPromoteOpen} title="Reposition employee" wide footer={
        <>
          <Button variant="secondary" onClick={() => setPromoteOpen(false)}>Cancel</Button>
          <Button onClick={() => promote.mutate()} disabled={!promoteForm.newId}>Reposition</Button>
        </>
      }>
        <p className="muted">Agent ID <strong>{id}</strong> stays for history. New leadership ID applies from effective month.</p>
        <FormGrid wide>
          <FormField label="Lead role">
            <select value={promoteForm.leadRole} onChange={(e) => setPromoteForm({ ...promoteForm, leadRole: e.target.value })}>
              {LEAD_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </FormField>
          <FormField label="New ID">
            <input value={promoteForm.newId} onChange={(e) => setPromoteForm({ ...promoteForm, newId: e.target.value })} placeholder="TL04" />
          </FormField>
          <FormField label="Position">
            <select value={promoteForm.position} onChange={(e) => setPromoteForm({ ...promoteForm, position: e.target.value })}>
              <option value="">—</option>
              {(rates?.rates || []).map((r) => <option key={r.position} value={r.position}>{r.position}</option>)}
            </select>
          </FormField>
          <FormField label="Team">
            <input value={promoteForm.team} onChange={(e) => setPromoteForm({ ...promoteForm, team: e.target.value })} />
          </FormField>
          <FormField label="Effective from month">
            <input type="month" value={promoteForm.effectiveFromMonth} onChange={(e) => setPromoteForm({ ...promoteForm, effectiveFromMonth: e.target.value })} />
          </FormField>
        </FormGrid>
      </Dialog>

      <DepartDateDialog
        open={departOpen}
        onOpenChange={(o) => {
          setDepartOpen(o);
          if (o) setDepartForm(defaultDepartForm());
        }}
        form={departForm}
        onFormChange={setDepartForm}
        onConfirm={() => {
          if (!depart.isPending) depart.mutate();
        }}
        isPending={depart.isPending}
      />

      <ConfirmDialog
        open={releaseConfirm}
        onOpenChange={setReleaseConfirm}
        title="Release this app ID?"
        message="History stays in the database; the ID can be reused."
        danger
        confirmLabel="Release"
        onConfirm={() => releaseId.mutate()}
      />

      <Dialog open={changeIdOpen} onOpenChange={setChangeIdOpen} title="Change app ID" footer={
        <>
          <Button variant="secondary" onClick={() => setChangeIdOpen(false)}>Cancel</Button>
          <Button onClick={() => changeAppId.mutate()}>Save ID</Button>
        </>
      }>
        <FormField label="New app ID">
          <input value={newAppId} onChange={(e) => setNewAppId(e.target.value)} />
        </FormField>
      </Dialog>
    </div>
  );
}
