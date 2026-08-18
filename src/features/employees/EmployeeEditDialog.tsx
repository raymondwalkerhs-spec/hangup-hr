import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { FormField, FormGrid, FormSection } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import { EmployeeLifecyclePanel } from "./EmployeeLifecyclePanel";
import { DepartDateDialog } from "./DepartDateDialog";
import {
  defaultDepartForm,
  departRequestBody,
  isOutEmployeeStatus,
  statusToDepartApiKey,
  type DepartFormState,
} from "@/lib/employeeStatus";
import { normalizePaymentMethod, PAYMENT_METHOD_OPTIONS } from "@/lib/paymentMethods";
import { companyForUnit, companyLabel } from "@/lib/companyUnit";
import styles from "./EmployeeEditDialog.module.css";

type Emp = Record<string, unknown>;

const NATIONALITIES = ["Egyptian", "Sudanese", "Other"];
const WORK_PERMIT = [
  { value: "", label: "—" },
  { value: "have_permit", label: "Have permit" },
  { value: "no_permit", label: "No permit" },
];
const INSURANCE = [
  { value: "", label: "—" },
  { value: "insured", label: "Insured" },
  { value: "not_insured", label: "Not insured" },
];

function toForm(emp: Emp): Record<string, string> {
  return {
    american_name: String(emp.american_name || ""),
    arabic_name: String(emp.arabic_name || ""),
    status: String(emp.status || "Active"),
    unit: String(emp.unit || ""),
    team: String(emp.team || ""),
    position: String(emp.position || ""),
    payment_method: normalizePaymentMethod(emp.payment_method || emp.paymentMethod),
    payment_details_insta_wallet: String(
      emp.payment_details_insta_wallet || emp.instapay_phone || ""
    ),
    alternative_payment: String(emp.alternative_payment || emp.cash_branch || ""),
    bank_refrence_number: String(emp.bank_refrence_number || emp.bank_reference_number || ""),
    bank_name_as_bank_sheet: String(emp.bank_name_as_bank_sheet || ""),
    phone: String(emp.phone || ""),
    email: String(emp.email || ""),
    employment_date: String(emp.employment_date || "").slice(0, 10),
    probation_end_date: String(emp.probation_end_date || "").slice(0, 10),
    contract_end_date: String(emp.contract_end_date || "").slice(0, 10),
    fp_number: String(emp.fp_number || emp.fpNumber || ""),
    nationality: String(emp.nationality || ""),
    nationality_other: String(emp.nationality_other || ""),
    work_permit_status: String(emp.work_permit_status || ""),
    social_insurance_status: String(emp.social_insurance_status || ""),
    social_insurance_details: String(emp.social_insurance_details || ""),
    national_id: String(emp.national_id || ""),
    passport_id: String(emp.passport_id || ""),
    payroll_exempt: emp.payroll_exempt ? "1" : "",
    sales_mla_enabled: emp.sales_mla_enabled === true || emp.salesMlaEnabled === true ? "1" : "",
    sales_rpm_enabled: emp.sales_rpm_enabled === true || emp.salesRpmEnabled === true ? "1" : "",
  };
}

