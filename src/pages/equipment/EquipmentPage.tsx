import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { joinEquipmentRows } from "@/api/extractRows";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { DataGrid } from "@/ui/DataGrid";
import { Dialog } from "@/ui/Dialog";
import { col } from "@/api/columnMaps";
import type { ColumnDef } from "@tanstack/react-table";

const DEVICE_TYPES = ["Mouse", "Keyboard", "Laptop", "Workstation", "Headset", "Phone", "Mini router"];

type Row = Record<string, unknown>;
type Employee = { id: string; american_name?: string; arabic_name?: string; unit?: string; team?: string; position?: string; status?: string };

export function EquipmentPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [searchParams] = useSearchParams();
  const [agentFilter, setAgentFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [issueForm, setIssueForm] = useState({ employeeId: "", itemType: "Laptop", notes: "" });
  const [editForm, setEditForm] = useState({ itemType: "", notes: "" });

  useEffect(() => {
    const emp = searchParams.get("employee");
    if (emp) setAgentFilter(emp);
  }, [searchParams]);

  const { user } = useAppStatus();

  const inventory = user?.canViewEquipmentInventory === true;
  const selfId = String(user?.employeeId || "");

  const { data: equipData, isLoading } = useQuery({
    queryKey: ["equipment", inventory ? "all" : selfId, companyContext],
    queryFn: () =>
      inventory
        ? api<Record<string, unknown>>(path("/hrms/equipment"))
        : api<Record<string, unknown>>(path(`/hrms/equipment/${encodeURIComponent(selfId)}`)),
    enabled: inventory || Boolean(selfId),
  });

  const { data: empData } = useQuery({
    queryKey: ["employees-equip", companyContext],
    queryFn: () => api<{ employees: Employee[] }>(path("/employees")),
    enabled: inventory,
  });

  const employees = (empData?.employees || []).filter((e) => String(e.status || "").toLowerCase() !== "out");
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const rows = useMemo(() => {
    let list = joinEquipmentRows(equipData);
    if (agentFilter) list = list.filter((r) => r.employeeId === agentFilter);
    if (unitFilter) list = list.filter((r) => empById.get(String(r.employeeId))?.unit === unitFilter);
    if (teamFilter) list = list.filter((r) => empById.get(String(r.employeeId))?.team === teamFilter);
    if (deviceFilter) list = list.filter((r) => r.itemType === deviceFilter);
    return list.map((r) => {
      const emp = empById.get(String(r.employeeId));
      return {
        ...r,
        agentName: emp?.american_name || emp?.arabic_name || r.employeeId,
        unit: emp?.unit || r.unit,
      };
    });
  }, [equipData, agentFilter, unitFilter, teamFilter, deviceFilter, empById]);

  const issue = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api(path("/hrms/equipment"), { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment"] });
      setIssueOpen(false);
      setIssueForm({ employeeId: "", itemType: "Laptop", notes: "" });
    },
  });

  const editEquip = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      api(path(`/hrms/equipment/${id}`), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment"] });
      setEditRow(null);
    },
  });

  const returnEquip = useMutation({
    mutationFn: (assignmentId: string) =>
      api(path(`/hrms/equipment/return/${assignmentId}`), { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["equipment"] }),
  });

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      col.accessor("Agent", (r) => `${r.agentName} (${r.employeeId})`),
      col.text("itemType", "Device"),
      col.text("unit", "Unit"),
      col.text("notes", "Notes"),
      col.accessor("Issued", (r) => String(r.assignedAt || "").slice(0, 10)),
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <span style={{ display: "flex", gap: "0.25rem" }}>
            {inventory && user?.canIssueEquipment && (
              <>
                <Button size="sm" variant="secondary" onClick={() => {
                  setEditRow(row.original);
                  setEditForm({ itemType: String(row.original.itemType || ""), notes: String(row.original.notes || "") });
                }}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => {
                  if (confirm("Mark this device as returned?")) returnEquip.mutate(String(row.original.id));
                }}>Return</Button>
              </>
            )}
          </span>
        ),
      },
    ],
    [inventory, user?.canIssueEquipment, returnEquip]
  );

  if (!inventory && !selfId) {
    return (
      <div>
        <SectionHeader title="Equipment" />
        <Card><p className="muted">Equipment is only visible for your own assigned devices.</p></Card>
      </div>
    );
  }

  const meta = equipData as { units?: string[]; teams?: string[]; deviceTypes?: string[] } | undefined;

  return (
    <div>
      <SectionHeader
        title={inventory ? "Equipment" : "My equipment"}
        subtitle={`${rows.length} active device(s)`}
        actions={
          inventory && user?.canIssueEquipment ? (
            <Button onClick={() => setIssueOpen(true)}>+ Issue device</Button>
          ) : undefined
        }
      />

      {inventory && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <input
            type="search"
            placeholder="Filter by agent ID…"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            style={{ minWidth: "12rem" }}
          />
          <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
            <option value="">All units</option>
            {(meta?.units || []).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">All teams</option>
            {(meta?.teams || []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)}>
            <option value="">All devices</option>
            {(meta?.deviceTypes || DEVICE_TYPES).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {(agentFilter || unitFilter || teamFilter || deviceFilter) && (
            <Button variant="secondary" size="sm" onClick={() => { setAgentFilter(""); setUnitFilter(""); setTeamFilter(""); setDeviceFilter(""); }}>Clear filters</Button>
          )}
        </div>
      )}

      <Card>
        {isLoading ? <p className="muted">Loading…</p> : <DataGrid data={rows} columns={columns} virtualize={rows.length > 50} />}
      </Card>

      <Dialog open={issueOpen} onOpenChange={setIssueOpen} title="Issue device" footer={
        <>
          <Button variant="secondary" onClick={() => setIssueOpen(false)}>Cancel</Button>
          <Button onClick={() => issue.mutate(issueForm)} disabled={!issueForm.employeeId}>Issue</Button>
        </>
      }>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <label>
            <span className="muted">Agent</span>
            <select value={issueForm.employeeId} onChange={(e) => setIssueForm({ ...issueForm, employeeId: e.target.value })} style={{ width: "100%" }}>
              <option value="">— Select —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.american_name || e.id} ({e.id})</option>)}
            </select>
          </label>
          <label>
            <span className="muted">Device</span>
            <select value={issueForm.itemType} onChange={(e) => setIssueForm({ ...issueForm, itemType: e.target.value })} style={{ width: "100%" }}>
              {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>
            <span className="muted">Notes</span>
            <textarea value={issueForm.notes} onChange={(e) => setIssueForm({ ...issueForm, notes: e.target.value })} rows={2} style={{ width: "100%" }} />
          </label>
        </div>
      </Dialog>

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)} title="Edit equipment" footer={
        <>
          <Button variant="secondary" onClick={() => setEditRow(null)}>Cancel</Button>
          <Button onClick={() => editEquip.mutate({
            id: String(editRow?.equipmentId),
            body: { itemType: editForm.itemType, notes: editForm.notes },
          })}>Save</Button>
        </>
      }>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <label>
            <span className="muted">Device</span>
            <select value={editForm.itemType} onChange={(e) => setEditForm({ ...editForm, itemType: e.target.value })} style={{ width: "100%" }}>
              {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>
            <span className="muted">Notes</span>
            <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} style={{ width: "100%" }} />
          </label>
        </div>
      </Dialog>
    </div>
  );
}
