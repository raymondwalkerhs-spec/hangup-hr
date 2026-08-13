import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import * as Tabs from "@radix-ui/react-tabs";
import { Eye, ClipboardCheck } from "lucide-react";
import { api, fmt, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { monthDateRange, saleCellValue } from "@/lib/salesCells";
import { ViewSaleModal, QualityTicketModal, RpmQualityTicketModal, RpmViewSaleModal, RpmSaleFormModal, SaleFormModal } from "@/features/sales/SaleModals";
import { SaleProgramPickerDialog } from "@/features/sales/SaleProgramPickerDialog";
import { useSaleSubmitPrograms } from "@/features/sales/useSaleSubmitPrograms";
import { parseSalesProgram, type SalesProgram } from "@/features/sales/sale-program";
import { canOpenQualityTicketForSale } from "@/lib/salesEmployeeFilters";
import { useProcessNewSaleRequest } from "@/features/sales/useProcessNewSaleRequest";
import { useSalesIntentStore } from "@/stores/sales-intent-store";
import { SectionHeader } from "@/ui/SectionHeader";
import { DataGrid } from "@/ui/DataGrid";
import { Card, StatTile } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { PageToolbar, SearchField, FilterSelect } from "@/ui/PageToolbar";

type Row = Record<string, unknown>;
type ListColumn = { columnKey: string; label?: string };

const CLOSER_ROLES = new Set(["agent", "tl", "op"]);

export function SalesPage() {
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const { user } = useAppStatus();
  const userRole = String(user?.role || "").toLowerCase();
  const [searchParams, setSearchParams] = useSearchParams();
  const [program, setProgram] = useState<SalesProgram>("mla");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [retransferOnly, setRetransferOnly] = useState(false);
  const [viewSale, setViewSale] = useState<Row | null>(null);
  const [qualitySale, setQualitySale] = useState<Row | null>(null);
  const [formSale, setFormSale] = useState<Row | null | undefined>(undefined);
  const [programPickerOpen, setProgramPickerOpen] = useState(false);
  const newSaleIntentTick = useSalesIntentStore((s) => s.tick);
  const newSaleIntentProgram = useSalesIntentStore((s) => s.program);

  const {
    enabledPrograms,
    canSubmitMla,
    canSubmitRpm,
    canSubmitAny,
    needsProgramPicker,
    ready: submitScopeReady,
  } = useSaleSubmitPrograms();

  const canSeeRetransferFilter = CLOSER_ROLES.has(userRole) || ["quality", "rtm", "admin", "ceo", "hr"].includes(userRole);

  const openNewSaleForm = useCallback((nextProgram: SalesProgram) => {
    setProgram(nextProgram);
    setFormSale(null);
  }, []);

  const openProgramPicker = useCallback(() => setProgramPickerOpen(true), []);

  const processNewSaleRequest = useProcessNewSaleRequest({
    enabledPrograms,
    canSubmitMla,
    canSubmitRpm,
    needsProgramPicker,
    openNewSaleForm,
    openProgramPicker,
  });

  const beginAddSale = () => {
    processNewSaleRequest();
  };

  useEffect(() => {
    if (searchParams.get("action") !== "new") return;
    if (!submitScopeReady) return;

    processNewSaleRequest(parseSalesProgram(searchParams.get("program")) ?? newSaleIntentProgram);

    const next = new URLSearchParams(searchParams);
    next.delete("action");
    next.delete("program");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, submitScopeReady, processNewSaleRequest, newSaleIntentProgram]);

  useEffect(() => {
    if (!newSaleIntentTick) return;
    if (!submitScopeReady) return;
    processNewSaleRequest(newSaleIntentProgram);
  }, [newSaleIntentTick, newSaleIntentProgram, submitScopeReady, processNewSaleRequest]);

  useEffect(() => {
    const prog = parseSalesProgram(searchParams.get("program"));
    if (prog) setProgram(prog);
  }, [searchParams]);

  const { from, to } = monthDateRange(month);
  const salesBase = path(program === "rpm" ? "/rpm-sales" : "/sales");

  useEffect(() => {
    if (!submitScopeReady) return;
    if (program === "mla" && !canSubmitMla && canSubmitRpm) setProgram("rpm");
  }, [submitScopeReady, program, canSubmitMla, canSubmitRpm]);

  const { data: salesRes, isLoading, error, refetch } = useQuery({
    queryKey: ["sales", program, from, to, statusFilter, teamFilter, retransferOnly, companyContext],
    queryFn: () => {
      const q = new URLSearchParams({ from, to, dateBasis: "submission" });
      if (statusFilter) q.set("status", statusFilter);
      if (teamFilter) q.set("team", teamFilter);
      if (program === "rpm" && retransferOnly) q.set("retransfer", "1");
      return api<{ sales: Row[]; listColumns?: ListColumn[]; statuses?: string[] }>(`${salesBase}?${q}`);
    },
  });

  const { data: empData } = useQuery({
    queryKey: ["employees-sales", companyContext],
    queryFn: () => api<{ employees: { id: string; american_name?: string; team?: string }[] }>(path("/employees")),
  });

  const empById = useMemo(
    () => new Map((empData?.employees || []).map((e) => [e.id, e])),
    [empData?.employees]
  );

  const listColumns = salesRes?.listColumns?.length
    ? salesRes.listColumns
    : program === "rpm"
      ? [
          { columnKey: "workingDay", label: "Day" },
          { columnKey: "client", label: "Client" },
          { columnKey: "customer", label: "Customer" },
          { columnKey: "memberId", label: "Member ID" },
          { columnKey: "agent", label: "Agent" },
          { columnKey: "reviewerFeedback", label: "Reviewer feedback" },
          { columnKey: "clientFeedback", label: "Client feedback" },
          { columnKey: "status", label: "Status" },
        ]
      : [
          { columnKey: "workingDay", label: "Day" },
          { columnKey: "agentName", label: "Agent" },
          { columnKey: "client", label: "Client" },
          { columnKey: "status", label: "Status" },
          { columnKey: "price", label: "Price" },
          { columnKey: "team", label: "Team" },
        ];

  const rows = useMemo(() => {
    let list = salesRes?.sales || [];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((s) => {
        const fd = s.formData as Record<string, unknown> | undefined;
        const hay = [
          s.id, s.agentId, s.client, s.status, s.fullName, s.phoneNumber, s.memberId,
          fd?.client, fd?.memberId, fd?.clientFeedback,
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [salesRes?.sales, search]);

  const teams = useMemo(
    () => [...new Set((empData?.employees || []).map((e) => e.team).filter(Boolean))].sort() as string[],
    [empData?.employees]
  );

  const isRetransferRow = (row: Row) => {
    const fd = row.formData as Record<string, unknown> | undefined;
    return fd?.clientFeedback === "Retransfer" || fd?.retransfer === true;
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      ...listColumns.map((c) => {
        const key = c.columnKey || "id";
        return {
          id: key,
          header: c.label || key,
          accessorFn: (row: Row) => saleCellValue(key, row, empById),
          cell: (ctx) => {
            const val = String(ctx.getValue() ?? "—");
            if (key === "clientFeedback" && program === "rpm" && val === "Retransfer") {
              return <span style={{ color: "var(--warn, #c47a00)", fontWeight: 600 }}>Retransfer</span>;
            }
            return val;
          },
        };
      }),
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <span style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
            {program === "rpm" && isRetransferRow(row.original) && canSeeRetransferFilter && (
              <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.35rem", borderRadius: 4, background: "var(--warn-bg, #fff3cd)", color: "var(--warn, #856404)" }}>
                Retransfer
              </span>
            )}
            {(program === "mla" || program === "rpm") && (
              <Button size="sm" variant="secondary" title="View sale" onClick={() => setViewSale(row.original)}>
                <Eye size={14} /> View
              </Button>
            )}
            {(program === "mla" || program === "rpm") && (
              <Button size="sm" variant="secondary" title="Edit sale" onClick={() => setFormSale(row.original)}>
                Edit
              </Button>
            )}
            {canOpenQualityTicketForSale(row.original, user) && (
              <Button size="sm" title="Quality ticket" onClick={() => setQualitySale(row.original)}>
                <ClipboardCheck size={14} /> Quality
              </Button>
            )}
          </span>
        ),
      },
    ],
    [listColumns, empById, program, canSeeRetransferFilter, user]
  );

  const passed = rows.filter((r) => {
    const fd = r.formData as Record<string, unknown> | undefined;
    if (program === "rpm") return fd?.clientFeedback === "Approved" || r.status === "passed";
    return fd?.clientFeedback === "Passed" || r.status === "passed";
  }).length;
  const pending = rows.filter((r) => String(r.status || "").toLowerCase() === "pending").length;
  const denied = rows.filter((r) => {
    const s = String(r.status || "").toLowerCase();
    return s === "denied" || s === "dropped";
  }).length;
  const retransferCount = program === "rpm" ? rows.filter(isRetransferRow).length : 0;

  return (
    <div>
      <SectionHeader
        title="Sales log"
        subtitle={`${monthLabel(month)} · ${rows.length} ${program.toUpperCase()} sales`}
        actions={
          canSubmitAny ? (
            <Button onClick={beginAddSale}>+ Add sale</Button>
          ) : undefined
        }
      />

      <Tabs.Root value={program} onValueChange={(v) => { setProgram(v as SalesProgram); setRetransferOnly(false); }}>
        <Tabs.List style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: "0.85rem", marginRight: "0.25rem" }}>Program:</span>
          <Tabs.Trigger
            value="mla"
            title={!canSubmitMla ? "View existing MLA sales (new MLA submit disabled)" : undefined}
            style={{
              padding: "0.35rem 0.75rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: program === "mla" ? "var(--accent, #2563eb)" : "transparent",
              color: program === "mla" ? "#fff" : "inherit",
              fontWeight: program === "mla" ? 600 : 400,
            }}
          >
            MLA
          </Tabs.Trigger>
          <Tabs.Trigger
            value="rpm"
            style={{
              padding: "0.35rem 0.75rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: program === "rpm" ? "var(--accent, #2563eb)" : "transparent",
              color: program === "rpm" ? "#fff" : "inherit",
              fontWeight: program === "rpm" ? 600 : 400,
            }}
          >
            RPM
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>

      <PageToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search client, agent, phone…" />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={salesRes?.statuses || []} />
        <FilterSelect label="Team" value={teamFilter} onChange={setTeamFilter} options={teams} />
        {program === "rpm" && canSeeRetransferFilter && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
            <input type="checkbox" checked={retransferOnly} onChange={(e) => setRetransferOnly(e.target.checked)} />
            Retransfer only
          </label>
        )}
      </PageToolbar>

      <div className="stat-grid">
        <StatTile value={rows.length} label="Total sales" />
        <StatTile value={passed} label="Passed" accent />
        <StatTile value={pending} label="Pending" />
        <StatTile value={denied} label="Dropped" />
        {program === "rpm" && canSeeRetransferFilter && (
          <StatTile value={retransferCount} label="Retransfer" />
        )}
      </div>

      <Card>
        {isLoading && <p className="muted">Loading sales…</p>}
        {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
        {!isLoading && !error && (
          <DataGrid
            data={rows}
            columns={columns}
            virtualize={false}
            emptyMessage={`No ${program.toUpperCase()} sales for this period`}
          />
        )}
      </Card>

      <SaleProgramPickerDialog
        open={programPickerOpen}
        onOpenChange={setProgramPickerOpen}
        onSelect={openNewSaleForm}
      />

      {program === "mla" && (
        <>
          <ViewSaleModal sale={viewSale} open={!!viewSale} onOpenChange={(o) => !o && setViewSale(null)} />
          <QualityTicketModal
            sale={qualitySale}
            open={!!qualitySale}
            onOpenChange={(o) => !o && setQualitySale(null)}
            onSaved={() => refetch()}
          />
          <SaleFormModal
            sale={formSale === undefined ? null : formSale}
            open={formSale !== undefined}
            onOpenChange={(o) => !o && setFormSale(undefined)}
            onSaved={() => refetch()}
          />
        </>
      )}
      {program === "rpm" && (
        <>
          <RpmViewSaleModal sale={viewSale} open={!!viewSale} onOpenChange={(o) => !o && setViewSale(null)} />
          <RpmQualityTicketModal
            sale={qualitySale}
            open={!!qualitySale}
            onOpenChange={(o) => !o && setQualitySale(null)}
            onSaved={() => refetch()}
          />
          <RpmSaleFormModal
            sale={formSale === undefined ? null : formSale}
            open={formSale !== undefined}
            onOpenChange={(o) => !o && setFormSale(undefined)}
            onSaved={() => refetch()}
          />
        </>
      )}
    </div>
  );
}
