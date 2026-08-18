import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { joinEquipmentRows } from "@/api/extractRows";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card, StatTile } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { DataGrid } from "@/ui/DataGrid";
import { Dialog } from "@/ui/Dialog";
import { PageToolbar, SearchField, FilterSelect } from "@/ui/PageToolbar";
import { StatusPill } from "@/ui/StatusPill";
import { Select } from "@/ui/Select";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { col } from "@/api/columnMaps";
import type { ColumnDef } from "@tanstack/react-table";
import styles from "./EquipmentPage.module.css";

const DEVICE_TYPES = ["Mouse", "Keyboard", "Laptop", "Workstation", "Headset", "Phone", "Mini router"];

type Row = Record<string, unknown>;
type Employee = {
  id: string;
  american_name?: string;
  arabic_name?: string;
  unit?: string;
  team?: string;
  position?: string;
  status?: string;
};

function isOutEmployee(e: Employee) {
  const s = String(e.status || "").toLowerCase();
  return s === "out" || s.includes("out");
}

function empLabel(e: Employee) {
  return `${e.american_name || e.arabic_name || e.id} (${e.id})`;
}

export function EquipmentPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const employeeParam = searchParams.get("employee") || "";
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [issueForm, setIssueForm] = useState({ employeeId: "", itemType: "Laptop", notes: "" });
  const [pickerSearch, setPickerSearch] = useState("");
  const [editForm, setEditForm] = useState({ itemType: "", notes: "" });

  const { user, refreshStatus } = useAppStatus();

  const inventory = user?.canViewEquipmentInventory === true;
  const selfId = String(user?.employeeId || "");

  const { data: equipData, isLoading, error } = useQuery({
    queryKey: ["equipment", inventory ? "all" : selfId, companyContext],
    queryFn: () =>
      inventory
        ? api<Record<string, unknown>>(path("/hrms/equipment"))
        : api<Record<string, unknown>>(path(`/hrms/equipment/${encodeURIComponent(selfId)}`)),
    enabled: inventory || Boolean(selfId),
  });

  const roster = useMemo(() => {
    const fromApi = (equipData as { employees?: Employee[] } | undefined)?.employees;
    return Array.isArray(fromApi) ? fromApi : [];
  }, [equipData]);
  const empById = useMemo(() => new Map(roster.map((e) => [e.id, e])), [roster]);
  const issueTargets = useMemo(() => roster.filter((e) => !isOutEmployee(e)), [roster]);
  const pickerMatches = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return issueTargets.slice(0, 80);
    return issueTargets
      .filter((e) =>
        [e.id, e.american_name, e.arabic_name, e.team, e.unit].some((v) => String(v || "").toLowerCase().includes(q))
      )
      .slice(0, 80);
  }, [issueTargets, pickerSearch]);

  const selectedIssue = issueTargets.find((e) => e.id === issueForm.employeeId);

  const rows = useMemo(() => {
    let list = joinEquipmentRows(equipData);
    if (employeeParam) list = list.filter((r) => String(r.employeeId) === employeeParam);
    if (unitFilter) {
      list = list.filter((r) => (empById.get(String(r.employeeId))?.unit || r.unit) === unitFilter);
    }
    if (teamFilter) {
      list = list.filter((r) => empById.get(String(r.employeeId))?.team === teamFilter);
    }
    if (deviceFilter) list = list.filter((r) => r.itemType === deviceFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const emp = empById.get(String(r.employeeId));
        return [r.employeeId, emp?.american_name, emp?.arabic_name, r.itemType, r.assetTag].some((v) =>
          String(v || "").toLowerCase().includes(q)
        );
      });
    }
    return list.map((r) => {
      const emp = empById.get(String(r.employeeId));
      return {
        ...r,
        agentName: emp?.american_name || emp?.arabic_name || r.employeeId,
        unit: emp?.unit || r.unit,
        empStatus: emp?.status || "",
        empOut: emp ? isOutEmployee(emp) : false,
      };
    });
  }, [equipData, employeeParam, unitFilter, teamFilter, deviceFilter, search, empById]);

  const allOpen = useMemo(() => joinEquipmentRows(equipData), [equipData]);
  const peopleWithDevices = useMemo(() => new Set(allOpen.map((r) => String(r.employeeId))).size, [allOpen]);

  const filteredEmp = employeeParam ? empById.get(employeeParam) : undefined;
  const filteredOutWithDevices = Boolean(filteredEmp && isOutEmployee(filteredEmp) && rows.length);

  const invalidateEquip = async () => {
    await qc.invalidateQueries({ queryKey: ["equipment"] });
    await qc.invalidateQueries({ queryKey: ["clearance-board"] });
    await qc.invalidateQueries({ queryKey: ["hrms-equipment-employee"] });
    await refreshStatus().catch(() => {});
  };

  const issue = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api(path("/hrms/equipment"), { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (_data, body) => {
      setIssueOpen(false);
      setIssueForm({ employeeId: "", itemType: "Laptop", notes: "" });
      setPickerSearch("");
      const id = body.employeeId;
      if (id) {
        const next = new URLSearchParams(searchParams);
        next.set("employee", id);
        setSearchParams(next, { replace: true });
      }
      invalidateEquip();
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
    onSuccess: () => invalidateEquip(),
  });

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "name",
        header: "Employee",
        accessorFn: (r) => r.agentName || r.employeeId,
        cell: ({ row, getValue }) => (
          <div className={styles.nameCell}>
            <strong>{String(getValue() || "—")}</strong>
            {row.original.empOut ? <StatusPill variant="err">Out</StatusPill> : null}
          </div>
        ),
      },
      {
        accessorKey: "employeeId",
        header: "ID",
        cell: (c) => <code>{String(c.getValue())}</code>,
      },
      { accessorKey: "itemType", header: "Device", cell: (c) => String(c.getValue() ?? "—") },
      col.text("assetTag", "Tag"),
      col.text("unit", "Unit"),
      col.text("notes", "Notes"),
      col.accessor("Issued", (r) => String(r.assignedAt || "").slice(0, 10)),
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          inventory && user?.canIssueEquipment ? (
            <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditRow(row.original);
                  setEditForm({
                    itemType: String(row.original.itemType || ""),
                    notes: String(row.original.notes || ""),
                  });
                }}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={returnEquip.isPending}
                onClick={() => {
                  if (confirm("Mark this device as returned?")) returnEquip.mutate(String(row.original.id));
                }}
              >
                Return
              </Button>
            </div>
          ) : null,
      },
    ],
    [inventory, user?.canIssueEquipment, returnEquip]
  );

  const selfColumns = useMemo<ColumnDef<Row>[]>(
    () => [
      { accessorKey: "itemType", header: "Device", cell: (c) => String(c.getValue() ?? "—") },
      col.text("assetTag", "Tag"),
      col.text("notes", "Notes"),
      col.accessor("Issued", (r) => String(r.assignedAt || "").slice(0, 10)),
    ],
    []
  );

  if (!inventory && !selfId) {
    return (
      <div>
        <SectionHeader title="Equipment" />
        <Card>
          <p className="muted">This tab appears when a device is issued to you.</p>
        </Card>
      </div>
    );
  }

  const meta = equipData as { units?: string[]; teams?: string[]; deviceTypes?: string[] } | undefined;

  const setEmployeeParam = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("employee", id);
    else next.delete("employee");
    setSearchParams(next, { replace: true });
  };

  const issueFooter: ReactNode = (
    <>
      <Button variant="secondary" onClick={() => setIssueOpen(false)}>
        Cancel
      </Button>
      <Button onClick={() => issue.mutate(issueForm)} disabled={!issueForm.employeeId || issue.isPending}>
        {issue.isPending ? "Issuing…" : "Issue device"}
      </Button>
    </>
  );

  return (
    <div>
      <SectionHeader
        title={inventory ? "Equipment" : "My equipment"}
        subtitle={
          inventory
            ? `${rows.length} shown · ${allOpen.length} devices out`
            : `${rows.length} device${rows.length === 1 ? "" : "s"} assigned to you`
        }
        actions={
          inventory && user?.canIssueEquipment ? (
            <Button onClick={() => setIssueOpen(true)}>+ Issue device</Button>
          ) : undefined
        }
      />

      {inventory && (
        <div className="stat-grid">
          <StatTile value={String(allOpen.length)} label="Active devices" />
          <StatTile value={String(peopleWithDevices)} label="People with devices" />
          <StatTile value={String(rows.length)} label="Showing" />
        </div>
      )}

      {inventory && (
        <PageToolbar>
          <SearchField value={search} onChange={setSearch} placeholder="Search name, Arabic name, or ID…" />
          <FilterSelect label="Unit" value={unitFilter} onChange={setUnitFilter} options={meta?.units || []} allLabel="All units" />
          <FilterSelect label="Team" value={teamFilter} onChange={setTeamFilter} options={meta?.teams || []} allLabel="All teams" />
          <FilterSelect
            label="Device"
            value={deviceFilter}
            onChange={setDeviceFilter}
            options={meta?.deviceTypes || DEVICE_TYPES}
            allLabel="All devices"
          />
          {employeeParam ? (
            <Button variant="secondary" size="sm" onClick={() => setEmployeeParam("")}>
              Clear person
            </Button>
          ) : null}
        </PageToolbar>
      )}

      {filteredOutWithDevices && (
        <div className={styles.warnBanner} role="status">
          <span>
            <strong>{empLabel(filteredEmp!)}</strong> is Out and still has devices on this list.
          </span>
          <Link to={`/clearance?employee=${encodeURIComponent(employeeParam)}`}>
            <Button size="sm">Open Clearance</Button>
          </Link>
        </div>
      )}

      <Card>
        {isLoading && <p className="muted">Loading…</p>}
        {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
        {!isLoading && !error && (
          <DataGrid
            data={rows}
            columns={inventory ? columns : selfColumns}
            virtualize={rows.length > 50}
            emptyMessage={
              inventory
                ? "No active devices match filters"
                : "No devices assigned"
            }
          />
        )}
      </Card>

      <Dialog
        open={issueOpen}
        onOpenChange={(o) => {
          setIssueOpen(o);
          if (o) issue.reset();
          else setPickerSearch("");
        }}
        title="Issue device"
        footer={issueFooter}
      >
        <FormGrid>
          <div style={{ gridColumn: "1 / -1" }}>
            <p className="muted" style={{ margin: "0 0 0.3rem", fontSize: "0.75rem" }}>
              Person
            </p>
            {selectedIssue ? (
              <div className={styles.selectedAgent}>
                <div>
                  <strong>{selectedIssue.american_name || selectedIssue.arabic_name || selectedIssue.id}</strong>
                  <span className={styles.pickerMeta}>
                    {selectedIssue.id}
                    {selectedIssue.unit ? ` · ${selectedIssue.unit}` : ""}
                    {selectedIssue.team ? ` · ${selectedIssue.team}` : ""}
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setIssueForm({ ...issueForm, employeeId: "" })}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <FormField label="Name or ID">
                  <input
                    type="search"
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder="Search active employees…"
                  />
                </FormField>
                <ul className={styles.pickerList}>
                  {pickerMatches.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setIssueForm({ ...issueForm, employeeId: e.id });
                          setPickerSearch("");
                        }}
                      >
                        <strong>{e.american_name || e.arabic_name || e.id}</strong>
                        <span className={styles.pickerMeta}>
                          {e.id}
                          {e.unit ? ` · ${e.unit}` : ""}
                          {e.team ? ` · ${e.team}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!pickerMatches.length && (
                    <li className="muted" style={{ padding: "0.6rem" }}>
                      No active employees match.
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>
          <FormField label="Device type">
            <Select
              value={issueForm.itemType}
              options={DEVICE_TYPES.map((t) => ({ value: t, label: t }))}
              onChange={(v) => setIssueForm({ ...issueForm, itemType: v })}
            />
          </FormField>
          <FormField label="Notes" span="full">
            <textarea
              value={issueForm.notes}
              onChange={(e) => setIssueForm({ ...issueForm, notes: e.target.value })}
              rows={2}
              placeholder="Optional — desk, condition, accessories…"
            />
          </FormField>
        </FormGrid>
        {issue.isError && <p className={styles.error}>{(issue.error as Error).message || "Could not issue device"}</p>}
      </Dialog>

      <Dialog
        open={!!editRow}
        onOpenChange={(o) => !o && setEditRow(null)}
        title="Edit equipment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditRow(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                editEquip.mutate({
                  id: String(editRow?.equipmentId),
                  body: { itemType: editForm.itemType, notes: editForm.notes },
                })
              }
              disabled={editEquip.isPending}
            >
              {editEquip.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <FormGrid>
          <FormField label="Device type">
            <Select
              value={editForm.itemType}
              options={DEVICE_TYPES.map((t) => ({ value: t, label: t }))}
              onChange={(v) => setEditForm({ ...editForm, itemType: v })}
            />
          </FormField>
          <FormField label="Notes" span="full">
            <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} />
          </FormField>
        </FormGrid>
        {editEquip.isError && (
          <p className={styles.error}>{(editEquip.error as Error).message || "Could not save equipment"}</p>
        )}
      </Dialog>
      {returnEquip.isError && (
        <p className={styles.error}>{(returnEquip.error as Error).message || "Could not return device"}</p>
      )}
    </div>
  );
}
