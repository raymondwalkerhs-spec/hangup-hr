const { selectOverdueLines } = require("../lib/office-po-overdue-notify");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

{
  const itemsById = new Map([
    ["i1", { id: "i1", name: "Cups", cadence: "monthly", anchorYearMonth: "2026-01" }],
  ]);
  const lines = [
    { id: "l1", company: "hangup", yearMonth: "2026-07", status: "predicted", itemId: "i1" },
    { id: "l2", company: "hangup", yearMonth: "2026-09", status: "predicted", itemId: "i1" },
    { id: "l3", company: "hangup", yearMonth: "2026-07", status: "bought", itemId: "i1" },
  ];
  const overdue = selectOverdueLines(lines, itemsById, "2026-09");
  assert(overdue.length === 1 && overdue[0].id === "l1", "only past predicted overdue");
}

console.log("office-po-overdue-notify.test.js OK");
