import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fmt } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FormField } from "@/ui/FormGrid";
import { StatusPill } from "@/ui/StatusPill";

type Req = {
  id: string;
  employeeId?: string;
  totalAmount?: number;
  installmentAmount?: number;
  installmentsCount?: number;
  status?: string;
  submittedBy?: string;
  notes?: string;
  createdAt?: string;
};

export function LoanApprovalsPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [denyId, setDenyId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["loan-requests", companyContext],
    queryFn: () => api<{ requests?: Req[] }>(path("/loan-requests", { status: "pending" })),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api(path(`/loan-requests/${encodeURIComponent(id)}/approve`), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loan-requests"] }),
  });

  const deny = useMutation({
    mutationFn: () => api(path(`/loan-requests/${encodeURIComponent(denyId!)}/deny`), { method: "POST", body: JSON.stringify({ denyReason }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["loan-requests"] }); setDenyId(null); setDenyReason(""); },
  });

  const rows = data?.requests || [];

  return (
    <div>
      <SectionHeader title="Loan approvals" subtitle={`${rows.length} pending`} />
      <Card>
        {isLoading && <p className="muted">Loading…</p>}
        <div className="table-wrap">
          <table style={{ width: "100%", fontSize: "0.85rem" }}>
            <thead><tr><th align="left">Employee</th><th align="right">Amount</th><th>Submitted by</th><th>Notes</th><th align="right">Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.employeeId}</code></td>
                  <td align="right">{fmt(r.totalAmount)} EGP</td>
                  <td>{r.submittedBy}</td>
                  <td className="muted">{r.notes || "—"}</td>
                  <td align="right" style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
                    <Button size="sm" onClick={() => { if (confirm("Approve this loan request?")) approve.mutate(r.id); }}>Approve</Button>
                    <Button size="sm" variant="danger" onClick={() => setDenyId(r.id)}>Deny</Button>
                  </td>
                </tr>
              ))}
              {!rows.length && !isLoading && <tr><td colSpan={5} className="muted">No pending loan requests</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <Dialog open={!!denyId} onOpenChange={(o) => !o && setDenyId(null)} title="Deny loan request" footer={<><Button variant="secondary" onClick={() => setDenyId(null)}>Cancel</Button><Button variant="danger" onClick={() => deny.mutate()}>Deny</Button></>}>
        <FormField label="Reason"><input value={denyReason} onChange={(e) => setDenyReason(e.target.value)} placeholder="Optional reason" /></FormField>
      </Dialog>
    </div>
  );
}
