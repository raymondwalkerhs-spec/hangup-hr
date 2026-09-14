/** YYYY-MM-DD in Africa/Cairo for client-side day pickers. */
export function egyptTodayDateClient(date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA yields YYYY-MM-DD
  return fmt.format(date);
}
