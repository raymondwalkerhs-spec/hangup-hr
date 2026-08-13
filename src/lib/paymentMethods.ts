export const PAYMENT_METHOD_NONE = "__none__";

export const PAYMENT_METHOD_OPTIONS = [
  { value: "instapay", label: "Instapay / Wallet" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank Account" },
] as const;

export const PAYMENT_METHOD_FILTER_OPTIONS = [
  { value: PAYMENT_METHOD_NONE, label: "No payment method" },
  ...PAYMENT_METHOD_OPTIONS,
];

export type PaymentMethodKey = (typeof PAYMENT_METHOD_OPTIONS)[number]["value"];

export function normalizePaymentMethod(method: unknown): PaymentMethodKey | "" {
  if (method && typeof method === "object") {
    if ("value" in method) return normalizePaymentMethod((method as { value: string }).value);
    if ("label" in method) return normalizePaymentMethod((method as { label: string }).label);
  }
  const m = String(method || "").trim().toLowerCase();
  if (!m) return "";
  if (m.includes("insta") || m.includes("wallet") || m.includes("instapay")) return "instapay";
  if (m.includes("cash")) return "cash";
  if (m.includes("bank")) return "bank";
  return "";
}

export function resolvePaymentMethod(
  emp: Record<string, unknown> | null | undefined,
  profile?: Record<string, unknown> | null
): PaymentMethodKey | "" {
  return (
    normalizePaymentMethod(emp?.payment_method || emp?.paymentMethod) ||
    normalizePaymentMethod(profile?.paymentMethod || profile?.payment_method) ||
    ""
  );
}

export function matchesPaymentMethodFilter(method: unknown, filter: string | undefined): boolean {
  if (!filter) return true;
  const normalized = normalizePaymentMethod(method);
  if (filter === PAYMENT_METHOD_NONE) return !normalized;
  return normalized === filter;
}

export function paymentMethodLabel(method: unknown): string {
  if (method && typeof method === "object" && "label" in method) {
    return String((method as { label: string }).label || "—");
  }
  if (method && typeof method === "object" && "value" in method) {
    return paymentMethodLabel((method as { value: string }).value);
  }
  const key = normalizePaymentMethod(method);
  const opt = PAYMENT_METHOD_OPTIONS.find((o) => o.value === key);
  return opt?.label || String(method || "").trim() || "—";
}
