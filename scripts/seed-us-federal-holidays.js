/**
 * US federal holidays 2024–2028 with weekend observed dates.
 * Used by Settings → Import federal holidays and `node scripts/seed-us-federal-holidays.js`.
 */

function nthWeekdayOfMonth(year, month, weekday, n) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month - 1, d);
    if (dt.getMonth() !== month - 1) break;
    if (dt.getDay() === weekday) {
      count += 1;
      if (count === n) return formatDate(dt);
    }
  }
  return null;
}

function lastWeekdayOfMonth(year, month, weekday) {
  let last = null;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month - 1, d);
    if (dt.getMonth() !== month - 1) break;
    if (dt.getDay() === weekday) last = formatDate(dt);
  }
  return last;
}

function formatDate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function observedDate(year, month, day) {
  const dt = new Date(year, month - 1, day);
  const dow = dt.getDay();
  if (dow === 6) {
    dt.setDate(dt.getDate() - 1);
  } else if (dow === 0) {
    dt.setDate(dt.getDate() + 1);
  }
  return formatDate(dt);
}

function holidaysForYear(year) {
  const rows = [];
  const add = (date, name) => rows.push({ date, name, country: "USA", active: true });

  add(observedDate(year, 1, 1), "New Year's Day");
  add(nthWeekdayOfMonth(year, 1, 1, 3), "Martin Luther King Jr. Day");
  add(nthWeekdayOfMonth(year, 2, 1, 3), "Presidents Day");
  add(lastWeekdayOfMonth(year, 5, 1), "Memorial Day");
  add(observedDate(year, 6, 19), "Juneteenth");
  add(observedDate(year, 7, 4), "Independence Day");
  add(nthWeekdayOfMonth(year, 9, 1, 1), "Labor Day");
  add(nthWeekdayOfMonth(year, 10, 1, 2), "Columbus Day");
  add(observedDate(year, 11, 11), "Veterans Day");
  add(nthWeekdayOfMonth(year, 11, 4, 4), "Thanksgiving Day");
  add(observedDate(year, 12, 25), "Christmas Day");

  return rows.filter((r) => r.date);
}

function getUsFederalHolidays() {
  const rows = [];
  for (let year = 2024; year <= 2028; year += 1) {
    rows.push(...holidaysForYear(year));
  }
  return rows;
}

async function main() {
  require("dotenv").config();
  const hrms = require("../lib/hrms-repo");
  const rows = getUsFederalHolidays();
  const result = await hrms.seedPublicHolidays(rows, "seed-script");
  console.log(`Seeded ${result.count} US federal holidays (2024–2028).`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { getUsFederalHolidays, holidaysForYear };