export function EmployeeEditDialog({
  employee,
  meta,
  open,
  onOpenChange,
  canEdit,
}: {
  employee: Emp | null;
  meta?: {
    statuses?: string[];
    units?: string[];
    teams?: string[];
    positions?: string[];
    nationalities?: string[];
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit?: boolean;
}) {
  const qc = useQueryClient();
  const { path } = useCompanyScope();
  const [tab, setTab] = useState("identity");
  const [form, setForm] = useState<Record<string, string>>({});
  const [departOpen, setDepartOpen] = useState(false);
  const [departForm, setDepartForm] = useState<DepartFormState>(defaultDepartForm());
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);
  const [pendingUnit, setPendingUnit] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const emp = employee;

  useEffect(() => {
    if (!open || !emp) return;
    setForm(toForm(emp));
    setTab("identity");
    setPendingUnit(null);
    setFormError("");
  }, [open, emp]);

  const statuses = meta?.statuses || ["Active", "Out", "Deleted"];
  const units = meta?.units || [];
  const positions = meta?.positions || [];
  const nationalities = meta?.nationalities?.length ? meta.nationalities : NATIONALITIES;
  const originalUnit = String(emp?.unit || "");
  const originalTeam = String(emp?.team || "");
  const originalCompany = companyForUnit(originalUnit);
  const nextCompany = companyForUnit(form.unit);
  const companyChanged = Boolean(form.unit && originalUnit && originalCompany !== nextCompany);

  const { data: unitTeamsData } = useQuery({
    queryKey: ["meta-teams", form.unit],
    queryFn: () => api<{ teams?: string[] }>(path("/meta/teams", { unit: form.unit })),
    enabled: Boolean(open && form.unit),
  });
  const unitTeams = unitTeamsData?.teams?.length ? unitTeamsData.teams : [];

  useEffect(() => {
    if (!form.unit || !form.team || !unitTeamsData) return;
    if (!unitTeams.length) return;
    const ok = unitTeams.some((t) => t.toLowerCase() === String(form.team || "").toLowerCase());
    if (!ok) setForm((f) => ({ ...f, team: "" }));
  }, [form.unit, form.team, unitTeams, unitTeamsData]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(path(`/employees/${emp?.id}`), {
        method: "PUT",
        body: JSON.stringify({
          ...body,
          payroll_exempt: body.payroll_exempt === true || body.payroll_exempt === "1",
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees-list"] });
      qc.invalidateQueries({ queryKey: ["attendance-grid"] });
      qc.invalidateQueries({ queryKey: ["payroll-full"] });
      onOpenChange(false);
    },
  });

  const departAndSave = useMutation({
    mutationFn: async () => {
      if (!emp?.id) throw new Error("Employee not found");
      await api(path(`/hrms/employment-periods/${emp.id}/depart`), {
        method: "POST",
        body: JSON.stringify(departRequestBody(departForm)),
      });
      if (pendingBody) {
        const { status: _status, ...rest } = pendingBody;
        await api(path(`/employees/${emp.id}`), {
          method: "PUT",
          body: JSON.stringify({
            ...rest,
            payroll_exempt: rest.payroll_exempt === true || rest.payroll_exempt === "1",
          }),
        });
      }
    },
    onSuccess: () => {
      setDepartOpen(false);
      setPendingBody(null);
      qc.invalidateQueries({ queryKey: ["employees-list"] });
      qc.invalidateQueries({ queryKey: ["attendance-grid"] });
      onOpenChange(false);
    },
  });

  if (!emp) return null;

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const pm = form.payment_method;

  const buildBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = { ...form };
    if (form.nationality === "Other" && form.nationality_other) {
      body.nationality = form.nationality_other;
    }
    delete body.nationality_other;
    body.payment_method = normalizePaymentMethod(body.payment_method) || "";
    body.sales_mla_enabled = body.sales_mla_enabled === true || body.sales_mla_enabled === "1";
    body.sales_rpm_enabled = body.sales_rpm_enabled === true || body.sales_rpm_enabled === "1";
    return body;
  };

  const applyUnit = (next: string) => {
    setForm((f) => ({ ...f, unit: next, team: next === f.unit ? f.team : "" }));
    setFormError("");
  };

  const onUnitChange = (next: string) => {
    if (!canEdit) return;
    const fromCo = companyForUnit(form.unit || originalUnit);
    const toCo = companyForUnit(next);
    if (next && fromCo !== toCo) {
      setPendingUnit(next);
      return;
    }
    applyUnit(next);
  };

  const submit = () => {
    if (companyChanged && !String(form.team || "").trim()) {
      setFormError(`Choose a ${companyLabel(nextCompany)} team before saving`);
      return;
    }
    if (companyChanged && originalTeam && form.team === originalTeam) {
      setFormError("Choose a different team for the new company");
      return;
    }
    if (unitTeams.length && form.team) {
      const ok = unitTeams.some((t) => t.toLowerCase() === String(form.team).toLowerCase());
      if (!ok) {
        setFormError("Choose a team that belongs to this unit");
        return;
      }
    }
    const body = buildBody();
    const markingOut = isOutEmployeeStatus(String(body.status)) && !isOutEmployeeStatus(String(emp.status));
    if (markingOut) {
      setPendingBody(body);
      setDepartForm(
        defaultDepartForm(statusToDepartApiKey(String(body.status)))
      );
      setDepartOpen(true);
      return;
    }
    save.mutate(body);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${canEdit ? "Edit" : "View"} — ${String(emp.american_name || emp.id)}`}
      size="wide"
      scrollBody
      footer={
        canEdit ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={save.isPending}>Save</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
        )
      }
    >
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className={styles.tabs}>
          <Tabs.Trigger value="identity" className={styles.tab}>Identity</Tabs.Trigger>
          <Tabs.Trigger value="contact" className={styles.tab}>Contact & dates</Tabs.Trigger>
          <Tabs.Trigger value="payroll" className={styles.tab}>Payroll</Tabs.Trigger>
          <Tabs.Trigger value="lifecycle" className={styles.tab}>Lifecycle</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="identity" className={styles.panel}>
          <FormGrid wide>
            <FormField label="App ID"><input value={String(emp.id)} readOnly /></FormField>
            {emp.internal_id != null && (
              <FormField label="Database ID (permanent)"><input value={String(emp.internal_id)} readOnly /></FormField>
            )}
            <FormField label="American name">
              <input value={form.american_name || ""} onChange={(e) => set("american_name", e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="Arabic name">
              <input value={form.arabic_name || ""} onChange={(e) => set("arabic_name", e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="Status">
              <Select
                value={form.status || ""}
                onChange={(v) => set("status", v)}
                disabled={!canEdit}
                options={statuses.map((s) => ({ value: s, label: s || "(blank)" }))}
              />
            </FormField>
            <FormField label="Unit">
              <Select
                value={form.unit || ""}
                onChange={(v) => onUnitChange(v)}
                disabled={!canEdit}
                options={units.map((u) => ({ value: u, label: u }))}
              />
            </FormField>
            <FormField label="Team">
              <Select
                value={form.team || ""}
                onChange={(v) => set("team", v)}
                disabled={!canEdit}
                options={[
                  { value: "", label: companyChanged ? "Choose a team in the new company" : "—" },
                  ...unitTeams.map((t) => ({ value: t, label: t })),
                  ...(form.team && !unitTeams.some((t) => t.toLowerCase() === form.team.toLowerCase())
                    ? [{ value: form.team, label: form.team }]
                    : []),
                ]}
              />
            </FormField>
            {companyChanged && (
              <p className={styles.warn} style={{ gridColumn: "1 / -1" }}>
                This moves {String(emp.american_name || emp.id)} from {companyLabel(originalCompany)} to {companyLabel(nextCompany)}.
                Pick a {companyLabel(nextCompany)} team before saving.
              </p>
            )}
            {formError && <p className={styles.warn} style={{ gridColumn: "1 / -1", color: "var(--err)" }}>{formError}</p>}
            <FormField label="Position">
              <Select
                value={form.position || ""}
                onChange={(v) => set("position", v)}
                disabled={!canEdit}
                options={[{ value: "", label: "—" }, ...positions.map((p) => ({ value: p, label: p }))]}
              />
            </FormField>
            <FormField label="Payment method">
              <Select
                value={form.payment_method || ""}
                onChange={(v) => set("payment_method", v)}
                disabled={!canEdit}
                options={[{ value: "", label: "—" }, ...PAYMENT_METHOD_OPTIONS]}
              />
            </FormField>
            {pm === "instapay" && (
              <FormField label="Instapay / wallet details">
                <input
                  value={form.payment_details_insta_wallet || ""}
                  onChange={(e) => set("payment_details_insta_wallet", e.target.value)}
                  disabled={!canEdit}
                  placeholder="Phone, username, or wallet ID"
                />
              </FormField>
            )}
            {pm === "cash" && (
              <FormField label="Cash branch">
                <Select
                  value={form.alternative_payment || ""}
                  onChange={(v) => set("alternative_payment", v)}
                  disabled={!canEdit}
                  options={[{ value: "", label: "—" }, ...["Makram", "Abbas", "Square", "Other"].map((b) => ({ value: b, label: b }))]}
                />
              </FormField>
            )}
            {pm === "bank" && (
              <>
                <FormField label="Bank reference">
                  <input value={form.bank_refrence_number || ""} onChange={(e) => set("bank_refrence_number", e.target.value)} disabled={!canEdit} />
                </FormField>
                <FormField label="Bank name (as on sheet)">
                  <input value={form.bank_name_as_bank_sheet || ""} onChange={(e) => set("bank_name_as_bank_sheet", e.target.value)} disabled={!canEdit} />
                </FormField>
              </>
            )}
          </FormGrid>
          <div style={{ marginTop: "1rem" }}>
          <FormSection title="Sales programs">
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={!!form.sales_mla_enabled}
                onChange={(e) => set("sales_mla_enabled", e.target.checked ? "1" : "")}
                disabled={!canEdit}
              />
              <span>MLA sales enabled</span>
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={!!form.sales_rpm_enabled}
                onChange={(e) => set("sales_rpm_enabled", e.target.checked ? "1" : "")}
                disabled={!canEdit}
              />
              <span>RPM sales enabled</span>
            </label>
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Controls whether this employee can be assigned as agent on MLA or RPM sales.
            </p>
          </FormSection>
          </div>
        </Tabs.Content>

        <Tabs.Content value="contact" className={styles.panel}>
          <FormGrid wide>
            <FormField label="Phone">
              <input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="Email">
              <input type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="Employment date">
              <input type="date" value={form.employment_date || ""} onChange={(e) => set("employment_date", e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="Probation end">
              <input type="date" value={form.probation_end_date || ""} onChange={(e) => set("probation_end_date", e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="Contract end">
              <input type="date" value={form.contract_end_date || ""} onChange={(e) => set("contract_end_date", e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="FP number (biometric)">
              <input value={form.fp_number || ""} onChange={(e) => set("fp_number", e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="Nationality">
              <Select
                value={form.nationality || ""}
                onChange={(v) => set("nationality", v)}
                disabled={!canEdit}
                options={[
                  { value: "", label: "—" },
                  ...nationalities.map((n) => ({ value: n, label: n })),
                  { value: "Other", label: "Other" },
                ]}
              />
            </FormField>
            {form.nationality === "Other" && (
              <FormField label="Nationality (other)">
                <input value={form.nationality_other || ""} onChange={(e) => set("nationality_other", e.target.value)} disabled={!canEdit} />
              </FormField>
            )}
            <FormField label="Work permit">
              <Select
                value={form.work_permit_status || ""}
                onChange={(v) => set("work_permit_status", v)}
                disabled={!canEdit}
                options={WORK_PERMIT}
              />
            </FormField>
            <FormField label="Social insurance">
              <Select
                value={form.social_insurance_status || ""}
                onChange={(v) => set("social_insurance_status", v)}
                disabled={!canEdit}
                options={INSURANCE}
              />
            </FormField>
            <FormField label="Insurance details" span="full">
              <input value={form.social_insurance_details || ""} onChange={(e) => set("social_insurance_details", e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="National ID">
              <input value={form.national_id || ""} onChange={(e) => set("national_id", e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="Passport ID">
              <input value={form.passport_id || ""} onChange={(e) => set("passport_id", e.target.value)} disabled={!canEdit} />
            </FormField>
          </FormGrid>
        </Tabs.Content>

        <Tabs.Content value="payroll" className={styles.panel}>
          <FormSection title="Payroll settings">
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={!!form.payroll_exempt}
                onChange={(e) => set("payroll_exempt", e.target.checked ? "1" : "")}
                disabled={!canEdit}
              />
              <span>Never pay (trial / test employee)</span>
            </label>
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              Month-specific salary, bonuses, and deductions are edited from the Payroll tab payslip editor.
            </p>
          </FormSection>
        </Tabs.Content>

        <Tabs.Content value="lifecycle" className={styles.panel}>
          <EmployeeLifecyclePanel employee={emp} canEdit={canEdit} onUpdated={() => qc.invalidateQueries({ queryKey: ["employees-list"] })} />
        </Tabs.Content>
      </Tabs.Root>
      <Dialog
        open={Boolean(pendingUnit)}
        onOpenChange={(next) => !next && setPendingUnit(null)}
        title="Move to another company?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingUnit(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (pendingUnit) applyUnit(pendingUnit);
                setPendingUnit(null);
              }}
            >
              Continue
            </Button>
          </>
        }
      >
        <p>
          {String(emp.american_name || emp.id)} will move from{" "}
          <strong>{companyLabel(companyForUnit(form.unit || originalUnit))}</strong> to{" "}
          <strong>{companyLabel(companyForUnit(pendingUnit || ""))}</strong>.
        </p>
        <p>You must choose a team in the new company before saving. The current team will be cleared.</p>
      </Dialog>
      <DepartDateDialog
        open={departOpen}
        onOpenChange={(next) => {
          setDepartOpen(next);
          if (!next) setPendingBody(null);
        }}
        title="Mark depart"
        subtitle={`Setting status to ${form.status || "Out"} requires a depart date. Skip to use today, or pick a date below.`}
        form={departForm}
        onFormChange={setDepartForm}
        onConfirm={() => departAndSave.mutate()}
        confirmLabel="Save depart"
        isPending={departAndSave.isPending}
      />
      {(save.isError || departAndSave.isError) && (
        <p style={{ color: "var(--err)", marginTop: "0.5rem" }}>
          {((save.error || departAndSave.error) as Error).message}
        </p>
      )}
    </Dialog>
  );
}
