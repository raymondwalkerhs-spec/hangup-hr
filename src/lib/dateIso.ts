export function parseIsoDate(value: unknown): string {
  if (!value) return "";
  const s = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function isAfterIsoDate(date: string, pivot: string): boolean {
  const d = parseIsoDate(date);
  const p = parseIsoDate(pivot);
  if (!d || !p) return false;
  return d > p;
}

export function isDepartDay(date: string, departDate: string): boolean {
  const d = parseIsoDate(date);
  const depart = parseIsoDate(departDate);
  return Boolean(depart && d === depart);
}
