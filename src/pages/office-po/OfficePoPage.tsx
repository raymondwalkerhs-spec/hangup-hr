import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, fmt } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAuth } from "@/app/AuthProvider";
import { SectionHeader } from "@/ui/SectionHeader";
import { DataGrid } from "@/ui/DataGrid";
import { Card, StatTile } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import * as Tabs from "@radix-ui/react-tabs";
import styles from "./OfficePoPage.module.css";

type Row = Record<string, unknown>;

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function OfficePoPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const { status } = useAuth();
  const user = (status?.user || {}) as Record<string, unknown>;
  const canEdit = user.canEditOfficePoPurchases === true;
  const canManageItems = user.canManageOfficePoItems === true;

  const [ym, setYm] = useState(currentYm);
  const [tab, setTab] = useState("month");
  const [buyLine, setBuyLine] = useState<Row | null>(null);
  const [buyQty, setBuyQty] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [buyRef, setBuyRef] = useState("");
  const [itemForm, setItemForm] = useState<Row | null>(null);
  const [metaAvg, setMetaAvg] = useState("");
  const [metaDays, setMetaDays] = useState("");
  const [metaDaysNote, setMetaDaysNote] = useState("");

  const monthQ = useQuery({
    queryKey: ["office-po-month", companyContext, ym],
    queryFn: () => api<Row>(path(`/office-po/months/${ym}`)),
  });

  const itemsQ = useQuery({
    queryKey: ["office-po-items", companyContext],
    queryFn: () => api<{ items: Row[] }>(path("/office-po/items?all=1")),
    enabled: tab === "catalog",
  });

  const generate = useMutation({
    mutationFn: () => api(path(`/office-po/months/${ym}/generate`), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["office-po-month"] }),
  });

  const saveMeta = useMutation({
    mutationFn: () =>
      api(path(`/office-po/months/${ym}/meta`), {
        method: "PUT",
        body: JSON.stringify({
          avgEmployeesOverride: metaAvg === "" ? null : Number(metaAvg),
          daysInScopeOverride: metaDays === "" ? null : Number(metaDays),
          daysInScopeNote: metaDaysNote,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["office-po-month"] }),
  });

  const patchLine = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(path(`/office-po/lines/${id}`), {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["office-po-month"] }),
  });

  const addPurchase = useMutation({
    mutationFn: () =>
      api(path(`/office-po/lines/${buyLine?.id}/purchases`), {
        method: "POST",
        body: JSON.stringify({
          qty: Number(buyQty),
          unitPrice: buyPrice === "" ? undefined : Number(buyPrice),
          orderRef: buyRef,
        }),
      }),
    onSuccess: () => {
      setBuyLine(null);
      setBuyQty("");
      setBuyPrice("");
      setBuyRef("");
      qc.invalidateQueries({ queryKey: ["office-po-month"] });
    },
  });

  const saveItem = useMutation({
    mutationFn: () => {
      const body = {
        name: itemForm?.name,
        category: itemForm?.category || null,
        unit: itemForm?.unit || null,
        scaleMode: itemForm?.scaleMode || "employee",
        perEmployees: itemForm?.perEmployees != null ? Number(itemForm.perEmployees) : null,
        packQty: itemForm?.packQty != null ? Number(itemForm.packQty) : null,
        officeQty: itemForm?.officeQty != null ? Number(itemForm.officeQty) : null,
        ignoreDaysScale: !!itemForm?.ignoreDaysScale,
        cadence: itemForm?.cadence || "monthly",
        everyNMonths: itemForm?.everyNMonths != null ? Number(itemForm.everyNMonths) : null,
        anchorYearMonth: itemForm?.anchorYearMonth || null,
        unitPrice: itemForm?.unitPrice != null && itemForm.unitPrice !== "" ? Number(itemForm.unitPrice) : null,
        active: itemForm?.active !== false,
      };
      if (itemForm?.id) {
        return api(path(`/office-po/items/${itemForm.id}`), {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      return api(path("/office-po/items"), { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      setItemForm(null);
      qc.invalidateQueries({ queryKey: ["office-po-items"] });
      qc.invalidateQueries({ queryKey: ["office-po-month"] });
    },
  });

  const softDeleteItem = useMutation({
    mutationFn: (id: string) => api(path(`/office-po/items/${id}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["office-po-items"] }),
  });

  const data = monthQ.data;
  const lines = (data?.lines as Row[]) || [];
  const kpis = (data?.kpis as Row) || {};

  const lineCols = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "item",
        header: "Item",
        cell: ({ row }) => String((row.original.item as Row)?.name || row.original.itemId || "—"),
      },
      {
        id: "category",
        header: "Category",
        cell: ({ row }) => String((row.original.item as Row)?.category || "—"),
      },
      { accessorKey: "status", header: "Status" },
      { accessorKey: "predictedQty", header: "Predicted qty" },
      {
        accessorKey: "predictedCost",
        header: "Predicted $",
        cell: (c) => (c.getValue() != null ? fmt(c.getValue() as number) : "—"),
      },
      { accessorKey: "actualQty", header: "Actual qty" },
      {
        accessorKey: "actualCost",
        header: "Actual $",
        cell: (c) => fmt((c.getValue() as number) || 0),
      },
      {
        id: "variance",
        header: "Variance",
        cell: ({ row }) => {
          const v = Number(row.original.varianceQty) || 0;
          const cls = v > 0 ? styles.over : v < 0 ? styles.under : "";
          return <span className={cls}>{v > 0 ? `+${v}` : v}</span>;
        },
      },
      {
        id: "nextDue",
        header: "Next due",
        cell: ({ row }) => String(row.original.nextDue || "—"),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          if (!canEdit) return null;
          const st = String(row.original.status || "");
          return (
            <span className={styles.actions}>
              {st === "predicted" || st === "postponed" ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setBuyLine(row.original);
                    setBuyQty(String(row.original.predictedQty || ""));
                    setBuyPrice(String((row.original.item as Row)?.unitPrice ?? ""));
                  }}
                >
                  Buy
                </Button>
              ) : null}
              {st === "predicted" ? (
                <Button size="sm" variant="ghost" onClick={() => patchLine.mutate({ id: String(row.original.id), status: "postponed" })}>
                  Postpone
                </Button>
              ) : null}
              {st === "predicted" || st === "postponed" ? (
                <Button size="sm" variant="ghost" onClick={() => patchLine.mutate({ id: String(row.original.id), status: "cancelled" })}>
                  Cancel
                </Button>
              ) : null}
            </span>
          );
        },
      },
    ],
    [canEdit, patchLine]
  );

  const itemCols = useMemo<ColumnDef<Row>[]>(
    () => [
      { accessorKey: "name", header: "Name" },
      { accessorKey: "category", header: "Category" },
      { accessorKey: "cadence", header: "Cadence" },
      { accessorKey: "scaleMode", header: "Scale" },
      {
        accessorKey: "unitPrice",
        header: "Unit price",
        cell: (c) => (c.getValue() != null ? fmt(c.getValue() as number) : "—"),
      },
      {
        accessorKey: "active",
        header: "Active",
        cell: (c) => (c.getValue() === false ? "No" : "Yes"),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          canManageItems ? (
            <span className={styles.actions}>
              <Button size="sm" variant="ghost" onClick={() => setItemForm({ ...row.original })}>
                Edit
              </Button>
              {row.original.active !== false ? (
                <Button size="sm" variant="ghost" onClick={() => softDeleteItem.mutate(String(row.original.id))}>
                  Deactivate
                </Button>
              ) : null}
            </span>
          ) : null,
      },
    ],
    [canManageItems, softDeleteItem]
  );

  return (
    <div className={styles.page}>
      <SectionHeader
        title="Office PO"
        subtitle="Predict and track office purchases by headcount and working days"
        actions={
          <div className={styles.toolbar}>
            <input
              type="month"
              value={ym}
              onChange={(e) => setYm(e.target.value)}
              className={styles.monthInput}
              aria-label="Salary month"
            />
            {canEdit ? (
              <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
                {generate.isPending ? "Generating…" : "Generate / refresh"}
              </Button>
            ) : null}
          </div>
        }
      />

      {data?.stalePrediction ? (
        <p className={styles.stale}>Predictions are stale vs current headcount/days — regenerate to refresh.</p>
      ) : null}

      <div className={styles.stats}>
        <StatTile label="Avg employees used" value={String(data?.avgUsed ?? "—")} />
        <StatTile label="Days in scope" value={`${data?.daysUsed ?? "—"} / ${data?.daysAuto ?? "—"}`} />
        <StatTile label="Predicted spend" value={fmt((kpis.predictedSpend as number) || 0)} />
        <StatTile label="Actual spend" value={fmt((kpis.actualSpend as number) || 0)} />
        <StatTile
          label="Cost / employee"
          value={kpis.costPerEmployee != null ? fmt(kpis.costPerEmployee as number) : "—"}
        />
      </div>

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className={styles.tabs}>
          <Tabs.Trigger value="month" className={styles.tab}>
            Month lines
          </Tabs.Trigger>
          <Tabs.Trigger value="overrides" className={styles.tab}>
            Overrides
          </Tabs.Trigger>
          <Tabs.Trigger value="catalog" className={styles.tab}>
            Catalog
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="month">
          <Card>
            <DataGrid columns={lineCols} data={lines} emptyMessage={monthQ.isLoading ? "Loading…" : "No lines — generate a prediction"} />
          </Card>
        </Tabs.Content>

        <Tabs.Content value="overrides">
          <Card>
            <div className={styles.formGrid}>
              <label>
                Avg employees override
                <input
                  value={metaAvg}
                  onChange={(e) => setMetaAvg(e.target.value)}
                  placeholder={String(data?.avgAuto ?? "")}
                  disabled={!canEdit}
                />
              </label>
              <label>
                Days in scope override
                <input
                  value={metaDays}
                  onChange={(e) => setMetaDays(e.target.value)}
                  placeholder={String(data?.daysAuto ?? "")}
                  disabled={!canEdit}
                />
              </label>
              <label className={styles.full}>
                Days override note (required when days set)
                <input value={metaDaysNote} onChange={(e) => setMetaDaysNote(e.target.value)} disabled={!canEdit} />
              </label>
              {canEdit ? (
                <Button onClick={() => saveMeta.mutate()} disabled={saveMeta.isPending}>
                  Save overrides
                </Button>
              ) : null}
            </div>
            <p className={styles.hint}>
              Auto avg: {String(data?.avgAuto ?? "—")} · Auto days (Mon–Fri): {String(data?.daysAuto ?? "—")}
            </p>
          </Card>
        </Tabs.Content>

        <Tabs.Content value="catalog">
          <Card>
            {canManageItems ? (
              <div className={styles.catalogBar}>
                <Button
                  onClick={() =>
                    setItemForm({
                      name: "",
                      scaleMode: "employee",
                      cadence: "monthly",
                      perEmployees: 1,
                      packQty: 1,
                      active: true,
                    })
                  }
                >
                  Add item
                </Button>
              </div>
            ) : null}
            <DataGrid
              columns={itemCols}
              data={itemsQ.data?.items || []}
              emptyMessage={itemsQ.isLoading ? "Loading…" : "No catalog items"}
            />
          </Card>
        </Tabs.Content>
      </Tabs.Root>

      <Dialog open={!!buyLine} onOpenChange={(o) => !o && setBuyLine(null)} title="Record purchase">
        <div className={styles.formGrid}>
          <label>
            Qty
            <input value={buyQty} onChange={(e) => setBuyQty(e.target.value)} />
          </label>
          <label>
            Unit price
            <input value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} />
          </label>
          <label className={styles.full}>
            Order ref
            <input value={buyRef} onChange={(e) => setBuyRef(e.target.value)} />
          </label>
          <Button onClick={() => addPurchase.mutate()} disabled={addPurchase.isPending || !buyQty}>
            Save purchase
          </Button>
          {addPurchase.isError ? <p className={styles.error}>{(addPurchase.error as Error).message}</p> : null}
        </div>
      </Dialog>

      <Dialog
        open={!!itemForm}
        onOpenChange={(o) => !o && setItemForm(null)}
        title={itemForm?.id ? "Edit item" : "Add item"}
      >
        {itemForm ? (
          <div className={styles.formGrid}>
            {(
              [
                ["name", "Name"],
                ["category", "Category"],
                ["unit", "Unit"],
                ["scaleMode", "Scale mode (employee|office_fixed)"],
                ["perEmployees", "Per employees"],
                ["packQty", "Pack qty"],
                ["officeQty", "Office qty"],
                ["cadence", "Cadence (monthly|every_n_months|one_time)"],
                ["everyNMonths", "Every N months"],
                ["anchorYearMonth", "Anchor YYYY-MM"],
                ["unitPrice", "Unit price"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className={key === "name" || key === "category" ? styles.full : undefined}>
                {label}
                <input
                  value={String(itemForm[key] ?? "")}
                  onChange={(e) => setItemForm({ ...itemForm, [key]: e.target.value })}
                />
              </label>
            ))}
            <label>
              <input
                type="checkbox"
                checked={!!itemForm.ignoreDaysScale}
                onChange={(e) => setItemForm({ ...itemForm, ignoreDaysScale: e.target.checked })}
              />{" "}
              Ignore days scale
            </label>
            <Button onClick={() => saveItem.mutate()} disabled={saveItem.isPending || !itemForm.name}>
              Save item
            </Button>
            {saveItem.isError ? <p className={styles.error}>{(saveItem.error as Error).message}</p> : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
