import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, fmt, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAuth } from "@/app/AuthProvider";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { DataGrid } from "@/ui/DataGrid";
import { Dialog, ConfirmDialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import { InspectorDetail } from "@/ui/InspectorDetail";
import { useInspectorStore } from "@/stores/cross-filter-store";
import { isBonusTransferPayerId, isLeadershipEmployeeId } from "@/lib/bonusTransferPayer";

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

type BonusForm = {
  employeeId: string;
  type: string;
  amount: string;
  date: string;
  reason: string;
  deductFromEmployeeId: string;
};

const TL_BONUS_TYPE = "Bonus from TL / OP";

function parseTlSourceFromReason(reason: string | undefined | null) {
  const m = String(reason || "").match(/\(deducted from\s+([^)]+)\)/i);
  return m ? m[1].trim() : "";
}

function cleanBonusReason(reason: string | undefined | null) {
  return String(reason || "")
    .replace(/\s*\(deducted from[^)]+\)\s*/i, "")
    .trim();
}

function emptyForm(month: string): BonusForm {
  return {
    employeeId: "",
    type: "",
    amount: "",
    date: `${month}-01`,
    reason: "",
    deductFromEmployeeId: "",
  };
}

function rowToForm(row: Row): BonusForm {
  return {
    employeeId: String(row.employeeId || ""),
    type: String(row.type || ""),
    amount: row.amount != null ? String(row.amount) : "",
    date: String(row.date || "").slice(0, 10),
    reason: cleanBonusReason(String(row.reason || "")),
    deductFromEmployeeId: parseTlSourceFromReason(String(row.reason || "")),
  };
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

function canManageBonuses(user: Record<string, unknown> | null | undefined) {
  if (!user) return false;
  if (user.canManageEmployees === true) return true;
  return ["admin", "ceo", "hr"].includes(String(user.role || "").toLowerCase());
}

function canAddBonusTransfer(user: Record<string, unknown> | null | undefined) {
  if (!user) return false;
  if (canManageBonuses(user)) return true;
  if (user.canTransferBonus === true) return true;
  return ["tl", "op", "quality", "rtm"].includes(String(user.role || "").toLowerCase());
}

export function BonusesPage() {
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const qc = useQueryClient();
  const { user } = useAuth();
  const openInspector = useInspectorStore((s) => s.openInspector);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [form, setForm] = useState<BonusForm>(() => emptyForm(month));
  const [reqForm, setReqForm] = useState({ employeeId: "", amount: "", date: "", reason: "" });

  const canSubmit = canSubmitBonusRequest(user);
  const canApprove = canApproveBonusRequest(user);
  const canManage = canManageBonuses(user);
  const canAdd = canAddBonusTransfer(user);
  const transferOnly = canAdd && !canManage;

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
    queryFn: () =>
      api<{ employees: { id: string; american_name?: string; unit?: string; team?: string; status?: string }[] }>(
        path("/employees")
      ),
  });

  const { data: pickerScope } = useQuery({
    queryKey: ["bonuses-picker-scope", companyContext],
    queryFn: () =>
      api<{
        recipients: { id: string; american_name?: string; unit?: string; team?: string }[];
        payers: { id: string; american_name?: string; unit?: string; team?: string }[];
        canManageWide?: boolean;
      }>(path("/bonuses/picker-scope")),
    enabled: canAdd || canSubmit,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bonuses", month] });
    qc.invalidateQueries({ queryKey: ["bonus-requests"] });
    qc.invalidateQueries({ queryKey: ["payslip-bundle"] });
    qc.invalidateQueries({ queryKey: ["payroll-full"] });
    qc.invalidateQueries({ queryKey: ["deductions"] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        employeeId: form.employeeId,
        type: form.type || "Other Bonus",
        amount: Number(form.amount),
        date: form.date || `${month}-01`,
        reason: form.reason,
        deductFromEmployeeId:
          form.type === TL_BONUS_TYPE ? form.deductFromEmployeeId || undefined : undefined,
        ...(companyContext === "hs2" ? { company: "hs2" } : {}),
      };
      if (editing) {
        return api(path("/bonuses"), {
          method: "PATCH",
          body: JSON.stringify({
            originalEmployeeId: String(editing.employeeId || ""),
            originalDate: String(editing.date || "").slice(0, 10),
            originalType: String(editing.type || ""),
            ...body,
          }),
        });
      }
      return api(path("/bonuses"), {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm(month));
    },
  });

  const remove = useMutation({
    mutationFn: (row: Row) =>
      api(path("/bonuses"), {
        method: "DELETE",
        body: JSON.stringify({
          employeeId: String(row.employeeId || ""),
          date: String(row.date || "").slice(0, 10),
          type: String(row.type || ""),
          ...(companyContext === "hs2" ? { company: "hs2" } : {}),
        }),
      }),
    onSuccess: () => {
      invalidate();
      setDeleteRow(null);
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
    mutationFn: ({
      id,
      action,
      denyReason: reason,
    }: {
      id: string;
      action: "approve" | "deny";
      denyReason?: string;
    }) =>
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

  const openAdd = () => {
    setEditing(null);
    const base = emptyForm(month);
    if (transferOnly) {
      base.type = TL_BONUS_TYPE;
    }
    setForm(base);
    setDialogOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm(rowToForm(row));
    setDialogOpen(true);
  };

  const rows = data?.bonuses || [];
  const requests = reqData?.requests || [];
  const recipientOptions =
    pickerScope?.recipients?.length
      ? pickerScope.recipients
      : (emps?.employees || []).filter((e) => !isLeadershipEmployeeId(e.id));
  const payerOptions =
    pickerScope?.payers?.length
      ? pickerScope.payers
      : (emps?.employees || []).filter((e) => isBonusTransferPayerId(e.id));
  const isTlBonusForm = form.type === TL_BONUS_TYPE;
  const bonusTypes = transferOnly
    ? [TL_BONUS_TYPE]
    : data?.types || [];

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const cols: ColumnDef<Row>[] = [
      {
        accessorKey: "date",
        header: "Date",
        cell: (c) => String(c.getValue() || "").slice(0, 10) || "—",
      },
      {
        accessorKey: "employeeId",
        header: "ID",
        cell: (c) => String(c.getValue() || "—"),
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: (c) => String(c.getValue() || "—"),
      },
      {
        accessorKey: "amount",
        header: "Amount",
        cell: (c) => fmt(c.getValue() as number),
      },
      {
        accessorKey: "reason",
        header: "Reason",
        cell: (c) => String(c.getValue() || "—"),
      },
    ];
    if (canManage) {
      cols.push({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <span style={{ display: "flex", gap: "0.25rem" }} onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="secondary" onClick={() => openEdit(row.original)}>
              Edit
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDeleteRow(row.original)}>
              Delete
            </Button>
          </span>
        ),
      });
    }
    return cols;
  }, [canManage, month]);

  return (
    <div>
      <SectionHeader
        title="Bonuses"
        subtitle={monthLabel(month)}
        actions={
          canAdd ? (
            <Button onClick={openAdd}>{transferOnly ? "Add bonus (transfer)" : "Add bonus"}</Button>
          ) : undefined
        }
      />

      {(canSubmit || canApprove) && (
        <Card style={{ marginBottom: "1rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.75rem",
            }}
          >
            <h3 style={{ margin: 0 }}>
              Bonus requests {canApprove ? "(pending approval)" : ""}
            </h3>
            {canSubmit && (
              <Button size="sm" onClick={() => setReqOpen(true)}>
                + Request bonus for agent
              </Button>
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
                      <td
                        align="right"
                        style={{ display: "flex", gap: "0.35rem", justifyContent: "flex-end" }}
                      >
                        <Button
                          size="sm"
                          onClick={() => reviewReq.mutate({ id: r.id, action: "approve" })}
                          disabled={reviewReq.isPending}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDenyOpen(r.id)}
                          disabled={reviewReq.isPending}
                        >
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
            onRowClick={(row) =>
              openInspector(`Bonus — ${row.employeeId}`, <InspectorDetail row={row} />)
            }
          />
        )}
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
        title={editing ? "Edit bonus" : "Add bonus"}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending ||
                !form.employeeId ||
                !form.amount ||
                (isTlBonusForm && !form.deductFromEmployeeId)
              }
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <FormGrid wide>
          <FormField label="Employee">
            <Select
              searchable
              value={form.employeeId}
              onChange={(employeeId) => setForm({ ...form, employeeId })}
              options={[
                { value: "", label: "—" },
                ...recipientOptions.map((e) => ({
                  value: e.id,
                  label: `${e.id} — ${e.american_name || ""}${e.unit ? ` (${e.unit}${e.team ? ` / ${e.team}` : ""})` : ""}`,
                })),
              ]}
            />
          </FormField>
          <FormField label="Type">
            <Select
              value={form.type}
              onChange={(type) => setForm({ ...form, type, deductFromEmployeeId: "" })}
              disabled={transferOnly}
              options={[
                { value: "", label: "—" },
                ...bonusTypes.map((t) => ({ value: t, label: t })),
              ]}
            />
          </FormField>
          {isTlBonusForm ? (
            <FormField label="Deduct from (pays)" span="full">
              <Select
                searchable
                value={form.deductFromEmployeeId}
                onChange={(deductFromEmployeeId) => setForm({ ...form, deductFromEmployeeId })}
                options={[
                  {
                    value: "",
                    label: canManage
                      ? "— Select anyone —"
                      : "— Select payer (TL / OP / RTM / Quality / HR) —",
                  },
                  ...payerOptions.map((e) => ({
                    value: e.id,
                    label: `${e.id} — ${e.american_name || ""}${e.unit ? ` (${e.unit})` : ""}`,
                  })),
                ]}
              />
            </FormField>
          ) : null}
          <FormField label="Amount">
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </FormField>
          <FormField label="Date">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </FormField>
          <FormField label="Reason" span="full">
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </FormField>
        </FormGrid>
        {save.isError && <p style={{ color: "var(--err)" }}>{(save.error as Error).message}</p>}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteRow)}
        onOpenChange={(o) => !o && setDeleteRow(null)}
        title="Delete bonus?"
        message={
          deleteRow
            ? `Remove ${String(deleteRow.type || "bonus")} (${fmt(Number(deleteRow.amount) || 0)} EGP) for ${String(deleteRow.employeeId)} on ${String(deleteRow.date || "").slice(0, 10)}?`
            : ""
        }
        danger
        confirmLabel={remove.isPending ? "Deleting…" : "Delete"}
        onConfirm={() => {
          if (deleteRow && !remove.isPending) remove.mutate(deleteRow);
        }}
      />

      <Dialog
        open={reqOpen}
        onOpenChange={setReqOpen}
        title="Request bonus for agent"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setReqOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => submitReq.mutate()}
              disabled={submitReq.isPending || !reqForm.employeeId || !reqForm.amount}
            >
              Submit for approval
            </Button>
          </>
        }
      >
        <FormGrid wide>
          <FormField label="Agent">
            <Select
              searchable
              value={reqForm.employeeId}
              onChange={(employeeId) => setReqForm({ ...reqForm, employeeId })}
              options={[
                { value: "", label: "—" },
                ...recipientOptions.map((e) => ({
                  value: e.id,
                  label: `${e.id} — ${e.american_name || ""}${e.unit ? ` (${e.unit}${e.team ? ` / ${e.team}` : ""})` : ""}`,
                })),
              ]}
            />
          </FormField>
          <FormField label="Date">
            <input
              type="date"
              value={reqForm.date || `${month}-15`}
              onChange={(e) => setReqForm({ ...reqForm, date: e.target.value })}
            />
          </FormField>
          <FormField label="Amount">
            <input
              type="number"
              step="0.01"
              value={reqForm.amount}
              onChange={(e) => setReqForm({ ...reqForm, amount: e.target.value })}
            />
          </FormField>
          <FormField label="Type">
            <input value={TL_BONUS_TYPE} readOnly />
          </FormField>
          <FormField label="Reason" span="full">
            <input
              value={reqForm.reason}
              onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })}
            />
          </FormField>
        </FormGrid>
        {submitReq.isError && (
          <p style={{ color: "var(--err)" }}>{(submitReq.error as Error).message}</p>
        )}
      </Dialog>

      <Dialog
        open={!!denyOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDenyOpen(null);
            setDenyReason("");
          }
        }}
        title="Deny bonus request"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDenyOpen(null);
                setDenyReason("");
              }}
            >
              Cancel
            </Button>
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
          <input
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder="Reason"
          />
        </FormField>
      </Dialog>
    </div>
  );
}
