import { getCompanyContext } from "@/api/client";

export type CompanySlug = "hangup" | "hs2";

export function normalizeCompany(ctx?: string | null): CompanySlug {
  return ctx === "hs2" ? "hs2" : "hangup";
}

export function isHs2Company(ctx?: string | null): boolean {
  return normalizeCompany(ctx ?? getCompanyContext()) === "hs2";
}

export function userCompanyFromUnit(unit?: string): CompanySlug {
  const u = String(unit || "").trim();
  return /^(HS2|HS-2|PT)/i.test(u) ? "hs2" : "hangup";
}

function mergeCompanyParams(params: URLSearchParams, company?: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (isHs2Company(company)) next.set("company", "hs2");
  return next;
}

/** Legacy-compatible query builder — appends `company=hs2` when in HS-2 context. */
export function buildApiQuery(
  params: Record<string, string | number | boolean | undefined | null> = {},
  company?: string | null
): string {
  const q = mergeCompanyParams(new URLSearchParams(), company);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Append company + extra params to an API path (merges existing query string). */
export function scopedPath(
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>,
  company?: string | null
): string {
  const [base, existingQs] = path.split("?");
  const q = mergeCompanyParams(
    existingQs ? new URLSearchParams(existingQs) : new URLSearchParams(),
    company
  );
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    }
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
