import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { cairoWorkingDayToday } from "@/lib/salesCells";
import { formatMemberId, stripMemberId } from "@/lib/rpmMemberId";
import { Button } from "@/ui/Button";
import { Select } from "@/ui/Select";
import styles from "./ImportFromOpenQ.module.css";

export type OpenQCheck = {
  id: string;
  memberId?: string;
  fullName?: string;
  phone?: string;
  dateOfBirth?: string;
  dob?: string;
  info?: string;
  createdAt?: string;
};

function dobIso(raw?: string | null) {
  if (!raw) return "";
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function optionLabel(row: OpenQCheck) {
  const name = row.fullName || "Open Q";
  const mid = row.memberId ? formatMemberId(row.memberId) : "";
  const phone = row.phone || "";
  return [name, mid, phone].filter(Boolean).join(" · ");
}

export function ImportFromOpenQ({
  agentId,
  enabled,
  onImport,
}: {
  agentId: string;
  enabled: boolean;
  onImport: (fields: Record<string, string>) => void;
}) {
  const { path, companyContext } = useCompanyScope();
  const [selectedId, setSelectedId] = useState("");
  const [importedId, setImportedId] = useState<string | null>(null);
  const workingDay = cairoWorkingDayToday();

  useEffect(() => {
    setSelectedId("");
    setImportedId(null);
  }, [agentId]);

  const query = useQuery({
    queryKey: ["rpm-open-q-for-sale", companyContext, agentId, workingDay],
    queryFn: () =>
      api<{ checks?: OpenQCheck[]; workingDay?: string }>(
        path("/rpm-checks/open-for-sale", { agentId, workingDay })
      ),
    enabled: enabled && Boolean(agentId),
    staleTime: 15_000,
  });

  const checks = useMemo(() => query.data?.checks || [], [query.data?.checks]);

  if (!enabled || !agentId) return null;

  function applySelected() {
    const row = checks.find((c) => c.id === selectedId);
    if (!row) return;
    const fields: Record<string, string> = {};
    const mid = stripMemberId(row.memberId || "");
    if (mid) fields.memberId = mid;
    if (row.fullName) fields.fullName = String(row.fullName);
    if (row.phone) fields.phoneNumber = String(row.phone).replace(/\D/g, "");
    const dob = dobIso(row.dateOfBirth || row.dob);
    if (dob) fields.dateOfBirth = dob;
    if (row.info) fields.notes = String(row.info);
    onImport(fields);
    setImportedId(row.id);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <strong>Import from open Q</strong>
        <span className={styles.meta}>Same day · no feedback yet</span>
      </div>
      {query.isLoading ? (
        <p className={styles.hint}>Loading open Qs…</p>
      ) : query.error ? (
        <p className={styles.error}>{(query.error as Error).message}</p>
      ) : checks.length === 0 ? (
        <p className={styles.hint}>No open Q checks for this agent today.</p>
      ) : (
        <>
          <div className={styles.row}>
            <Select
              value={selectedId}
              placeholder={`Select open Q (${checks.length})`}
              searchable
              aria-label="Open Q check to import"
              options={[
                { value: "", label: `Select open Q (${checks.length})` },
                ...checks.map((c) => ({ value: c.id, label: optionLabel(c) })),
              ]}
              onChange={setSelectedId}
            />
            <Button type="button" size="sm" disabled={!selectedId} onClick={applySelected}>
              Fill form
            </Button>
          </div>
          {importedId && (
            <p className={styles.hint}>Filled from open Q — review fields before submit.</p>
          )}
        </>
      )}
    </div>
  );
}
