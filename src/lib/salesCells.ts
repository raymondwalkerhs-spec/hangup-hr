import { fmt } from "@/api/client";

type Sale = Record<string, unknown>;
type Emp = { id: string; american_name?: string };

function deviceLabel(device: unknown) {
  const key = String(device || "").toLowerCase();
  const map: Record<string, string> = { smartwatch: "Smartwatch", bracelet: "Bracelet", necklace: "Necklace" };
  return map[key] || (device ? String(device) : "—");
}

export function saleCellValue(
  colKey: string,
  sale: Sale,
  empById: Map<string, Emp>
): string {
  const fd = (sale.formData as Record<string, unknown>) || {};
  const agent = empById.get(String(sale.agentId || ""));
  const agentName = agent?.american_name || sale.agentDisplayName || fd.agentName || "";
  const closerName =
    empById.get(String(sale.closerId || ""))?.american_name || sale.closerDisplayName || fd.closerName || "";

  const employeeCell = (idRaw: unknown, displayFallback?: unknown) => {
    const id = String(idRaw || "").trim();
    if (!id) return "—";
    const name =
      empById.get(id)?.american_name ||
      String(displayFallback || "").trim() ||
      "";
    return name ? `${id} · ${name}` : id;
  };

  switch (colKey) {
    case "workingDay":
      return String(sale.workingDay || String(sale.submissionDate || "").slice(0, 10) || sale.effectiveDate || "—");
    case "submissionTime": {
      const raw = String(sale.submissionTime || "");
      const m = raw.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return raw || "—";
      let h = parseInt(m[1], 10);
      const mi = m[2];
      const ampm = h >= 12 ? "PM" : "AM";
      h = h % 12;
      if (h === 0) h = 12;
      return `${h}:${mi} ${ampm}`;
    }
    case "client":
      return String(sale.client || fd.client || "—");
    case "customer":
      return String(sale.fullName || "—");
    case "device":
    case "deviceType":
      return deviceLabel(sale.device || fd.deviceType);
    case "agent":
    case "agentName": {
      if (String(sale.agentId || "").toUpperCase() === "OTHER") return "Unassigned";
      return `${sale.agentId || "—"} · ${agentName || ""}`.trim();
    }
    case "closer":
    case "closerName":
      return `${sale.closerId || "—"} · ${closerName || ""}`.trim();
    case "reviewer":
      return employeeCell(fd.reviewer ?? sale.reviewer, sale.reviewerDisplayName || fd.reviewerName);
    case "assignVerifier":
      return employeeCell(
        fd.assignVerifier ?? sale.assignVerifier,
        sale.verifierDisplayName || fd.verifierName || fd.assignVerifierName
      );
    case "team":
      return String(sale.team || fd.team || "—");
    case "unit":
      return String(sale.unit || fd.unit || "—");
    case "status":
      return String(sale.status || "—");
    case "verifierFeedback":
      return String(fd.verifierFeedback || "—");
    case "reviewerFeedback":
      return String(fd.reviewerFeedback || "—");
    case "clientFeedback":
      return String(fd.clientFeedback || "—");
    case "memberId":
      return String(sale.memberId || fd.memberId || "—");
    case "price": {
      const p = sale.price ?? fd.price;
      return p != null ? fmt(p as number) : "—";
    }
    case "phoneNumber":
      return String(sale.phoneNumber || fd.phoneNumber || "—");
    default:
      return String(fd[colKey] ?? sale[colKey] ?? "—");
  }
}

export function monthDateRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    const d = new Date();
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function cairoNowParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  ) as Record<string, string>;
}

function addUtcDays(isoDate: string, delta: number) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Current Cairo working day. 00:00–02:59 → previous calendar day. */
export function cairoWorkingDayToday(date = new Date()) {
  const p = cairoNowParts(date);
  let hour = parseInt(p.hour || "12", 10);
  if (hour === 24) hour = 0;
  const cal = `${p.year}-${p.month}-${p.day}`;
  if (hour < 3) return addUtcDays(cal, -1);
  return cal;
}
