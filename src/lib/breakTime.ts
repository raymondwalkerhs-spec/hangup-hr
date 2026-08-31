/** Break schedule times — stored as 24h HH:MM, shown as AM/PM (Egypt). */

export function calcEndTime24(startTime: string, durationMinutes: number) {
  const m = String(startTime || "10:00").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "10:15";
  let mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (Number(durationMinutes) || 15);
  mins = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(mins / 60);
  const mi = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

export function formatTimeAmPm(t?: string) {
  if (!t) return "—";
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${String(mi).padStart(2, "0")} ${ampm}`;
}

export function time24ToParts(time24: string): { hour12: number; minute: number; ampm: "AM" | "PM" } {
  const m = String(time24 || "12:00").match(/^(\d{1,2}):(\d{2})/);
  const h24 = m ? parseInt(m[1], 10) : 12;
  const minute = m ? parseInt(m[2], 10) : 0;
  const ampm: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const hour12 = h24 % 12 || 12;
  return { hour12, minute, ampm };
}

export function partsToTime24(hour12: number, minute: number, ampm: "AM" | "PM") {
  let h = hour12 % 12;
  if (ampm === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Accepts HH:MM or h:mm AM/PM → normalized 24h HH:MM. */
export function parseTimeTo24(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const mi = parseInt(ampm[2], 10);
    const isPm = ampm[3].toUpperCase() === "PM";
    if (h < 1 || h > 12 || mi < 0 || mi > 59) return null;
    if (h === 12) h = isPm ? 12 : 0;
    else if (isPm) h += 12;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  const h24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = parseInt(h24[1], 10);
    const mi = parseInt(h24[2], 10);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  return null;
}
