/**
 * Egyptian public holidays 2024–2028 (inactive by default until admin enables in Settings).
 * Islamic dates are official/public observance days commonly used in Egypt.
 */

function getEgyptianHolidays() {
  const rows = [];
  const add = (date, name, active = false) =>
    rows.push({ date, name, country: "EGY", active });

  const fixed = (year) => {
    add(`${year}-01-07`, "Coptic Christmas", false);
    add(`${year}-01-25`, "Revolution Day (25 January)", false);
    add(`${year}-04-25`, "Sinai Liberation Day", false);
    add(`${year}-05-01`, "Labour Day", false);
    add(`${year}-07-23`, "Revolution Day (23 July)", false);
    add(`${year}-10-06`, "Armed Forces Day", false);
  };

  const islamicByYear = {
    2024: [
      ["2024-04-10", "Eid al-Fitr"],
      ["2024-04-11", "Eid al-Fitr (Day 2)"],
      ["2024-06-16", "Eid al-Adha"],
      ["2024-06-17", "Eid al-Adha (Day 2)"],
      ["2024-07-07", "Islamic New Year"],
      ["2024-09-15", "Prophet Muhammad's Birthday"],
      ["2024-05-06", "Sham el-Nessim"],
    ],
    2025: [
      ["2025-03-30", "Eid al-Fitr"],
      ["2025-03-31", "Eid al-Fitr (Day 2)"],
      ["2025-06-06", "Eid al-Adha"],
      ["2025-06-07", "Eid al-Adha (Day 2)"],
      ["2025-06-26", "Islamic New Year"],
      ["2025-09-05", "Prophet Muhammad's Birthday"],
      ["2025-04-21", "Sham el-Nessim"],
    ],
    2026: [
      ["2026-03-20", "Eid al-Fitr"],
      ["2026-03-21", "Eid al-Fitr (Day 2)"],
      ["2026-05-27", "Eid al-Adha"],
      ["2026-05-28", "Eid al-Adha (Day 2)"],
      ["2026-06-16", "Islamic New Year"],
      ["2026-08-26", "Prophet Muhammad's Birthday"],
      ["2026-04-06", "Sham el-Nessim"],
    ],
    2027: [
      ["2027-03-09", "Eid al-Fitr"],
      ["2027-03-10", "Eid al-Fitr (Day 2)"],
      ["2027-05-16", "Eid al-Adha"],
      ["2027-05-17", "Eid al-Adha (Day 2)"],
      ["2027-06-06", "Islamic New Year"],
      ["2027-08-15", "Prophet Muhammad's Birthday"],
      ["2027-03-22", "Sham el-Nessim"],
    ],
    2028: [
      ["2028-02-26", "Eid al-Fitr"],
      ["2028-02-27", "Eid al-Fitr (Day 2)"],
      ["2028-05-05", "Eid al-Adha"],
      ["2028-05-06", "Eid al-Adha (Day 2)"],
      ["2028-05-26", "Islamic New Year"],
      ["2028-08-04", "Prophet Muhammad's Birthday"],
      ["2028-04-09", "Sham el-Nessim"],
    ],
  };

  for (let year = 2024; year <= 2028; year += 1) {
    fixed(year);
    for (const [date, name] of islamicByYear[year] || []) {
      add(date, name, false);
    }
  }

  return rows;
}

async function main() {
  require("dotenv").config();
  const hrms = require("../lib/hrms-repo");
  const rows = getEgyptianHolidays();
  const result = await hrms.seedPublicHolidays(rows, "seed-script");
  console.log(`Seeded ${result.count} Egyptian holidays (2024–2028, inactive by default).`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { getEgyptianHolidays };
