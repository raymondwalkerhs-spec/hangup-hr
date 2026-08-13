/** Unwrap API response bodies into row arrays (mirrors legacy public/js.legacy). */
export function extractRows<T = Record<string, unknown>>(
  data: unknown,
  selectRows?: (data: unknown) => T[]
): T[] {
  if (selectRows) return selectRows(data) || [];
  if (Array.isArray(data)) return data as T[];
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const candidates = [
    d.items,
    d.employees,
    d.summaries,
    d.payroll,
    d.bonuses,
    d.deductions,
    d.loans,
    d.requests,
    d.rows,
    d.rates,
    d.users,
    d.entries,
    d.changelog,
    d.fields,
    d.columns,
    d.assignments,
    d.equipment,
    d.attendance,
    d.expenses,
    d.bills,
    d.pending,
    d.stubs,
    d.sessions,
    d.holidays,
    d.clients,
    d.breaks,
    d.agentRows,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as T[];
  }
  return [];
}

export function joinEquipmentRows(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const d = data as {
    equipment?: Record<string, unknown>[];
    assignments?: Record<string, unknown>[];
  };
  const equipById = new Map((d.equipment || []).map((e) => [String(e.id), e]));
  return (d.assignments || [])
    .filter((a) => !a.returnedAt)
    .map((a) => {
      const eq = equipById.get(String(a.equipmentId)) || {};
      return {
        id: a.id,
        employeeId: a.employeeId,
        itemType: a.itemType || eq.itemType || eq.equipmentType || "—",
        unit: a.unit || eq.unit,
        notes: a.notes || eq.notes,
        assignedAt: a.assignedAt || a.issuedAt,
        equipmentId: a.equipmentId,
      };
    });
}
