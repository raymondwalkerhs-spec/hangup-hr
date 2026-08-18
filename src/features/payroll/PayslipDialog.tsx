import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fmt } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Dialog, ConfirmDialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { FormField, FormGrid, FormSection } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import { useConfirmUndo } from "@/ui/useDeferredDelete";
import { downloadApiFile, shiftMonth } from "@/lib/files";
import { normalizePaymentMethod, PAYMENT_METHOD_OPTIONS, resolvePaymentMethod } from "@/lib/paymentMethods";
import { isPayrollSettled, payrollEarnedNet, settledLabel, isTrainingDeferredRow, trainingDeferredLabel } from "@/lib/payrollSettled";
import { noticeTypeLabel } from "@/lib/employeeStatus";
import { getTrainingPayBreakdown } from "@/lib/trainingPayBreakdown";
import styles from "./PayslipDialog.module.css";

const TL_BONUS_TYPE = "Bonus from TL / OP";

function isLeadershipEmployeeId(id: string) {
  return /^(TL|CL|OP|HR|RTM)/i.test(String(id || "").trim());
}

type Split = {
  id: string;
  amount: number;
  status: string;
  splitKind?: string;
  deferToMonth?: string;
  notes?: string;
};

type Loan = {
  id: string;
  totalAmount: number;
  installmentAmount?: number;
  installmentsCount?: number;
  installmentsPaid?: number;
  status: string;
  startYearMonth?: string;
  skipCurrentMonth?: boolean;
  notes?: string;
};

type SlipTab = "training" | "agent" | "combined";

type ExtraPayrollEntry = {
  id: string;
  label?: string;
  workingDays?: number;
  dailyRate?: number;
  netAmount?: number;
};

type TrainingPayMonthLine = {
  ym: string;
  label: string;
  units: number;
  basic: number;
  transport: number;
  transportDays?: number;
  net: number;
  phase1Exception?: boolean;
  days?: { date: string; status: string }[];
};

type Props = {
  employeeId: string | null;
  employeeName?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  monthOverride?: string;
  slipKind?: "agent" | "training";
};

function slipForKind(root: Record<string, unknown>, tab: SlipTab | null, data?: Record<string, unknown>) {
  const isDual = root.payrollKind === "dual" || data?.payrollKind === "dual";
  if (!isDual) return root;
  if (tab === "agent") return (root.agent || data?.agentPayslip || root) as Record<string, unknown>;
  if (tab === "combined") return root;
  return (root.training || data?.trainingPayslip || root) as Record<string, unknown>;
}

