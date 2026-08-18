import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card, StatTile } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { StatusPill } from "@/ui/StatusPill";
import { PageToolbar, SearchField, FilterSelect } from "@/ui/PageToolbar";
import { DataGrid } from "@/ui/DataGrid";
import { FormField, FormSection } from "@/ui/FormGrid";
import type { ColumnDef } from "@tanstack/react-table";
import styles from "./ComplianceBoard.module.css";
import {
  type BoardRow,
  filterLeavers,
  formatNotice,
  pillFor,
  statusLabel,
  toggleClearanceStatus,
  uniqueValues,
} from "./leavers-board";

type Queue = "all" | "devices" | "form" | "files" | "ready";

export function ClearancePage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [params, setParams] = useSearchParams();
  const employeeId = params.get("employee") || "";
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState("");
  const [team, setTeam] = useState("");
  const [queue, setQueue] = useState<Queue>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["clearance-board", companyContext],
    queryFn: () => api<{ rows: BoardRow[]; counts: Record<string, number> }>(path("/hrms/clearance-board")),
  });

  const rows = data?.rows || [];
  const counts = data?.counts || {};
  const units = useMemo(() => uniqueValues(rows, "unit"), [rows]);
  const teams = useMemo(() => uniqueValues(rows, "team"), [rows]);

  const visible = useMemo(() => {
    let list = filterLeavers(rows, { search, unit, team });
    if (queue === "devices") list = list.filter((r) => (r.unreturned || []).length > 0);
    else if (queue === "form") list = list.filter((r) => String(r.form?.status || "pending") === "pending");
    else if (queue === "files") list = list.filter((r) => String(r.files?.status || "pending") === "pending");
    else if (queue === "ready") list = list.filter((r) => r.clearanceComplete);
    list.sort((a, b) => {
      const da = (a.unreturned || []).length ? 0 : 1;
      const db = (b.unreturned || []).length ? 0 : 1;
      if (da !== db) return da - db;
      const fa = String(a.form?.status || "pending") === "pending" ? 0 : 1;
      const fb = String(b.form?.status || "pending") === "pending" ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return String(b.departDate || "").localeCompare(String(a.departDate || ""));
    });
    return list;
  }, [rows, search, unit, team, queue]);

  const selected = rows.find((r) => r.employeeId === employeeId) || null;

  const openRow = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set("employee", id);
      setParams(next, { replace: true });
    },
    [params, setParams]
  );
  const closeSidecar = () => {
    const next = new URLSearchParams(params);
    next.delete("employee");
    setParams(next, { replace: true });
  };

  const saveItem = useMutation({
    mutationFn: ({ id, itemKey, status, notes }: { id: string; itemKey: string; status: string; notes?: string }) =>
      api(path(`/hrms/clearance/${encodeURIComponent(id)}/${encodeURIComponent(itemKey)}`), {
        method: "PUT",
        body: JSON.stringify({ status, notes: notes ?? "" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clearance-board"] });
      qc.invalidateQueries({ queryKey: ["hrms-offboarding"] });
    },
  });

  const setQueueTile = (next: Queue) => setQueue((cur) => (cur === next ? "all" : next));

  const columns = useMemo<ColumnDef<BoardRow>[]>(
    () => [
      {
        id: "name",
        header: "Employee",
        accessorFn: (r) => r.name || r.arabicName || r.employeeId,
        cell: ({ getValue }) => (
          <div className={styles.nameCell}>
            <strong>{String(getValue() || "—")}</strong>
          </div>
        ),
      },
      {
        accessorKey: "employeeId",
        header: "ID",
        cell: (c) => <code>{String(c.getValue())}</code>,
      },
      { accessorKey: "unit", header: "Unit", cell: (c) => String(c.getValue() ?? "—") },
      { accessorKey: "team", header: "Team", cell: (c) => String(c.getValue() ?? "—") },
      {
        id: "left",
        header: "Left",
        cell: ({ row }) => row.original.departDate ? String(row.original.departDate).slice(0, 10) : "—",
      },
      {
        id: "form",
        header: "Form",
        cell: ({ row }) => {
          const status = row.original.form?.status || "pending";
          return (
            <button
              type="button"
              className={styles.pillBtn}
              title={status === "pending" ? "Click to mark done" : "Click to reopen"}
              disabled={saveItem.isPending}
              onClick={(e) => {
                e.stopPropagation();
                saveItem.mutate({
                  id: row.original.employeeId,
                  itemKey: "clearance_form",
                  status: toggleClearanceStatus(status),
                  notes: row.original.form?.notes,
                });
              }}
            >
              <StatusPill variant={pillFor(status)}>{statusLabel(status)}</StatusPill>
            </button>
          );
        },
      },
      {
        id: "devices",
        header: "Devices",
        cell: ({ row }) => {
          const n = (row.original.unreturned || []).length;
          const pill = (
            <StatusPill variant={pillFor(row.original.equipmentHandover, n > 0)}>
              {n ? `${n} out` : statusLabel(row.original.equipmentHandover)}
            </StatusPill>
          );
          if (!n) return pill;
          return (
            <Link
              to={`/equipment?employee=${encodeURIComponent(row.original.employeeId)}`}
              onClick={(e) => e.stopPropagation()}
            >
              {pill}
            </Link>
          );
        },
      },
      {
        id: "files",
        header: "Files",
        cell: ({ row }) => {
          const status = row.original.files?.status || "pending";
          return (
            <button
              type="button"
              className={styles.pillBtn}
              title={status === "pending" ? "Click to mark done" : "Click to reopen"}
              disabled={saveItem.isPending}
              onClick={(e) => {
                e.stopPropagation();
                saveItem.mutate({
                  id: row.original.employeeId,
                  itemKey: "files_handover",
                  status: toggleClearanceStatus(status),
                  notes: row.original.files?.notes,
                });
              }}
            >
              <StatusPill variant={pillFor(status)}>{statusLabel(status)}</StatusPill>
            </button>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusPill variant={row.original.clearanceComplete ? "ok" : (row.original.unreturned || []).length ? "err" : "warn"}>
            {row.original.clearanceComplete ? "Complete" : (row.original.unreturned || []).length ? "Devices out" : "In progress"}
          </StatusPill>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="secondary" onClick={() => openRow(row.original.employeeId)}>
              Open
            </Button>
          </div>
        ),
      },
    ],
    [openRow, saveItem]
  );

  return (
    <div>
      <SectionHeader
        title="Clearance"
        subtitle={`${visible.length} shown · ${counts.leavers || 0} leavers · click Form or Files in the table`}
      />

      <div className="stat-grid">
        <StatTile
          value={String(counts.devices || 0)}
          label="Devices outstanding"
          accent={(counts.devices || 0) > 0}
          active={queue === "devices"}
          onClick={() => setQueueTile("devices")}
        />
        <StatTile
          value={String(counts.formPending || 0)}
          label="Form pending"
          active={queue === "form"}
          onClick={() => setQueueTile("form")}
        />
        <StatTile
          value={String(counts.filesPending || 0)}
          label="Files pending"
          active={queue === "files"}
          onClick={() => setQueueTile("files")}
        />
        <StatTile
          value={String(counts.clearanceComplete || 0)}
          label="Clearance complete"
          active={queue === "ready"}
          onClick={() => setQueueTile("ready")}
        />
      </div>

      <PageToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search name, Arabic name, or ID…" />
        <FilterSelect label="Unit" value={unit} onChange={setUnit} options={units} allLabel="All units" />
        <FilterSelect label="Team" value={team} onChange={setTeam} options={teams} allLabel="All teams" />
        <FilterSelect
          label="Queue"
          value={queue === "all" ? "" : queue}
          onChange={(v) => setQueue((v || "all") as Queue)}
          options={[
            { value: "devices", label: "Devices outstanding" },
            { value: "form", label: "Form pending" },
            { value: "files", label: "Files pending" },
            { value: "ready", label: "Clearance complete" },
          ]}
          allLabel="All leavers"
        />
      </PageToolbar>

      <Card className={styles.tableCard}>
        {isLoading && <p className="muted" style={{ padding: "1rem" }}>Loading…</p>}
        {error && <p style={{ color: "var(--err)", padding: "1rem" }}>{(error as Error).message}</p>}
        {saveItem.isError && (
          <p style={{ color: "var(--err)", padding: "1rem" }}>{(saveItem.error as Error).message || "Could not update clearance"}</p>
        )}
        {!isLoading && !error && (
          <DataGrid
            className={styles.gridFlush}
            data={visible}
            columns={columns}
            onRowClick={(row) => openRow(row.employeeId)}
            emptyMessage={rows.length ? "No leavers match filters" : "No leavers in this company"}
          />
        )}
      </Card>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(o) => !o && closeSidecar()}
        title={selected ? String(selected.name || selected.employeeId) : "Clearance"}
        size="wide"
        scrollBody
        footer={
          selected ? (
            <p className="muted" style={{ margin: 0 }}>
              {selected.clearanceComplete
                ? "Clearance complete."
                : (selected.payslipNotes || []).join(" ") || "Clearance still in progress."}
            </p>
          ) : null
        }
      >
        {selected && (
          <Sidecar
            key={selected.employeeId}
            row={selected}
            saving={saveItem.isPending}
            error={saveItem.isError ? (saveItem.error as Error).message : ""}
            onSave={(itemKey, status, notes) =>
              saveItem.mutate({ id: selected.employeeId, itemKey, status, notes })
            }
          />
        )}
      </Dialog>
    </div>
  );
}

function Sidecar({
  row,
  saving,
  error,
  onSave,
}: {
  row: BoardRow;
  saving: boolean;
  error: string;
  onSave: (itemKey: string, status: string, notes?: string) => void;
}) {
  const [formNotes, setFormNotes] = useState(row.form?.notes || "");
  const [fileNotes, setFileNotes] = useState(row.files?.notes || "");
  const devicesOut = (row.unreturned || []).length > 0;
  const neverIssued = row.equipmentHandover === "not_needed";

  return (
    <div>
      <p className="muted">
        {[row.unit, row.team, row.status || "Out", row.departDate ? `left ${String(row.departDate).slice(0, 10)}` : "", formatNotice(row.noticeType)]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className={styles.links}>
        <Link to={`/employees?highlight=${encodeURIComponent(row.employeeId)}`}>Employees</Link>
        <Link to={`/offboarding?employee=${encodeURIComponent(row.employeeId)}`}>Offboarding</Link>
        <Link to={`/equipment?employee=${encodeURIComponent(row.employeeId)}`}>Equipment</Link>
      </p>

      <FormSection title="Clearance form">
        <div className={styles.sectionHead}>
          <StatusPill variant={pillFor(row.form?.status)}>{statusLabel(row.form?.status)}</StatusPill>
        </div>
        <div className={styles.actions} style={{ justifyContent: "flex-start", marginBottom: "0.65rem" }}>
          <Button size="sm" disabled={saving} onClick={() => onSave("clearance_form", "done", formNotes)}>
            Mark done
          </Button>
          <Button size="sm" variant="secondary" disabled={saving} onClick={() => onSave("clearance_form", "not_needed", formNotes)}>
            Not needed
          </Button>
        </div>
        <FormField label="Notes" span="full">
          <textarea
            value={formNotes}
            onChange={(e) => setFormNotes(e.target.value)}
            rows={2}
            placeholder="Optional notes on the physical form"
          />
        </FormField>
      </FormSection>

      <FormSection title="Devices">
        <div className={styles.sectionHead}>
          <StatusPill variant={pillFor(row.equipmentHandover, devicesOut)}>
            {devicesOut ? `${row.unreturned!.length} outstanding` : statusLabel(row.equipmentHandover)}
          </StatusPill>
        </div>
        {devicesOut ? (
          <>
            <p className="muted">Return these on Equipment before handover can be done.</p>
            <ul className={styles.deviceList}>
              {(row.unreturned || []).map((a) => (
                <li key={String(a.id)}>
                  <span>{a.itemType || "Device"}</span>
                  <code>{a.assetTag || a.description || "—"}</code>
                </li>
              ))}
            </ul>
            <p>
              <Link to={`/equipment?employee=${encodeURIComponent(row.employeeId)}`}>Open Equipment</Link>
            </p>
          </>
        ) : neverIssued ? (
          <p className="muted">No devices were issued — not needed.</p>
        ) : (
          <p className="muted">All issued devices have been returned.</p>
        )}
      </FormSection>

      <FormSection title="Files">
        <div className={styles.sectionHead}>
          <StatusPill variant={pillFor(row.files?.status)}>{statusLabel(row.files?.status)}</StatusPill>
        </div>
        {Object.keys(row.docCounts || {}).length ? (
          <p className="muted">
            {Object.entries(row.docCounts || {})
              .map(([type, n]) => `${type || "file"} × ${n}`)
              .join(" · ")}
          </p>
        ) : (
          <p className="muted">No documents on file yet.</p>
        )}
        <div className={styles.actions} style={{ justifyContent: "flex-start", marginBottom: "0.65rem" }}>
          <Button size="sm" disabled={saving} onClick={() => onSave("files_handover", "done", fileNotes)}>
            Mark done
          </Button>
          <Button size="sm" variant="secondary" disabled={saving} onClick={() => onSave("files_handover", "not_needed", fileNotes)}>
            Not needed
          </Button>
        </div>
        <FormField label="Notes" span="full">
          <textarea
            value={fileNotes}
            onChange={(e) => setFileNotes(e.target.value)}
            rows={2}
            placeholder="Optional notes on file handover"
          />
        </FormField>
      </FormSection>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
