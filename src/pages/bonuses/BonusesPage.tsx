import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, fmt, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAuth } from "@/app/AuthProvider";
import { bonusCols } from "@/api/columnMaps";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { DataGrid } from "@/ui/DataGrid";
import { Dialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import { InspectorDetail } from "@/ui/InspectorDetail";
import { useInspectorStore } from "@/stores/cross-filter-store";

type Row = Record<string, unknown>;

type BonusRequest = {
  id: string;
  employeeId: string;
  date: string;
  amount: number;
  type: string;
  reason?: string;
  submittedBy?: string;
  status?: string;
};

const TL_BONUS_TYPE = "Bonus from TL / OP";

function isLeadershipEmployeeId(id: string) {
  return /^(TL|CL|OP|HR|RTM)/i.test(String(id || "").trim());
}

function canSubmitBonusRequest(user: Record<string, unknown> | null | undefined) {
  if (!user) return false;
  if (user.canSubmitBonusRequest === true) return true;
  return ["tl", "op", "quality", "rtm", "admin", "hr"].includes(String(user.role || "").toLowerCase());
}

function canApproveBonusRequest(user: Record<string, unknown> | null | undefined) {
  if (!user) return false;
  if (user.canApproveBonusRequest === true) return true;
  return ["admin", "ceo", "hr"].includes(String(user.role || "").toLowerCase());
}

export function BonusesPage() {
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const qc = useQueryClient();
  const { user } = useAuth();
  const openInspector = useInspectorStore((s) => s.openInspector);
  const [addOpen, setAddOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [form, setForm] = useState({ employeeId: "", type: "", amount: "", date: "", reason: "", deductFromEmployeeId: "" });
  const [reqForm, setReqForm] = useState({ employeeId: "", amount: "", date: "", reason: "" });

  const canSubmit = canSubmitBonusRequest(user);
  const canApprove = canApproveBonusRequest(user);

  const { data, isLoading, error } = useQuery({
    queryKey: ["bonuses", month, companyContext],
    queryFn: () => api<{ bonuses: Row[]; types: string[] }>(path("/bonuses", { month })),
  });

  const { data: reqData, error: reqError } = useQuery({
    queryKey: ["bonus-requests", companyContext],
    enabled: canSubmit || canApprove,
    queryFn: () =>
      api<{ requests: BonusRequest[]; types: string[] }>(
        path("/bonus-requests", { status: "pending" })
      ),
  });

  const { data: emps } = useQuery({
    queryKey: ["employees-bonus", companyContext],
    queryFn: () => api<{ employees: { id: string; american_name?: string }[] }>(path("/employees")),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bonuses", month] });
    qc.invalidateQueries({ queryKey: ["bonus-requests"] });
  };

  const add = useMutation({
    mutationFn: () =>
      api(path("/bonuses"), {
        method: "POST",
        body: JSON.stringify({
          employeeId: form.employeeId,
          type: form.type || "Other Bonus",
          amount: Number(form.amount),
          date: form.date || `${month}-01`,
          reason: form.reason,
          deductFromEmployeeId:
            form.type === TL_BONUS_TYPE ? form.deductFromEmployeeId || undefined : undefined,
          ...(companyContext === "hs2" ? { company: "hs2" } : {}),
        }),
      }),
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      setForm({ employeeId: "", type: "", amount: "", date: "", reason: "", deductFromEmployeeId: "" });
    },
  });

  const submitReq = useMutation({
    mutationFn: () =>
      api(path("/bonus-requests"), {
        method: "POST",
        body: JSON.stringify({
          employeeId: reqForm.employeeId,
          date: reqForm.date || `${month}-15`,
          amount: Number(reqForm.amount),
          type: TL_BONUS_TYPE,
          reason: reqForm.reason,
          ...(companyContext === "hs2" ? { company: "hs2" } : {}),
        }),
      }),
    onSuccess: () => {
      invalidate();
      setReqOpen(false);
      setReqForm({ employeeId: "", amount: "", date: "", reason: "" });
    },
  });

  const reviewReq = useMutation({
    mutationFn: ({ id, action, denyReason: reason }: { id: string; action: "approve" | "deny"; denyReason?: string }) =>
      api(path(`/bonus-requests/${id}`), {
        method: "PATCH",
        body: JSON.stringify({ action, denyReason: reason }),
      }),
    onSuccess: () => {
      invalidate();
      setDenyOpen(null);
      setDenyReason("");
    },
  });

  const rows = data?.bonuses || [];
  const requests = reqData?.requests || [];
  const agents = (emps?.employees || []).filter((e) => !isLeadershipEmployeeId(e.id));
  const tlPayers = (emps?.employees || []).filter((e) => isLeadershipEmployeeId(e.id));
  const columns = useMemo<ColumnDef<Row>[]>(() => bonusCols, []);
  const isTlBonusForm = form.type === TL_BONUS_TYPE;

  return (
    <div>
      <SectionHeader
        title="Bonuses"
        subtitle={monthLabel(month)}
        actions={<Button onClick={() => setAddOpen(true)}>Add bonus</Button>}
      />

      {(canSubmit || canApprove) && (
        <Card style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h3 style={{ margin: 0 }}>
              Bonus requests {canApprove ? "(pending approval)" : ""}
            </h3>
            {canSubmit && (
              <Button size="sm" onClick={() => setReqOpen(true)}>+ Request bonus for agent</Button>
            )}
          </div>
          {requests.length ? (
            <table style={{ width: "100%", fontSize: "0.875rem" }}>
              <thead>
                <tr>
                  <th align="left">Date</th>
                  <th align="left">Agent</th>
                  <th align="right">Amount</th>
                  <th align="left">Type</th>
                  <th align="left">By</th>
                  {canApprove && <th align="right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.employeeId}</td>
                    <td align="right">{fmt(r.amount)}</td>
                    <td>{r.type}</td>
                    <td>{r.submittedBy || "—"}</td>
                    {canApprove && (
                      <td align="right" style={{ display: "flex", gap: "0.35rem", justifyContent: "flex-end" }}>
                        <Button size="sm" onClick={() => reviewReq.mutate({ id: r.id, action: "approve" })} disabled={reviewReq.isPending}>
                          Approve
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDenyOpen(r.id)} disabled={reviewReq.isPending}>
                          Deny
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : reqError ? (
            <p style={{ color: "var(--err)" }}>{(reqError as Error).message}</p>
          ) : (
            <p className="muted">No pending requests</p>
          )}
        </Card>
      )}

      <Card>
        {isLoading && <p className="muted">Loading…</p>}
        {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
        {!isLoading && !error && (
          <DataGrid
            data={rows}
            columns={columns}
            onRowClick={(row) => openInspector(`Bonus — ${row.employeeId}`, <InspectorDetail row={row} />)}
          />
        )}
      </Card>

      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add bonus"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => add.mutate()} disabled={add.isPending || !form.employeeId || !form.amount || (isTlBonusForm && !form.deductFromEmployeeId)}>Save</Button>
          </>
        }
      >
        <FormGrid wide>
          <FormField label="Employee">
            <Select
              value={form.employeeId}
              onChange={(employeeId) => setForm({ ...form, employeeId })}
              options={[
                { value: "", label: "—" },
                ...(emps?.employees || []).map((e) => ({ value: e.id, label: `${e.id} — ${e.american_name || ""}` })),
              ]}
            />
          </FormField>
          <FormField label="Type">
            <Select
              value={form.type}
              onChange={(type) => setForm({ ...form, type, deductFromEmployeeId: "" })}
              options={[{ value: "", label: "—" }, ...(data?.types || []).map((t) => ({ value: t, label: t }))]}
            />
          </FormField>
          {isTlBonusForm && (
            <FormField label="Deduct from (TL/OP pays)" span="full">
              <Select
                value={form.deductFromEmployeeId}
                onChange={(deductFromEmployeeId) => setForm({ ...form, deductFromEmployeeId })}
                options={[
                  { value: "", label: "— Select TL/OP —" },
                  ...tlPayers.map((e) => ({ value: e.id, label: `${e.id} — ${e.american_name || ""}` })),
                ]}
              />
            </FormField>
          )}
          <FormField label="Amount"><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></FormField>
          <FormField label="Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></FormField>
          <FormField label="Reason" span="full"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></FormField>
        </FormGrid>
        {add.isError && <p style={{ color: "var(--err)" }}>{(add.error as Error).message}</p>}
      </Dialog>

      <Dialog
        open={reqOpen}
        onOpenChange={setReqOpen}
        title="Request bonus for agent"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setReqOpen(false)}>Cancel</Button>
            <Button onClick={() => submitReq.mutate()} disabled={submitReq.isPending || !reqForm.employeeId || !reqForm.amount}>
              Submit for approval
            </Button>
          </>
        }
      >
        <FormGrid wide>
          <FormField label="Agent">
            <Select
              value={reqForm.employeeId}
              onChange={(employeeId) => setReqForm({ ...reqForm, employeeId })}
              options={[
                { value: "", label: "—" },
                ...agents.map((e) => ({ value: e.id, label: `${e.id} — ${e.american_name || ""}` })),
              ]}
            />
          </FormField>
          <FormField label="Date">
            <input type="date" value={reqForm.date || `${month}-15`} onChange={(e) => setReqForm({ ...reqForm, date: e.target.value })} />
          </FormField>
          <FormField label="Amount">
            <input type="number" step="0.01" value={reqForm.amount} onChange={(e) => setReqForm({ ...reqForm, amount: e.target.value })} />
          </FormField>
          <FormField label="Type">
            <input value={TL_BONUS_TYPE} readOnly />
          </FormField>
          <FormField label="Reason" span="full">
            <input value={reqForm.reason} onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })} />
          </FormField>
        </FormGrid>
        {submitReq.isError && <p style={{ color: "var(--err)" }}>{(submitReq.error as Error).message}</p>}
      </Dialog>

      <Dialog
        open={!!denyOpen}
        onOpenChange={(o) => { if (!o) { setDenyOpen(null); setDenyReason(""); } }}
        title="Deny bonus request"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setDenyOpen(null); setDenyReason(""); }}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => denyOpen && reviewReq.mutate({ id: denyOpen, action: "deny", denyReason })}
              disabled={reviewReq.isPending}
            >
              Deny
            </Button>
          </>
        }
      >
        <FormField label="Optional reason for denial">
          <input value={denyReason} onChange={(e) => setDenyReason(e.target.value)} placeholder="Reason" />
        </FormField>
      </Dialog>
    </div>
  );
}
