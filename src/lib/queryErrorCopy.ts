export type QueryErrorKind = "offline" | "timeout" | "unauthorized" | "forbidden" | "validation" | "unknown";

export function classifyQueryError(error: unknown): QueryErrorKind {
  const msg = String((error as Error)?.message || error || "").toLowerCase();
  const status = Number((error as { status?: number })?.status || 0);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  if (status === 401 || msg.includes("unauthorized")) return "unauthorized";
  if (status === 403 || msg.includes("forbidden") || msg.includes("no permission") || msg.includes("no access")) {
    return "forbidden";
  }
  if (msg.includes("timed out") || msg.includes("timeout") || (error as Error)?.name === "AbortError") return "timeout";
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed")) return "offline";
  if (status >= 400 && status < 500) return "validation";
  return "unknown";
}

export function queryErrorCopy(error: unknown, pageName = "this page"): { title: string; reason: string } {
  const kind = classifyQueryError(error);
  const raw = String((error as Error)?.message || "").trim();
  if (kind === "offline") {
    return {
      title: `Couldn't load ${pageName}`,
      reason: "You're offline. Showing last saved data if we have it. Check the connection and try again.",
    };
  }
  if (kind === "timeout") {
    return {
      title: `Couldn't load ${pageName}`,
      reason: "Request timed out. Check the connection and try again.",
    };
  }
  if (kind === "unauthorized") {
    return { title: "Session ended", reason: "Sign in again to continue." };
  }
  if (kind === "forbidden") {
    return {
      title: "You don't have access to this page",
      reason: "Ask HR or an admin if you need this section.",
    };
  }
  if (kind === "validation" && raw && !/sql|syntaxerror|stack/i.test(raw)) {
    return { title: `Couldn't load ${pageName}`, reason: raw };
  }
  return {
    title: `Couldn't load ${pageName}`,
    reason: "Something went wrong. Try again, or go back to a page you can open.",
  };
}
