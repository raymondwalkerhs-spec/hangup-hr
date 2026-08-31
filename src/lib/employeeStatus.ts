/** Local calendar YYYY-MM-DD (not UTC). */
export function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isOutEmployeeStatus(status: string | undefined | null | unknown): boolean {
  const s = String(status || "").trim().toLowerCase();
  return s === "out" || s === "out_still_paid" || s.includes("out but still") || s.includes("out still");
}

export function statusToDepartApiKey(status: string): "out" | "out_still_paid" {
  return String(status || "").toLowerCase().includes("still") ? "out_still_paid" : "out";
}

export type NoticeType = "with_notice" | "without_notice" | "company_decision";

export const NOTICE_TYPE_OPTIONS: { value: NoticeType; label: string }[] = [
  { value: "with_notice", label: "Leaving with two weeks notice" },
  { value: "without_notice", label: "Leaving without two weeks notice" },
  { value: "company_decision", label: "Leaving — company decision" },
];

export function noticeTypeLabel(value: string | undefined | null): string {
  const hit = NOTICE_TYPE_OPTIONS.find((o) => o.value === value);
  return hit?.label || String(value || "").replace(/_/g, " ");
}

export type DepartFormState = {
  departDate: string;
  /** @deprecated always true — date is always visible; kept for call-site compat */
  useCustomDate: boolean;
  status: "out" | "out_still_paid";
  notice_type: NoticeType;
};

export function defaultDepartForm(statusLabel = "out"): DepartFormState {
  return {
    departDate: localTodayIso(),
    useCustomDate: true,
    status: statusLabel === "out_still_paid" ? "out_still_paid" : "out",
    notice_type: "with_notice",
  };
}

export function departRequestBody(form: DepartFormState) {
  const date = String(form.departDate || localTodayIso()).slice(0, 10);
  return {
    departDate: date,
    skipDepartDate: false,
    status: form.status,
    notice_type: form.notice_type,
  };
}
