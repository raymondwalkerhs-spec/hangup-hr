/** Monday–Friday ISO dates for the work week containing `date`. */
export function workWeekBounds(date: string): { monday: string; friday: string } {
  const d = new Date(`${date}T12:00:00`);
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { monday: fmt(mon), friday: fmt(fri) };
}

export function workWeekDates(monday: string, friday: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${monday}T12:00:00`);
  const end = new Date(`${friday}T12:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}
