export type SalesProgram = "mla" | "rpm";

export function parseSalesProgram(value: unknown): SalesProgram | null {
  const p = String(value || "").toLowerCase();
  if (p === "mla" || p === "rpm") return p;
  return null;
}

/** When only one program can be submitted, return it; otherwise null (show picker). */
export function resolveSingleSubmitProgram(enabledPrograms: string[]): SalesProgram | null {
  const mla = enabledPrograms.includes("mla");
  const rpm = enabledPrograms.includes("rpm");
  if (mla && rpm) return null;
  if (rpm) return "rpm";
  if (mla) return "mla";
  return null;
}

export function newSaleUrl(program?: SalesProgram | null) {
  const q = new URLSearchParams({ action: "new" });
  if (program) q.set("program", program);
  return `/sales?${q}`;
}
