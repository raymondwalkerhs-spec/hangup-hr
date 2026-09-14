/**
 * Office PO overdue scanner — predicted/postponed lines still open after next due month.
 * actionKey: office_po_overdue
 */
const pred = require("./office-po-prediction");
const { notifyOfficePo } = require("./office-po-notify");

const CHECK_MS = Number(process.env.OFFICE_PO_OVERDUE_NOTIFY_MS || 6 * 60 * 60 * 1000);
let timer = null;
let lastRunKey = null;

function currentYm(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * @param {Array<{ id: string, company: string, yearMonth: string, status: string, itemId: string }>} lines
 * @param {Map<string, object>} itemsById
 * @param {string} todayYm
 */
function selectOverdueLines(lines, itemsById, todayYm) {
  const out = [];
  for (const line of lines || []) {
    if (!["predicted", "postponed"].includes(line.status)) continue;
    const item = itemsById.get(line.itemId);
    if (!item) continue;
    const nextDue = pred.nextDueMonth(item, line.yearMonth);
    // Overdue when the line's month is before current month and next due has passed
    if (line.yearMonth < todayYm && nextDue <= todayYm) {
      out.push({ ...line, itemName: item.name || line.itemId, nextDue });
    }
  }
  return out;
}

async function scanAndNotifyOverdue() {
  const { useSupabase } = require("./backend");
  if (!useSupabase()) return { skipped: true };
  const { getSupabaseAdmin } = require("./supabase-client");
  const db = getSupabaseAdmin();
  const todayYm = currentYm();
  const runKey = todayYm;
  if (lastRunKey === runKey) return { skipped: true, reason: "already_ran_today" };

  const { data: lines, error } = await db
    .from("office_po_month_lines")
    .select("id, company, year_month, status, item_id")
    .in("status", ["predicted", "postponed"]);
  if (error) throw new Error(error.message);

  const mapped = (lines || []).map((r) => ({
    id: r.id,
    company: r.company,
    yearMonth: r.year_month,
    status: r.status,
    itemId: r.item_id,
  }));
  if (!mapped.length) {
    lastRunKey = runKey;
    return { count: 0 };
  }

  const itemIds = [...new Set(mapped.map((l) => l.itemId))];
  const { data: items, error: iErr } = await db.from("office_po_items").select("*").in("id", itemIds);
  if (iErr) throw new Error(iErr.message);
  const itemsById = new Map((items || []).map((i) => [i.id, {
    id: i.id,
    name: i.name,
    cadence: i.cadence,
    everyNMonths: i.every_n_months,
    anchorYearMonth: i.anchor_year_month,
  }]));

  const overdue = selectOverdueLines(mapped, itemsById, todayYm);
  for (const row of overdue.slice(0, 40)) {
    await notifyOfficePo("office_po_overdue", {
      title: `Office PO overdue — ${row.itemName}`,
      body: `${row.company} ${row.yearMonth} still ${row.status} (next due ${row.nextDue}). Open /office-po?month=${row.yearMonth}`,
      entityId: row.id,
      actor: "system",
      company: row.company,
    });
  }
  lastRunKey = runKey;
  return { count: overdue.length };
}

function startOfficePoOverdueNotifyLoop() {
  if (timer) return;
  const tick = () => {
    scanAndNotifyOverdue().catch((err) => console.warn("[office-po-overdue]", err.message));
  };
  tick();
  timer = setInterval(tick, CHECK_MS);
  if (typeof timer.unref === "function") timer.unref();
}

module.exports = {
  selectOverdueLines,
  scanAndNotifyOverdue,
  startOfficePoOverdueNotifyLoop,
  currentYm,
};
