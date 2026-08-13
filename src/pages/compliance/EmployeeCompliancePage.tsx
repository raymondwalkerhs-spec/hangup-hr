import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { EmployeeHrmsLifecycle } from "@/features/employees/EmployeeHrmsLifecycle";

function isDeparting(emp: Record<string, unknown>) {
  const status = String(emp.status || "").toLowerCase();
  return status === "out" || Boolean(emp.depart_date);
}

export function EmployeeCompliancePage({ mode }: { mode: "offboarding" | "clearance" }) {
  const [params, setParams] = useSearchParams();
  const employeeId = params.get("employee") || "";
  const [search, setSearch] = useState("");

  const { path, companyContext } = useCompanyScope();
  const { data } = useQuery({
    queryKey: ["employees-compliance", companyContext],
    queryFn: () => api<{ employees: Record<string, unknown>[] }>(path("/employees")),
  });

  const employees = useMemo(() => {
    const list = data?.employees || [];
    const q = search.toLowerCase();
    let filtered = list;
    if (q) {
      filtered = list.filter((e) =>
        [e.id, e.american_name, e.arabic_name].some((v) => String(v || "").toLowerCase().includes(q))
      );
    } else {
      const departing = list.filter(isDeparting);
      if (departing.length) filtered = departing;
    }
    return filtered.slice(0, 80);
  }, [data?.employees, search]);

  const selected = (data?.employees || []).find((e) => String(e.id) === employeeId);

  return (
    <div>
      <SectionHeader
        title={mode === "offboarding" ? "Offboarding" : "Clearance"}
        subtitle={
          mode === "offboarding"
            ? "Depart employees, revoke access, and mark final pay"
            : "Clearance form, equipment handover, and files"
        }
      />
      <Card style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>
          <span className="muted" style={{ display: "block", marginBottom: "0.25rem" }}>Find employee</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID or name…"
            style={{ width: "100%", maxWidth: "24rem" }}
          />
        </label>
        <select
          value={employeeId}
          onChange={(e) => setParams(e.target.value ? { employee: e.target.value } : {})}
          style={{ width: "100%", maxWidth: "24rem" }}
        >
          <option value="">— Select employee —</option>
          {employees.map((e) => (
            <option key={String(e.id)} value={String(e.id)}>
              {String(e.id)} — {String(e.american_name || e.arabic_name || "")}
              {isDeparting(e) ? " (OUT)" : ""}
            </option>
          ))}
        </select>
        {!search && (
          <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
            Showing departing / OUT employees by default. Search to find anyone.
          </p>
        )}
      </Card>
      {selected ? (
        <Card>
          <h3 style={{ marginTop: 0 }}>{String(selected.american_name || selected.id)}</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            {String(selected.id)}
            {selected.depart_date ? ` · Depart ${String(selected.depart_date).slice(0, 10)}` : ""}
            {selected.status ? ` · ${String(selected.status)}` : ""}
          </p>
          <EmployeeHrmsLifecycle employee={selected} canEdit focus={mode} />
        </Card>
      ) : (
        <p className="muted">Select an employee to manage {mode}.</p>
      )}
    </div>
  );
}
