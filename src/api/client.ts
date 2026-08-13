export const SESSION_KEY = "hr_session_id";
export const COMPANY_KEY = "companyContext";

export function getSessionId(): string {
  try {
    return sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

export function setSessionId(id: string) {
  sessionStorage.setItem(SESSION_KEY, id);
}

export function clearSessionId() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function getCompanyContext(): string {
  try {
    return sessionStorage.getItem(COMPANY_KEY) || "hangup";
  } catch {
    return "hangup";
  }
}

export function setCompanyContext(ctx: string) {
  try {
    sessionStorage.setItem(COMPANY_KEY, ctx);
  } catch {
    /* ignore */
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { skipSilentRefresh?: boolean } = {},
  timeoutMs = 120000
): Promise<T> {
  const sessionId = getSessionId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(sessionId ? { "x-session-id": sessionId } : {}),
        ...(options.headers as Record<string, string>),
      },
      ...options,
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    clearSessionId();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error || res.statusText;
    throw new Error(msg);
  }
  return data as T;
}

export function fmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-EG");
}

export function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function monthLabel(ym: string): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || "";
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