function numOrNull(v: string | boolean | undefined): number | null {
  if (v === "" || v == null || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatShortDay(date: string) {
  const [y, m, d] = date.split("-");
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(dt.getTime())) return date;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTrainingDays(days: { date: string; status: string }[] | undefined) {
  if (!days?.length) return null;
  return days.map((d) => `${formatShortDay(d.date)} (${d.status})`).join(" · ");
}

export function PayslipDialog({ employeeId, employeeName, open, onOpenChange, monthOverride, slipKind }: Props) {
  const storeMonth = useAppStore((s) => s.month);
  const month = monthOverride || storeMonth;
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [profile, setProfile] = useState<Record<string, string | boolean>>({});
  const [slipTab, setSlipTab] = useState<SlipTab>("combined");
  const profileHydratedFor = useRef("");
  const profileEditing = useRef(false);
  const [bonusForm, setBonusForm] = useState({ type: "", amount: "", date: "", reason: "", deductFromEmployeeId: "" });
  const [dedForm, setDedForm] = useState({ type: "", amount: "", date: "", reason: "" });
  const [splitForm, setSplitForm] = useState({
    amount: "",
    splitKind: "payment",
    status: "pending",
    deferToMonth: "",
    notes: "",
  });
  const [loanForm, setLoanForm] = useState({
    totalAmount: "",
    installmentAmount: "",
    installmentsCount: "",
    skipCurrentMonth: false,
    notes: "",
  });
  const undo = useConfirmUndo();
  const [extraForm, setExtraForm] = useState({
    label: "",
    workingDays: "",
    dailyRate: "",
    netAmount: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["payslip-bundle", employeeId, month, slipKind || "", companyContext],
    queryFn: () =>
      api<Record<string, unknown>>(
        path(`/payroll/${employeeId}`, {
          month,
          ...(slipKind ? { kind: slipKind } : {}),
        })
      ),
    enabled: open && !!employeeId,
  });

  const { data: loanData } = useQuery({
    queryKey: ["emp-loans", employeeId, companyContext],
    queryFn: () => api<{ loans?: Loan[] }>(path("/loans", { employeeId: employeeId! })),
    enabled: open && !!employeeId,
  });

  const { data: bonusTypes } = useQuery({
    queryKey: ["bonus-types", month, companyContext],
    queryFn: () => api<{ types: string[] }>(path("/bonuses", { month })),
    enabled: open,
  });

  const { data: dedTypes } = useQuery({
    queryKey: ["deduction-types", month, companyContext],
    queryFn: () => api<{ types: string[] }>(path("/deductions", { month })),
    enabled: open,
  });

  const { data: empList } = useQuery({
    queryKey: ["employees-payslip-bonus", companyContext],
    queryFn: () => api<{ employees: { id: string; american_name?: string }[] }>(path("/employees")),
    enabled: open,
  });

  const tlPayers = useMemo(
    () => (empList?.employees || []).filter((e) => isLeadershipEmployeeId(e.id) && e.id !== employeeId),
    [empList?.employees, employeeId]
  );
  const isTlBonusForm = bonusForm.type === TL_BONUS_TYPE;

  const rootSlip = (data?.payslip || {}) as Record<string, unknown>;
  const slipEmployee = (data?.employee as Record<string, unknown>) || {};
  const leavingNoticeType = String(slipEmployee.notice_type || "");
  const departDate = String(slipEmployee.depart_date || "").slice(0, 10);
  const leavingThisMonth = departDate.startsWith(month);

  const { data: noticeSales } = useQuery({
    queryKey: ["notice-sales-preview", employeeId, departDate, companyContext],
    queryFn: () =>
      api<{
        passedSalesInNotice: number;
        payPercent: number;
        previewNote?: string;
        meetsMinimum?: boolean;
      }>(path(`/hrms/resignation/${employeeId}/notice-sales-preview`, { departDate })),
    enabled: open && !!employeeId && leavingThisMonth && leavingNoticeType === "with_notice" && !!departDate,
  });

  const applyNoticeScale = useMutation({
    mutationFn: (passedSalesInNotice: number) =>
      api(path(`/hrms/resignation/${employeeId}/notice-pay-scale`), {
        method: "POST",
        body: JSON.stringify({ month, passedSalesInNotice }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslip-bundle", employeeId, month] });
      qc.invalidateQueries({ queryKey: ["payroll-full", month] });
    },
  });
  const isDual = data?.payrollKind === "dual" || rootSlip.payrollKind === "dual";
  const activeSlip = useMemo(() => slipForKind(rootSlip, isDual ? slipTab : null, data), [rootSlip, isDual, slipTab, data]);

  useEffect(() => {
    if (!open) return;
    if (slipKind === "agent") setSlipTab("agent");
    else if (slipKind === "training") setSlipTab("training");
    else setSlipTab("combined");
  }, [employeeId, open, slipKind]);

  useEffect(() => {
    if (!open) {
      profileHydratedFor.current = "";
      profileEditing.current = false;
    }
  }, [open, employeeId, month]);

  useEffect(() => {
    if (!data?.payslip) return;
    const hydrateKey = `${employeeId}|${month}|${slipKind || ""}`;
    if (profileHydratedFor.current === hydrateKey && profileEditing.current) return;
    const adj = (data.adjustment as Record<string, unknown>) || {};
    const emp = (data.employee as Record<string, unknown>) || {};
    const slip = data.payslip as Record<string, unknown>;
    setProfile({
      position: String(adj.position || slip.position || ""),
      salaryRaise: String(adj.salaryRaise ?? ""),
      monthlySalaryOverride: adj.monthlySalaryOverride != null ? String(adj.monthlySalaryOverride) : "",
      netSalaryOverride: adj.netSalaryOverride != null ? String(adj.netSalaryOverride) : "",
      trainingNetSalaryOverride: adj.trainingNetSalaryOverride != null ? String(adj.trainingNetSalaryOverride) : "",
      agentNetSalaryOverride: adj.agentNetSalaryOverride != null ? String(adj.agentNetSalaryOverride) : "",
      trainingPayrollPaid: adj.trainingPayrollPaid === true,
      trainingPhase1PayException: adj.trainingPhase1PayException === true,
      trainingPayrollAnchorMonthOverride: String(adj.trainingPayrollAnchorMonthOverride || "").slice(0, 7),
      paymentMethod: resolvePaymentMethod(emp, adj) || normalizePaymentMethod(slip.paymentMethod),
      payrollStatus: String(adj.payrollStatus || slip.status || "pending"),
      extraDays: String(adj.extraDays ?? ""),
      transportEligible: adj.transportEligible === true,
      noPayroll: adj.noPayroll === true,
      payslipVisibleToAgent: adj.payslipVisibleToAgent === true,
      fullTransportGrant: adj.fullTransportGrant === true,
      salesCount: String(adj.salesCount ?? slip.salesCount ?? ""),
      monthNotes: String(adj.monthNotes || ""),
      bankReference: String(adj.bankReference || ""),
      twoWeekHold: adj.twoWeekHold === true,
    });
    profileHydratedFor.current = hydrateKey;
    profileEditing.current = false;
  }, [data, employeeId, month, slipKind]);

  const saveProfile = useMutation({
    mutationFn: () =>
      api(path(`/payroll-adjustments/${employeeId}`), {
        method: "PUT",
        body: JSON.stringify({
          yearMonth: month,
          position: profile.position,
          salaryRaise: Number(profile.salaryRaise) || 0,
          monthlySalaryOverride: numOrNull(profile.monthlySalaryOverride as string),
          netSalaryOverride: numOrNull(profile.netSalaryOverride as string),
          trainingNetSalaryOverride: numOrNull(profile.trainingNetSalaryOverride as string),
          agentNetSalaryOverride: numOrNull(profile.agentNetSalaryOverride as string),
          trainingPayrollPaid: profile.trainingPayrollPaid === true,
          trainingPhase1PayException: profile.trainingPhase1PayException === true,
          trainingPayrollAnchorMonthOverride: String(profile.trainingPayrollAnchorMonthOverride || "").slice(0, 7),
          paymentMethod: profile.paymentMethod,
          payrollStatus: profile.payrollStatus,
          extraDays: Number(profile.extraDays) || 0,
          transportEligible: profile.transportEligible === true,
          noPayroll: profile.noPayroll === true,
          payslipVisibleToAgent: profile.payslipVisibleToAgent === true,
          fullTransportGrant: profile.fullTransportGrant === true,
          salesCount: Number(profile.salesCount) || 0,
          monthNotes: profile.monthNotes,
          bankReference: profile.bankReference,
          twoWeekHold: profile.twoWeekHold === true,
        }),
      }),
    onSuccess: () => {
      profileEditing.current = false;
      qc.invalidateQueries({ queryKey: ["payslip-bundle", employeeId, month] });
      qc.invalidateQueries({ queryKey: ["payroll-full", month] });
      qc.invalidateQueries({ queryKey: ["employees-list"] });
    },
  });

  const addBonus = useMutation({
    mutationFn: () =>
      api(path("/bonuses"), {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          type: bonusForm.type || "Other Bonus",
          amount: Number(bonusForm.amount),
          date: bonusForm.date || `${month}-01`,
          reason: bonusForm.reason,
          deductFromEmployeeId:
            bonusForm.type === TL_BONUS_TYPE ? bonusForm.deductFromEmployeeId || undefined : undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslip-bundle", employeeId, month] });
      setBonusForm({ type: "", amount: "", date: "", reason: "", deductFromEmployeeId: "" });
    },
  });

  const addDeduction = useMutation({
    mutationFn: () =>
      api(path("/deductions"), {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          type: dedForm.type || "Other Deductions",
          amount: Number(dedForm.amount),
          date: dedForm.date || `${month}-01`,
          reason: dedForm.reason,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslip-bundle", employeeId, month] });
      setDedForm({ type: "", amount: "", date: "", reason: "" });
    },
  });

  const recalcSales = useMutation({
    mutationFn: () =>
      api(path(`/payroll-adjustments/${employeeId}/recalc-sales-count`), {
        method: "POST",
        body: JSON.stringify({ yearMonth: month }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payslip-bundle", employeeId, month] }),
  });

  const addSplit = useMutation({
    mutationFn: () =>
      api(path("/payroll-splits"), {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          yearMonth: month,
          amount: Number(splitForm.amount),
          splitKind: splitForm.splitKind,
          status: splitForm.status,
          deferToMonth: splitForm.status === "deferred" ? splitForm.deferToMonth || shiftMonth(month, 1) : "",
          notes: splitForm.notes,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslip-bundle", employeeId, month] });
      setSplitForm({ amount: "", splitKind: "payment", status: "pending", deferToMonth: shiftMonth(month, 1), notes: "" });
    },
  });

  const patchSplit = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(path(`/payroll-splits/${id}`), { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payslip-bundle", employeeId, month] }),
  });

  const deleteSplit = useMutation({
    mutationFn: (id: string) => api(path(`/payroll-splits/${id}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payslip-bundle", employeeId, month] }),
  });

  const addLoan = useMutation({
    mutationFn: () =>
      api(path("/loans"), {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          totalAmount: Number(loanForm.totalAmount),
          installmentAmount: loanForm.installmentAmount ? Number(loanForm.installmentAmount) : undefined,
          installmentsCount: loanForm.installmentsCount ? Number(loanForm.installmentsCount) : undefined,
          skipCurrentMonth: loanForm.skipCurrentMonth,
          notes: loanForm.notes,
          createdYearMonth: month,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["emp-loans", employeeId] });
      setLoanForm({ totalAmount: "", installmentAmount: "", installmentsCount: "", skipCurrentMonth: false, notes: "" });
    },
  });

  const cancelLoan = useMutation({
    mutationFn: (id: string) => api(path(`/loans/${encodeURIComponent(id)}/cancel`), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emp-loans", employeeId] }),
  });

  const deleteLoan = useMutation({
    mutationFn: (id: string) => api(path(`/loans/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emp-loans", employeeId] }),
  });

  const addExtraPayroll = useMutation({
    mutationFn: () =>
      api(path(`/payroll-extra/${employeeId}/${month}`), {
        method: "POST",
        body: JSON.stringify({
          label: extraForm.label || "Extra",
          workingDays: Number(extraForm.workingDays) || 0,
          dailyRate: Number(extraForm.dailyRate) || 0,
          netAmount: Number(extraForm.netAmount) || 0,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslip-bundle", employeeId, month] });
      qc.invalidateQueries({ queryKey: ["payroll-full", month] });
      setExtraForm({ label: "", workingDays: "", dailyRate: "", netAmount: "" });
    },
  });

  const deleteExtraPayroll = useMutation({
    mutationFn: (id: string) => api(path(`/payroll-extra/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslip-bundle", employeeId, month] });
      qc.invalidateQueries({ queryKey: ["payroll-full", month] });
    },
  });

  useEffect(() => {
    const days = Number(extraForm.workingDays) || 0;
    const rate = Number(extraForm.dailyRate) || 0;
    const net = days * rate;
    if (net > 0) {
      setExtraForm((f) => (f.netAmount === net.toFixed(2) ? f : { ...f, netAmount: net.toFixed(2) }));
    }
  }, [extraForm.workingDays, extraForm.dailyRate]);

  const splits = (data?.splits as Split[]) || [];
  const extraPayroll = (data?.extraPayroll as ExtraPayrollEntry[]) || [];
  const gateNotes = (data?.payslipGateNotes as string[]) || [];
  const bonuses = (data?.bonuses as { type: string; amount: number; date: string; reason?: string }[]) || [];
  const deductions = (data?.deductions as { type: string; amount: number; date: string; reason?: string }[]) || [];
  const loans = loanData?.loans || [];

  const pdfKind = isDual && slipTab !== "combined" ? slipTab : "";
  const pdfUrl = `/payslip/${employeeId}/pdf?month=${month}${pdfKind ? `&kind=${pdfKind}` : ""}`;

  const isTrainingSlip =
    activeSlip.payrollKind === "training" ||
    activeSlip.payrollKind === "training_deferred_month" ||
    (isDual && slipTab === "training");
  const settlementRow = {
    ...rootSlip,
    ...activeSlip,
    payrollStatus: profile.payrollStatus || rootSlip.payrollStatus,
    noPayroll: profile.noPayroll ?? rootSlip.noPayroll,
    trainingPayrollPaid:
      slipTab === "training" || !isDual
        ? profile.trainingPayrollPaid ?? rootSlip.trainingPayrollPaid
        : rootSlip.trainingPayrollPaid,
    payrollKind:
      isDual && slipTab === "training"
        ? "training"
        : isDual && slipTab === "agent"
          ? "agent"
          : rootSlip.payrollKind || activeSlip.payrollKind,
  };
  const slipSettled = isPayrollSettled(settlementRow);
  const slipDeferred = isTrainingDeferredRow(settlementRow);
  const trainingAnchorMonth = String(
    activeSlip.trainingPayrollAnchorMonth || rootSlip.trainingPayrollAnchorMonth || month
  );
  const showTrainingProfile = isDual ? slipTab === "training" : isTrainingSlip || slipDeferred;
  const showAgentProfile = isDual ? slipTab === "agent" : !showTrainingProfile && !isDual;
  const showCombinedProfile = isDual && slipTab === "combined";
  const canEditPhase1Exception = month === trainingAnchorMonth && !slipDeferred;
  const earnedNet = payrollEarnedNet(settlementRow);
  const doneLabel = settledLabel(settlementRow) || "Done";
  const deferredLabel = trainingDeferredLabel(settlementRow);
  const earnedBasic = Number(settlementRow.earnedBasicSalary ?? settlementRow.basicSalary) || 0;
  const slipBonuses = (activeSlip.bonuses || {}) as Record<string, number>;
  const slipDeductions = (activeSlip.deductions || {}) as Record<string, number>;
  const trainingSpanMonths = (activeSlip.trainingSpanMonths ||
    rootSlip.trainingSpanMonths ||
    (rootSlip.training as Record<string, unknown> | undefined)?.trainingSpanMonths) as string[] | undefined;
  const trainingPayBreakdown = getTrainingPayBreakdown({
    ...rootSlip,
    ...activeSlip,
    training: rootSlip.training || data?.trainingPayslip,
  });
  const showTrainingMonthDetail = (trainingPayBreakdown?.months?.length ?? 0) > 0;
  const isTrainingContext = isTrainingSlip || slipDeferred || showTrainingMonthDetail;

  const set = (k: string, v: string | boolean) => {
    profileEditing.current = true;
    setProfile((p) => ({ ...p, [k]: v }));
  };

  function fillTrainingExtra() {
    const rate = Number(activeSlip.dailyRate) || 0;
    const days = Number(activeSlip.totalWorkingDays) || 0;
    setExtraForm({
      label: "Training",
      workingDays: days ? String(days) : "",
      dailyRate: rate ? String(rate) : "",
      netAmount: days && rate ? (days * rate).toFixed(2) : "",
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Payslip — ${employeeName || employeeId}${isDual ? " (Training + Agent)" : ""}`}
      size="wide"
      scrollBody
      footer={
        <>
          {isDual && (
            <>
              <Button variant="outline" size="sm" onClick={() => downloadApiFile(`/payslip/${employeeId}/pdf?month=${month}&kind=training`, `payslip-training-${employeeId}-${month}.pdf`)}>Training PDF</Button>
              <Button variant="outline" size="sm" onClick={() => downloadApiFile(`/payslip/${employeeId}/pdf?month=${month}&kind=agent`, `payslip-agent-${employeeId}-${month}.pdf`)}>Agent PDF</Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => downloadApiFile(pdfUrl, `payslip-${employeeId}-${month}.pdf`)}>Export PDF</Button>
          {splits.some((s) => s.status === "received") && (
            <Button variant="outline" size="sm" onClick={() => downloadApiFile(`/payslip/${employeeId}/splits-zip?month=${month}`, `payslip-splits-${employeeId}-${month}.zip`)}>Splits ZIP</Button>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>Save month profile</Button>
        </>
      }
    >
      {isLoading && <p className="muted">Loading payslip…</p>}
      {!isLoading && (
        <div className={styles.layout}>
          {gateNotes.length > 0 && (
            <div className={styles.dualBanner} style={{ borderColor: "var(--warn, #d97706)", background: "color-mix(in srgb, #d97706 10%, var(--surface))" }}>
              <strong>Offboarding / clearance pending</strong>
              <ul style={{ margin: "0.5rem 0 0 1rem", fontSize: "0.85rem" }}>
                {gateNotes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
              <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                <Link to={`/offboarding?employee=${employeeId}`} className={styles.slipLink}>Offboarding</Link>
                <Link to={`/clearance?employee=${employeeId}`} className={styles.slipLink}>Clearance</Link>
                <Link to={`/equipment?employee=${employeeId}`} className={styles.slipLink}>Equipment</Link>
              </div>
            </div>
          )}
          {leavingThisMonth && leavingNoticeType && (
            <div className={styles.dualBanner}>
              <strong>Leaving — {noticeTypeLabel(leavingNoticeType)}</strong>
              <div className="muted" style={{ marginTop: "0.25rem", fontSize: "0.85rem" }}>
                Depart date: <strong>{departDate}</strong>
                {leavingNoticeType === "without_notice" && " — two weeks basic + transport deducted from final pay."}
                {leavingNoticeType === "with_notice" && " — notice-period basic scaled by passed sales (5–10 → 50–100%)."}
                {leavingNoticeType === "company_decision" && " — full final pay, no leaving deductions."}
                {leavingNoticeType === "with_notice" && noticeSales && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <strong>{noticeSales.passedSalesInNotice}</strong> passed sales in notice window →{" "}
                    <strong>{noticeSales.payPercent}%</strong> basic
                    {noticeSales.previewNote && (
                      <span className="muted"> ({noticeSales.previewNote})</span>
                    )}
                    <div style={{ marginTop: "0.35rem" }}>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={applyNoticeScale.isPending}
                        onClick={() => applyNoticeScale.mutate(noticeSales.passedSalesInNotice)}
                      >
                        {applyNoticeScale.isPending ? "Applying…" : "Apply notice pay scale to this month"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {isDual && (
            <div className={styles.dualBanner}>
              <strong>Dual payslip month</strong>
              <div className="muted" style={{ marginTop: "0.25rem" }}>
                Training: {fmt(((rootSlip.training as Record<string, unknown>)?.calculatedNet ?? (rootSlip.training as Record<string, unknown>)?.netSalary) as number)} EGP · Agent: {fmt(((rootSlip.agent as Record<string, unknown>)?.calculatedNet ?? (rootSlip.agent as Record<string, unknown>)?.netSalary) as number)} EGP · Combined: <strong>{fmt(rootSlip.combinedNet as number)} EGP</strong>
              </div>
              <div className={styles.slipTabs} role="tablist">
                {(["combined", "training", "agent"] as SlipTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    className={`${styles.slipTab} ${slipTab === t ? styles.slipTabActive : ""}`}
                    onClick={() => setSlipTab(t)}
                  >
                    {t === "combined" ? "Combined" : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isTrainingSlip && trainingSpanMonths && trainingSpanMonths.length > 1 && (
            <div className={styles.dualBanner}>
              Training payroll covers <strong>{trainingSpanMonths.map(monthLabel).join(", ")}</strong>
              {" — "}consolidated payslip (accrual {monthLabel(String(activeSlip.trainingPayrollAnchorMonth || rootSlip.trainingPayrollAnchorMonth || month))}).
            </div>
          )}

          {isTrainingContext && (
            <CardBlock title="Training payroll anchor (HR)">
              <FormGrid wide>
                <FormField label="Anchor month override">
                  <input
                    type="month"
                    value={String(profile.trainingPayrollAnchorMonthOverride || "")}
                    onChange={(e) => set("trainingPayrollAnchorMonthOverride", e.target.value)}
                    disabled={!!profile.trainingPayrollPaid}
                  />
                  <span className="muted" style={{ fontSize: "0.75rem", display: "block", marginTop: "0.25rem" }}>
                    Leave blank to use automatic anchor (phase 4 end). Set manually when phase dates are missing or pay must land in a specific month.
                    {trainingAnchorMonth ? (
                      <> Current auto anchor: <strong>{monthLabel(trainingAnchorMonth)}</strong>.</>
                    ) : null}
                  </span>
                </FormField>
              </FormGrid>
            </CardBlock>
          )}

          {slipDeferred && earnedNet > 0 && (
            <div className={styles.dualBanner}>
              <strong>Deferred training month</strong>
              <div className="muted" style={{ marginTop: "0.25rem" }}>
                Full training accrual: <strong>{fmt(earnedNet)} EGP</strong> ({String(activeSlip.totalWorkingDays ?? "—")} payable day-units)
                {" — "}{deferredLabel}.
              </div>
            </div>
          )}

          <CardBlock title="Payslip detail">
            <div className={styles.salaryHeader}>
              <div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>Monthly salary</div>
                <strong style={{ fontSize: "1.15rem" }}>{fmt(activeSlip.monthlySalary as number)} EGP</strong>
                {Number(activeSlip.salaryRaise) > 0 && (
                  <div className="muted" style={{ fontSize: "0.8rem" }}>incl. raise +{fmt(activeSlip.salaryRaise as number)}</div>
                )}
                {isTrainingContext && <span className={styles.badge} style={{ marginTop: "0.35rem" }}>Training salary</span>}
                {activeSlip.monthlySalaryOverrideActive && (
                  <span className={`${styles.badge} ${styles.badgeWarn}`} style={{ marginTop: "0.35rem", marginLeft: "0.35rem" }}>
                    Salary override: {fmt(activeSlip.monthlySalaryOverrideValue as number)} EGP
                  </span>
                )}
                {activeSlip.netSalaryOverrideActive && (
                  <span className={`${styles.badge} ${styles.badgeWarn}`} style={{ marginTop: "0.35rem", marginLeft: "0.35rem" }}>
                    Net override: {fmt(activeSlip.netSalaryOverrideValue as number)} EGP
                  </span>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="muted" style={{ fontSize: "0.8rem" }}>Balance due</div>
                <strong className={styles.net} style={{ fontSize: "1.15rem" }}>
                  {slipSettled ? (
                    <>
                      {fmt(earnedNet)} EGP <span className={styles.badge}>{doneLabel}</span>
                    </>
                  ) : slipDeferred && earnedNet > 0 ? (
                    <>
                      {fmt(earnedNet)} EGP <span className={styles.badge}>{deferredLabel}</span>
                    </>
                  ) : (
                    <>
                      {fmt(
                        (isDual && slipTab === "combined"
                          ? (rootSlip.combinedNet ?? activeSlip.remainingBalance ?? activeSlip.netSalary)
                          : (activeSlip.remainingBalance ?? activeSlip.netSalary)) as number
                      )}{" "}
                      EGP
                    </>
                  )}
                </strong>
              </div>
            </div>
            <div className={styles.detailGrid}>
              <div className={styles.detailSection}>
                <h4>Attendance</h4>
                {showTrainingMonthDetail && isTrainingContext ? (
                  <>
                    {trainingPayBreakdown!.months.map((m) => (
                      <div key={m.ym} className={styles.trainingMonthBlock}>
                        <DetailRow
                          label={m.label}
                          value={
                            <span>
                              <strong>
                                {m.units} day{m.units === 1 ? "" : "-units"}
                              </strong>
                              {m.phase1Exception && (
                                <span className={styles.badge} style={{ marginLeft: "0.35rem" }}>
                                  Week 1 exception
                                </span>
                              )}
                            </span>
                          }
                        />
                        {formatTrainingDays(m.days) && (
                          <p className={styles.trainingDayList}>{formatTrainingDays(m.days)}</p>
                        )}
                        <DetailRow label="Basic salary" value={<strong>{fmt(m.basic)} EGP</strong>} />
                        {Number(m.transport) > 0 && (
                          <DetailRow
                            label={`Transport (${m.transportDays ?? 0} day-units)`}
                            value={<span className={styles.pos}>+{fmt(m.transport)}</span>}
                          />
                        )}
                      </div>
                    ))}
                    {trainingPayBreakdown!.deductions?.map((d) => (
                      <DetailRow
                        key={d.id}
                        label={d.label}
                        value={<span className={styles.neg}>-{fmt(d.amount)} EGP</span>}
                      />
                    ))}
                    {trainingPayBreakdown!.phase1ExceptionApplied && (
                      <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.8rem" }}>
                        Week 1 (phase 1) is included by HR exception on this payslip.
                      </p>
                    )}
                    {!trainingPayBreakdown!.phase1ExceptionApplied &&
                      trainingPayBreakdown!.deductions?.some((d) => d.id === "phase1_target") && (
                        <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.8rem" }}>
                          Week 1 is withheld by default when the sales target is not met (3,000 EGP / 5 days).
                        </p>
                      )}
                    <DetailRow
                      label={`Daily rate (${activeSlip.workingDaysInMonth ?? "—"}d)`}
                      value={`${activeSlip.dailyRate ?? "—"} EGP`}
                    />
                    <DetailRow
                      label="Training basic (total)"
                      value={<strong>{fmt((slipDeferred ? earnedBasic : activeSlip.basicSalary) as number)} EGP</strong>}
                    />
                    {Number(activeSlip.transportAllowance) > 0 && (
                      <DetailRow
                        label={`Transport total (${activeSlip.transportDays ?? 0} day-units)`}
                        value={<span className={styles.pos}>+{fmt(activeSlip.transportAllowance as number)}</span>}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <DetailRow label="Working days" value={String(activeSlip.totalWorkingDays ?? "—")} />
                    {Number(activeSlip.extraDays) > 0 && (
                      <DetailRow label="Extra days" value={String(activeSlip.extraDays)} />
                    )}
                    {Number(activeSlip.nsnc) > 0 && <DetailRow label="NSNC" value={String(activeSlip.nsnc)} />}
                    {Number(activeSlip.nsncHalf) > 0 && (
                      <DetailRow label="NSNC half day" value={String(activeSlip.nsncHalf)} />
                    )}
                    <DetailRow
                      label={`Daily rate (${activeSlip.workingDaysInMonth ?? "—"}d)`}
                      value={`${activeSlip.dailyRate ?? "—"} EGP`}
                    />
                    <DetailRow
                      label="Basic salary"
                      value={<strong>{fmt((slipDeferred ? earnedBasic : activeSlip.basicSalary) as number)} EGP</strong>}
                    />
                    {Number(activeSlip.transportAllowance) > 0 && (
                      <DetailRow
                        label={`Transport (${activeSlip.transportDays ?? 0} day-units)`}
                        value={<span className={styles.pos}>+{fmt(activeSlip.transportAllowance as number)}</span>}
                      />
                    )}
                  </>
                )}
                {Number(activeSlip.salesCount) > 0 && (
                  <DetailRow label="Sales this month" value={String(activeSlip.salesCount)} />
                )}
                {Array.isArray(activeSlip.commissionBreakdown) && (activeSlip.commissionBreakdown as { label: string; amount: number }[]).length > 0 && (
                  <DetailRow
                    label="Commission tiers"
                    value={
                      <span className={styles.pos}>
                        {(activeSlip.commissionBreakdown as { label: string; amount: number }[])
                          .map((b) => `${b.label}: ${fmt(b.amount)}`)
                          .join(" + ")}
                      </span>
                    }
                  />
                )}
                {(activeSlip.twoWeekHold || profile.twoWeekHold) && (
                  <DetailRow
                    label="2-week hold"
                    value={<span className={styles.neg}>-{fmt(activeSlip.holdAmount as number)}</span>}
                  />
                )}
              </div>
              <div className={styles.detailSection}>
                <h4>Net pay</h4>
                {Object.entries(slipBonuses)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => (
                    <DetailRow key={k} label={k} value={<span className={styles.pos}>+{fmt(v)}</span>} />
                  ))}
                {Number(activeSlip.latenessDeduction) > 0 && (
                  <DetailRow label="Lateness" value={<span className={styles.neg}>-{fmt(activeSlip.latenessDeduction as number)}</span>} />
                )}
                {Object.entries(slipDeductions)
                  .filter(([k, v]) => v > 0 && k !== "Lateness Deduction")
                  .map(([k, v]) => (
                    <DetailRow key={k} label={k} value={<span className={styles.neg}>-{fmt(v)}</span>} />
                  ))}
                {Number(activeSlip.deferredIn) > 0 && (
                  <DetailRow label="Carried from prior month" value={<span className={styles.pos}>+{fmt(activeSlip.deferredIn as number)}</span>} />
                )}
                <DetailRow
                  label="Calculated net"
                  value={`${fmt(
                    (activeSlip.calculatedNet ??
                      (Number(activeSlip.basicSalary || 0) +
                        Number(activeSlip.totalBonuses || 0) -
                        Number(activeSlip.totalDeductions || 0) -
                        Number(activeSlip.bonusTransferPayroll || 0))) as number
                  )} EGP`}
                />
                {Number(activeSlip.receivedTotal) > 0 && (
                  <DetailRow label="Paid (splits)" value={<span className={styles.neg}>-{fmt(activeSlip.receivedTotal as number)}</span>} />
                )}
                {Number(activeSlip.deferredOut) > 0 && (
                  <DetailRow label="Deferred to later month" value={<span className={styles.neg}>-{fmt(activeSlip.deferredOut as number)}</span>} />
                )}
                <DetailRow
                  label="Balance due"
                  value={
                    slipSettled ? (
                      <strong>
                        {fmt(earnedNet)} EGP <span className={styles.badge}>{doneLabel}</span>
                      </strong>
                    ) : slipDeferred && earnedNet > 0 ? (
                      <strong>
                        {fmt(earnedNet)} EGP <span className={styles.badge}>{deferredLabel}</span>
                      </strong>
                    ) : (
                      <strong>{fmt((activeSlip.remainingBalance ?? activeSlip.netSalary) as number)} EGP</strong>
                    )
                  }
                  total
                />
              </div>
            </div>
          </CardBlock>

          <CardBlock title={showCombinedProfile ? "Combined payroll" : showTrainingProfile ? "Training payroll" : "Agent payroll"}>
            {showCombinedProfile && isDual && (
              <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
                Combined net is the sum of the training and agent portions. Use the <strong>Training</strong> or <strong>Agent</strong> tab to adjust each part.
              </p>
            )}
            {showTrainingProfile && (
              <FormGrid wide>
                <FormField label="Training net override">
                  <div className={styles.overrideField}>
                    <input
                      inputMode="decimal"
                      min={0}
                      placeholder="Leave blank to use calculated training net"
                      value={String(profile.trainingNetSalaryOverride || "")}
                      onChange={(e) => set("trainingNetSalaryOverride", e.target.value)}
                      disabled={!!profile.trainingPayrollPaid}
                    />
                    <Button type="button" size="sm" variant="secondary" title="Clear override" onClick={() => set("trainingNetSalaryOverride", "")}>×</Button>
                  </div>
                  <span className="muted" style={{ fontSize: "0.75rem" }}>Applies to training portion only (fixed 600/day unless overridden)</span>
                </FormField>
                <FormField label="Training status">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center", minHeight: "2.25rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <input
                        type="checkbox"
                        checked={!!profile.trainingPayrollPaid}
                        onChange={(e) => {
                          set("trainingPayrollPaid", e.target.checked);
                          if (e.target.checked) set("trainingNetSalaryOverride", "");
                        }}
                      />
                      Mark training as paid (zero training net)
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        set("trainingPayrollPaid", false);
                        set("trainingNetSalaryOverride", "0");
                      }}
                    >
                      Remove training pay
                    </Button>
                  </div>
                </FormField>
                <FormField label="Week 1 (phase 1) pay">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <input
                      type="checkbox"
                      checked={!!profile.trainingPhase1PayException}
                      disabled={!canEditPhase1Exception || !!profile.trainingPayrollPaid}
                      onChange={(e) => set("trainingPhase1PayException", e.target.checked)}
                    />
                    Pay week 1 as exception (add phase 1 basic — target not met)
                  </label>
                  {!canEditPhase1Exception && (
                    <span className="muted" style={{ fontSize: "0.75rem", display: "block", marginTop: "0.25rem" }}>
                      Set on the anchor month payslip ({monthLabel(trainingAnchorMonth)}).
                    </span>
                  )}
                </FormField>
              </FormGrid>
            )}
            {showAgentProfile && (
              <FormGrid wide>
                <FormField label="Position">
                  <input value={String(profile.position || "")} onChange={(e) => set("position", e.target.value)} />
                </FormField>
                <FormField label="Salary raise">
                  <input type="number" value={String(profile.salaryRaise || "")} onChange={(e) => set("salaryRaise", e.target.value)} />
                </FormField>
                <FormField label="Position salary override">
                  <div className={styles.overrideField}>
                    <input
                      inputMode="decimal"
                      min={0}
                      placeholder="Leave blank to use position rate"
                      value={String(profile.monthlySalaryOverride || "")}
                      onChange={(e) => set("monthlySalaryOverride", e.target.value)}
                    />
                    <Button type="button" size="sm" variant="secondary" title="Clear override" onClick={() => set("monthlySalaryOverride", "")}>×</Button>
                  </div>
                </FormField>
                <FormField label={isDual ? "Agent net override" : "Net salary override"}>
                  <div className={styles.overrideField}>
                    <input
                      inputMode="decimal"
                      min={0}
                      placeholder="Leave blank to use calculated net"
                      value={String(isDual ? profile.agentNetSalaryOverride || "" : profile.netSalaryOverride || "")}
                      onChange={(e) => set(isDual ? "agentNetSalaryOverride" : "netSalaryOverride", e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      title="Clear override"
                      onClick={() => set(isDual ? "agentNetSalaryOverride" : "netSalaryOverride", "")}
                    >
                      ×
                    </Button>
                  </div>
                  <span className="muted" style={{ fontSize: "0.75rem" }}>
                    {isDual ? "Applies to agent portion only (post-promotion days)" : "Replaces calculated net for this month"}
                  </span>
                </FormField>
                <FormField label="Extra days">
                  <input type="number" step={0.5} value={String(profile.extraDays || "")} onChange={(e) => set("extraDays", e.target.value)} />
                </FormField>
                <FormField label="Sales count">
                  <div style={{ display: "flex", gap: "0.35rem" }}>
                    <input type="number" value={String(profile.salesCount || "")} onChange={(e) => set("salesCount", e.target.value)} style={{ flex: 1 }} />
                    <Button size="sm" variant="secondary" onClick={() => recalcSales.mutate()}>Recalc</Button>
                  </div>
                </FormField>
              </FormGrid>
            )}
            {showCombinedProfile && isDual && (
              <div className={styles.salaryHeader} style={{ marginBottom: "0.75rem" }}>
                <div>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>Training portion</div>
                  <strong>{fmt(((rootSlip.training as Record<string, unknown>)?.calculatedNet ?? (rootSlip.training as Record<string, unknown>)?.netSalary) as number)} EGP</strong>
                  {profile.trainingPayrollPaid && <span className={styles.badge} style={{ marginLeft: "0.35rem" }}>Paid</span>}
                </div>
                <div>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>Agent portion</div>
                  <strong>{fmt(((rootSlip.agent as Record<string, unknown>)?.calculatedNet ?? (rootSlip.agent as Record<string, unknown>)?.netSalary) as number)} EGP</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>Combined net</div>
                  <strong style={{ fontSize: "1.15rem" }}>{fmt(rootSlip.combinedNet as number)} EGP</strong>
                </div>
              </div>
            )}
            <FormGrid wide>
              <FormField label="Payroll status">
                <Select
                  value={String(profile.payrollStatus || "")}
                  onChange={(v) => set("payrollStatus", v)}
                  options={["pending", "approved", "paid", "hold", "no payroll"].map((s) => ({ value: s, label: s }))}
                />
              </FormField>
              <FormField label="Payment method">
                <Select
                  value={String(profile.paymentMethod || "")}
                  onChange={(v) => set("paymentMethod", v)}
                  options={[{ value: "", label: "—" }, ...PAYMENT_METHOD_OPTIONS]}
                />
              </FormField>
              {showAgentProfile && (
                <FormField label="2-week hold">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", minHeight: "2.25rem" }}>
                    <input type="checkbox" checked={!!profile.twoWeekHold} onChange={(e) => set("twoWeekHold", e.target.checked)} />
                    Hold half of basic for first payroll
                  </label>
                </FormField>
              )}
              <FormField label="Bank reference">
                <input value={String(profile.bankReference || "")} onChange={(e) => set("bankReference", e.target.value)} />
              </FormField>
              <FormField label="Notes" span="full">
                <textarea rows={3} value={String(profile.monthNotes || "")} onChange={(e) => set("monthNotes", e.target.value)} />
              </FormField>
            </FormGrid>
            <div className={styles.checks}>
              <label><input type="checkbox" checked={!!profile.transportEligible} onChange={(e) => set("transportEligible", e.target.checked)} /> Transport eligible</label>
              <label><input type="checkbox" checked={!!profile.noPayroll} onChange={(e) => set("noPayroll", e.target.checked)} /> No payroll</label>
              <label><input type="checkbox" checked={!!profile.payslipVisibleToAgent} onChange={(e) => set("payslipVisibleToAgent", e.target.checked)} /> Show to agent</label>
              <label><input type="checkbox" checked={!!profile.fullTransportGrant} onChange={(e) => set("fullTransportGrant", e.target.checked)} /> Grant full transportation</label>
            </div>
          </CardBlock>

          <CardBlock title="Extra payroll">
            <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.8rem" }}>
              Fixed working days × day rate — added to payroll as a bonus line and can replace partial-month pay.
            </p>
            {extraPayroll.length === 0 && <p className="muted">None</p>}
            {extraPayroll.map((e) => (
              <div key={e.id} className={styles.extraRow}>
                <span>
                  <strong>{e.label || "Extra"}</strong>: {e.workingDays ?? 0}d × {fmt(e.dailyRate)} = <strong>{fmt(e.netAmount)}</strong>
                </span>
                <span style={{ display: "flex", gap: "0.25rem" }}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadApiFile(`/payroll-extra/${e.id}/pdf`, `extra-payroll-${e.id}.pdf`)}
                  >
                    PDF
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => undo.confirmUndo({
                      title: "Delete this extra payroll entry?",
                      toast: "Extra payroll deleted",
                      commit: () => deleteExtraPayroll.mutateAsync(e.id),
                    })}
                  >
                    Delete
                  </Button>
                </span>
              </div>
            ))}
            <FormSection title="Add extra payroll">
              <FormGrid>
                <FormField label="Label">
                  <div style={{ display: "flex", gap: "0.35rem" }}>
                    <input
                      value={extraForm.label}
                      onChange={(e) => setExtraForm({ ...extraForm, label: e.target.value })}
                      placeholder="e.g. Extra, Training, Part-time"
                      style={{ flex: 1 }}
                    />
                    {isTrainingSlip && (
                      <Button type="button" size="sm" variant="secondary" onClick={fillTrainingExtra}>Training</Button>
                    )}
                  </div>
                </FormField>
                <FormField label="Working days">
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    value={extraForm.workingDays}
                    onChange={(e) => setExtraForm({ ...extraForm, workingDays: e.target.value })}
                  />
                </FormField>
                <FormField label="Day rate (EGP)">
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    value={extraForm.dailyRate}
                    onChange={(e) => setExtraForm({ ...extraForm, dailyRate: e.target.value })}
                  />
                </FormField>
                <FormField label="Net amount (EGP)">
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    value={extraForm.netAmount}
                    onChange={(e) => setExtraForm({ ...extraForm, netAmount: e.target.value })}
                  />
                </FormField>
              </FormGrid>
              <Button
                size="sm"
                style={{ marginTop: "0.5rem" }}
                onClick={() => addExtraPayroll.mutate()}
                disabled={!extraForm.label || addExtraPayroll.isPending}
              >
                Add extra payroll
              </Button>
            </FormSection>
          </CardBlock>

          <CardBlock title="Loans">
            {loans.length === 0 && <p className="muted">No loans for this employee.</p>}
            {loans.map((l) => (
              <div key={l.id} className={styles.loanCard}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <strong>{fmt(l.totalAmount)} EGP</strong>
                  <span className="muted">{l.status}</span>
                </div>
                <div className="muted">{l.installmentAmount} EGP × {l.installmentsCount} · paid {l.installmentsPaid || 0}</div>
                <div className="muted">Starts {l.startYearMonth}{l.skipCurrentMonth ? " (skipped creation month)" : ""}</div>
                {l.notes && <div style={{ marginTop: "0.25rem" }}>{l.notes}</div>}
                <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.35rem" }}>
                  {l.status === "active" && <Button size="sm" variant="secondary" onClick={() => cancelLoan.mutate(l.id)}>Cancel</Button>}
                  {!(l.installmentsPaid && l.installmentsPaid > 0) && l.status !== "completed" && (
                    <Button size="sm" variant="danger" onClick={() => undo.confirmUndo({
                      title: "Delete loan?",
                      toast: "Loan deleted",
                      commit: () => deleteLoan.mutateAsync(l.id),
                    })}>Delete</Button>
                  )}
                </div>
              </div>
            ))}
            <FormSection title="Request loan">
              <FormGrid>
                <FormField label="Total amount (EGP)"><input type="number" value={loanForm.totalAmount} onChange={(e) => setLoanForm({ ...loanForm, totalAmount: e.target.value })} /></FormField>
                <FormField label="Per salary (EGP)"><input type="number" value={loanForm.installmentAmount} onChange={(e) => setLoanForm({ ...loanForm, installmentAmount: e.target.value })} /></FormField>
                <FormField label="# salaries"><input type="number" value={loanForm.installmentsCount} onChange={(e) => setLoanForm({ ...loanForm, installmentsCount: e.target.value })} /></FormField>
                <FormField label="Skip current month"><input type="checkbox" checked={loanForm.skipCurrentMonth} onChange={(e) => setLoanForm({ ...loanForm, skipCurrentMonth: e.target.checked })} /></FormField>
                <FormField label="Notes" span="full"><input value={loanForm.notes} onChange={(e) => setLoanForm({ ...loanForm, notes: e.target.value })} /></FormField>
              </FormGrid>
              <Button size="sm" onClick={() => addLoan.mutate()} disabled={!loanForm.totalAmount || addLoan.isPending}>Submit loan request</Button>
            </FormSection>
          </CardBlock>

          <CardBlock title="Bonuses">
            <ul className={styles.list}>
              {bonuses.map((b, i) => (
                <li key={i}>{b.type}: {fmt(b.amount)} — {b.date}{b.reason ? ` · ${b.reason}` : ""}</li>
              ))}
              {!bonuses.length && <li className="muted">No bonuses</li>}
            </ul>
            <FormSection title="Add bonus">
              <FormGrid>
                <FormField label="Type">
                  <Select
                    value={bonusForm.type}
                    onChange={(type) => setBonusForm({ ...bonusForm, type, deductFromEmployeeId: "" })}
                    options={[{ value: "", label: "—" }, ...(bonusTypes?.types || []).map((t) => ({ value: t, label: t }))]}
                  />
                </FormField>
                {isTlBonusForm && (
                  <FormField label="Deduct from (TL/OP pays)" span="full">
                    <Select
                      value={bonusForm.deductFromEmployeeId}
                      onChange={(deductFromEmployeeId) => setBonusForm({ ...bonusForm, deductFromEmployeeId })}
                      options={[
                        { value: "", label: "— Select TL/OP —" },
                        ...tlPayers.map((e) => ({ value: e.id, label: `${e.id} — ${e.american_name || ""}` })),
                      ]}
                    />
                  </FormField>
                )}
                <FormField label="Amount"><input type="number" value={bonusForm.amount} onChange={(e) => setBonusForm({ ...bonusForm, amount: e.target.value })} /></FormField>
                <FormField label="Date"><input type="date" value={bonusForm.date} onChange={(e) => setBonusForm({ ...bonusForm, date: e.target.value })} /></FormField>
                <FormField label="Reason" span="full"><input value={bonusForm.reason} onChange={(e) => setBonusForm({ ...bonusForm, reason: e.target.value })} /></FormField>
              </FormGrid>
              <Button size="sm" onClick={() => addBonus.mutate()} disabled={!bonusForm.amount || (isTlBonusForm && !bonusForm.deductFromEmployeeId)}>Add bonus</Button>
            </FormSection>
          </CardBlock>

          <CardBlock title="Deductions">
            <ul className={styles.list}>
              {deductions.map((d, i) => (
                <li key={i}>{d.type}: {fmt(d.amount)} — {d.date}{d.reason ? ` · ${d.reason}` : ""}</li>
              ))}
              {!deductions.length && <li className="muted">No deductions</li>}
            </ul>
            <FormSection title="Add deduction">
              <FormGrid>
                <FormField label="Type">
                  <Select
                    value={dedForm.type}
                    onChange={(type) => setDedForm({ ...dedForm, type })}
                    options={[{ value: "", label: "—" }, ...(dedTypes?.types || []).map((t) => ({ value: t, label: t }))]}
                  />
                </FormField>
                <FormField label="Amount"><input type="number" value={dedForm.amount} onChange={(e) => setDedForm({ ...dedForm, amount: e.target.value })} /></FormField>
                <FormField label="Date"><input type="date" value={dedForm.date} onChange={(e) => setDedForm({ ...dedForm, date: e.target.value })} /></FormField>
                <FormField label="Reason" span="full"><input value={dedForm.reason} onChange={(e) => setDedForm({ ...dedForm, reason: e.target.value })} /></FormField>
              </FormGrid>
              <Button size="sm" onClick={() => addDeduction.mutate()} disabled={!dedForm.amount}>Add deduction</Button>
            </FormSection>
          </CardBlock>

          <CardBlock title="Payment splits">
            <ul className={styles.list}>
              {splits.map((s) => (
                <li key={s.id} className={styles.splitRow}>
                  <span>
                    <strong>{fmt(s.amount)}</strong> EGP · {s.status}
                    {s.splitKind && s.splitKind !== "payment" ? ` (${s.splitKind})` : ""}
                    {s.deferToMonth ? ` → ${s.deferToMonth}` : ""}
                    {s.notes ? ` · ${s.notes}` : ""}
                  </span>
                  <span className={styles.splitActions}>
                    {s.status === "pending" && (
                      <Button size="sm" onClick={() => patchSplit.mutate({ id: s.id, status: "received" })}>Received</Button>
                    )}
                    {s.status === "received" && (
                      <Button size="sm" variant="outline" onClick={() => downloadApiFile(`/payslip/${employeeId}/pdf?month=${month}&splitId=${s.id}`, `payslip-split-${s.id}.pdf`)}>PDF</Button>
                    )}
                    <Button size="sm" variant="danger" onClick={() => undo.confirmUndo({
                      title: "Delete this split?",
                      toast: "Split deleted",
                      commit: () => deleteSplit.mutateAsync(s.id),
                    })}>Delete</Button>
                  </span>
                </li>
              ))}
              {!splits.length && <li className="muted">No payment splits</li>}
            </ul>
            <FormGrid>
              <FormField label="Amount"><input type="number" value={splitForm.amount} onChange={(e) => setSplitForm({ ...splitForm, amount: e.target.value })} /></FormField>
              <FormField label="Type">
                <Select
                  value={splitForm.splitKind}
                  onChange={(splitKind) => setSplitForm({ ...splitForm, splitKind })}
                  options={[
                    { value: "payment", label: "Payment" },
                    { value: "training_bonus", label: "Training bonus" },
                    { value: "training_payroll", label: "Training payroll" },
                    { value: "correction", label: "Correction" },
                  ]}
                />
              </FormField>
              <FormField label="Status">
                <Select
                  value={splitForm.status}
                  onChange={(status) => setSplitForm({ ...splitForm, status })}
                  options={[
                    { value: "pending", label: "Pending" },
                    { value: "received", label: "Received" },
                    { value: "deferred", label: "Deferred" },
                  ]}
                />
              </FormField>
              {splitForm.status === "deferred" && (
                <FormField label="Defer to month">
                  <input type="month" value={splitForm.deferToMonth || shiftMonth(month, 1)} onChange={(e) => setSplitForm({ ...splitForm, deferToMonth: e.target.value })} />
                </FormField>
              )}
              <FormField label="Notes" span="full"><input value={splitForm.notes} onChange={(e) => setSplitForm({ ...splitForm, notes: e.target.value })} /></FormField>
            </FormGrid>
            <Button size="sm" style={{ marginTop: "0.5rem" }} onClick={() => addSplit.mutate()} disabled={!splitForm.amount}>Add split</Button>
          </CardBlock>
        </div>
      )}
      {(saveProfile.isError || addBonus.isError || addDeduction.isError || addLoan.isError || addExtraPayroll.isError || deleteExtraPayroll.isError) && (
        <p style={{ color: "var(--err)" }}>
          {(saveProfile.error || addBonus.error || addDeduction.error || addLoan.error || addExtraPayroll.error || deleteExtraPayroll.error as Error)?.message}
        </p>
      )}
      <ConfirmDialog
        open={undo.confirmOpen}
        onOpenChange={undo.setConfirmOpen}
        title={undo.confirmTitle}
        message={undo.confirmMessage}
        danger
        onConfirm={undo.confirmDelete}
      />
    </Dialog>
  );
}

function CardBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.card}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({ label, value, total }: { label: string; value: ReactNode; total?: boolean }) {
  return (
    <div className={`${styles.detailRow} ${total ? styles.detailRowTotal : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
