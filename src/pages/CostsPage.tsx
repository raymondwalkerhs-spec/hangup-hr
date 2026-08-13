import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, fmt } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { DataGrid } from "@/ui/DataGrid";
import { Card, StatTile } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { InspectorDetail } from "@/ui/InspectorDetail";
import { useInspectorStore } from "@/stores/cross-filter-store";
import * as Tabs from "@radix-ui/react-tabs";
import styles from "./CostsPage.module.css";

type Row = Record<string, unknown>;

export function CostsPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const openInspector = useInspectorStore((s) => s.openInspector);
  const [actionRow, setActionRow] = useState<Row | null>(null);
  const [actionType, setActionType] = useState<"approve" | "paid" | "deposit" | null>(null);
  const [depositAmount, setDepositAmount] = useState("");

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["expenses", companyContext],
    queryFn: () => api<{ expenses: Row[] }>(path("/expenses")),
  });

  const { data: funds } = useQuery({
    queryKey: ["petty-cash", companyContext],
    queryFn: () => api<{ funds: { fundName: string; balance: number }[] }>(path("/expenses/petty-cash/funds")),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api(path(`/expenses/${id}/approve`), { method: "POST", body: "{}" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); setActionRow(null); },
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => api(path(`/expenses/${id}/mark-paid`), { method: "POST", body: "{}" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); setActionRow(null); },
  });

  const deposit = useMutation({
    mutationFn: (amount: number) =>
      api(path("/expenses/petty-cash/deposit"), {
        method: "POST",
        body: JSON.stringify({
          amount,
          notes: "Manual deposit",
          ...(companyContext === "hs2" ? { company: "hs2" } : {}),
        }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["petty-cash", "ledger"] }); setActionType(null); },
  });

  const rows = expenses?.expenses || [];
  const balance = funds?.funds?.[0]?.balance ?? 0;
  const pending = rows.filter((r) => r.status === "pending");

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { accessorKey: "dueDate", header: "Date", cell: (c) => String(c.getValue() || c.row.original.due_date || "").slice(0, 10) },
      { accessorKey: "description", header: "Description", cell: (c) => String(c.getValue() || "—") },
      { accessorKey: "amount", header: "Amount", cell: (c) => fmt(c.getValue() as number) },
      { accessorKey: "status", header: "Status" },
      { accessorKey: "paidBy", header: "Paid by", cell: (c) => String(c.getValue() || c.row.original.paid_by || "—") },
      { accessorKey: "category", header: "Category" },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <span style={{ display: "flex", gap: "0.25rem" }}>
            {row.original.status === "pending" && (
              <Button size="sm" onClick={() => { setActionRow(row.original); setActionType("approve"); }}>Approve</Button>
            )}
            {row.original.status === "approved" && (
              <Button size="sm" onClick={() => { setActionRow(row.original); setActionType("paid"); }}>Mark paid</Button>
            )}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div>
      <SectionHeader
        title="Costs"
        subtitle={`${rows.length} expenses · balance ${fmt(balance)} EGP`}
        actions={<Button variant="secondary" onClick={() => setActionType("deposit")}>Deposit</Button>}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
        <StatTile value={fmt(balance)} label="Petty cash balance" accent />
        <StatTile value={pending.length} label="Pending approval" />
        <StatTile value={rows.filter((r) => r.status === "paid").length} label="Paid" />
      </div>

      <Tabs.Root defaultValue="expenses">
        <Tabs.List className={styles.tabs}>
          <Tabs.Trigger value="queue" className={styles.tab}>Approval queue ({pending.length})</Tabs.Trigger>
          <Tabs.Trigger value="expenses" className={styles.tab}>All expenses</Tabs.Trigger>
          <Tabs.Trigger value="ledger" className={styles.tab}>Ledger</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="queue">
          <Card>
            <DataGrid
              data={pending}
              columns={columns}
              onRowClick={(row) => openInspector("Expense", <InspectorDetail row={row} />)}
              emptyMessage="No pending expenses"
            />
          </Card>
        </Tabs.Content>
        <Tabs.Content value="expenses">
          <Card>
            {isLoading ? <p className="muted">Loading…</p> : (
              <DataGrid data={rows} columns={columns} virtualize onRowClick={(row) => openInspector("Expense", <InspectorDetail row={row} />)} />
            )}
          </Card>
        </Tabs.Content>
        <Tabs.Content value="ledger">
          <LedgerTimeline />
        </Tabs.Content>
      </Tabs.Root>

      <Dialog
        open={actionType === "approve" && !!actionRow}
        onOpenChange={(o) => !o && setActionRow(null)}
        title="Approve expense"
        footer={
          <>
            <Button variant="secondary" onClick={() => setActionRow(null)}>Cancel</Button>
            <Button onClick={() => approve.mutate(String(actionRow?.id))}>Approve</Button>
          </>
        }
      >
        <p>Approve <strong>{String(actionRow?.description)}</strong> for {fmt(actionRow?.amount as number)} EGP?</p>
      </Dialog>

      <Dialog
        open={actionType === "paid" && !!actionRow}
        onOpenChange={(o) => !o && setActionRow(null)}
        title="Mark as paid"
        footer={
          <>
            <Button variant="secondary" onClick={() => setActionRow(null)}>Cancel</Button>
            <Button onClick={() => markPaid.mutate(String(actionRow?.id))}>Mark paid</Button>
          </>
        }
      >
        <p>Mark <strong>{String(actionRow?.description)}</strong> as paid?</p>
      </Dialog>

      <Dialog
        open={actionType === "deposit"}
        onOpenChange={(o) => !o && setActionType(null)}
        title="Deposit to petty cash"
        footer={
          <>
            <Button variant="secondary" onClick={() => setActionType(null)}>Cancel</Button>
            <Button onClick={() => deposit.mutate(Number(depositAmount))} disabled={!depositAmount}>Deposit</Button>
          </>
        }
      >
        <label>
          <span className="muted">Amount (EGP)</span>
          <input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} style={{ width: "100%" }} />
        </label>
      </Dialog>
    </div>
  );
}

function LedgerTimeline() {
  const { path, companyContext } = useCompanyScope();
  const { data } = useQuery({
    queryKey: ["ledger", companyContext],
    queryFn: () => api<{ entries: { created_at: string; createdAt?: string; amount: number; transaction_type: string; transactionType?: string; notes?: string }[] }>(path("/expenses/petty-cash/ledger")),
  });
  const entries = data?.entries || [];
  return (
    <Card>
      <div className={styles.river}>
        {entries.map((e, i) => {
          const type = e.transaction_type || e.transactionType || "";
          const date = e.created_at || e.createdAt || "";
          return (
            <div key={i} className={`${styles.riverCard} ${type === "deposit" ? styles.in : styles.out}`}>
              <span>{String(date).slice(0, 10)}</span>
              <strong className="tabular-nums">{type === "deposit" ? "+" : "−"}{fmt(e.amount)}</strong>
              <span className="muted">{e.notes}</span>
            </div>
          );
        })}
        {!entries.length && <p className="muted">No ledger entries</p>}
      </div>
    </Card>
  );
}
