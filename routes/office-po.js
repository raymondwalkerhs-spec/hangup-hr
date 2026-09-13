const express = require("express");
const roles = require("../lib/roles");
const companyContext = require("../lib/company-context");
const store = require("../lib/data-store");
const pred = require("../lib/office-po-prediction");
const repo = require("../lib/office-po-repo");
const { notifyOfficePo } = require("../lib/office-po-notify");
const { useSupabase } = require("../lib/backend");

const router = express.Router();

function parseCompany(req) {
  return companyContext.resolveCompanyContextForRequest(req) || "hangup";
}

function requireView(req, res) {
  if (!roles.canViewOfficePo(req.userRole)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function requireEdit(req, res) {
  if (!roles.canEditOfficePoPurchases(req.userRole)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function requireManageItems(req, res) {
  if (!roles.canManageOfficePoItems(req.userRole)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

router.get("/items", async (req, res) => {
  if (!requireView(req, res)) return;
  if (!useSupabase()) return res.json({ items: [] });
  try {
    const company = parseCompany(req);
    const items = await repo.listItems(company, { includeInactive: req.query.all === "1" });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/items", async (req, res) => {
  if (!requireManageItems(req, res)) return;
  try {
    const company = parseCompany(req);
    const item = await repo.createItem(company, req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/items/:id", async (req, res) => {
  if (!requireManageItems(req, res)) return;
  try {
    const company = parseCompany(req);
    const item = await repo.updateItem(company, req.params.id, req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/items/:id", async (req, res) => {
  if (!requireManageItems(req, res)) return;
  try {
    const company = parseCompany(req);
    const item = await repo.softDeleteItem(company, req.params.id);
    res.json({ ok: true, item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function computeAvgAuto(company, ym) {
  const employees = companyContext.filterEmployeesByCompany(
    store.getEmployees({ hideOut: false }),
    company
  );
  const ids = new Set(employees.map((e) => e.id));
  let periods = [];
  try {
    const hrms = require("../lib/hrms-repo");
    if (typeof hrms.listAllEmploymentPeriods === "function") {
      periods = await hrms.listAllEmploymentPeriods();
    } else if (typeof hrms.listEmploymentPeriods === "function") {
      for (const emp of employees) {
        const rows = await hrms.listEmploymentPeriods(emp.id);
        periods.push(...(rows || []).map((p) => ({ ...p, employeeId: emp.id })));
      }
    }
  } catch {
    periods = employees.map((e) => ({
      employeeId: e.id,
      startDate: e.employment_date || e.employmentDate,
      endDate: e.depart_date || e.departDate || null,
    }));
  }
  return pred.avgEmployeesAuto(ym, periods, ids);
}

router.get("/months/:ym", async (req, res) => {
  if (!requireView(req, res)) return;
  if (!useSupabase()) {
    return res.json({
      yearMonth: req.params.ym,
      avgAuto: 0,
      avgUsed: 0,
      daysAuto: pred.daysAutoInMonth(req.params.ym),
      daysUsed: pred.daysAutoInMonth(req.params.ym),
      meta: null,
      lines: [],
      purchases: [],
      items: [],
      stalePrediction: false,
    });
  }
  try {
    const company = parseCompany(req);
    const ym = req.params.ym;
    if (!pred.parseYearMonth(ym)) return res.status(400).json({ error: "Invalid year_month" });
    const [meta, items, lines] = await Promise.all([
      repo.getMeta(company, ym),
      repo.listItems(company),
      repo.listLines(company, ym),
    ]);
    const purchases = await repo.listPurchasesForLines(lines.map((l) => l.id));
    const avgAuto = await computeAvgAuto(company, ym);
    const avgUsed = pred.resolveAvgUsed(avgAuto, meta || {});
    const { daysAuto, daysUsed, daysScale } = pred.resolveDaysUsed(ym, meta || {});
    const stalePrediction = lines.some((l) => pred.isStalePrediction(l, avgUsed, daysUsed));
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const enrichedLines = lines.map((l) => ({
      ...l,
      item: itemMap.get(l.itemId) || null,
      nextDue: itemMap.get(l.itemId) ? pred.nextDueMonth(itemMap.get(l.itemId), ym) : null,
      varianceQty: Math.round((l.actualQty - l.predictedQty) * 100) / 100,
    }));
    res.json({
      yearMonth: ym,
      company,
      avgAuto,
      avgUsed,
      daysAuto,
      daysUsed,
      daysScale,
      meta,
      items,
      lines: enrichedLines,
      purchases,
      stalePrediction,
      kpis: {
        predictedSpend: enrichedLines.reduce((s, l) => s + (l.predictedCost || 0), 0),
        actualSpend: enrichedLines.reduce((s, l) => s + (l.actualCost || 0), 0),
        costPerEmployee: avgUsed > 0
          ? Math.round((enrichedLines.reduce((s, l) => s + (l.actualCost || l.predictedCost || 0), 0) / avgUsed) * 100) / 100
          : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/months/:ym/meta", async (req, res) => {
  if (!requireEdit(req, res)) return;
  try {
    const company = parseCompany(req);
    const ym = req.params.ym;
    if (!pred.parseYearMonth(ym)) return res.status(400).json({ error: "Invalid year_month" });
    const body = req.body || {};
    if (body.daysInScopeOverride != null && body.daysInScopeOverride !== "") {
      const daysAuto = pred.daysAutoInMonth(ym);
      const d = Number(body.daysInScopeOverride);
      if (!(d >= 1) || d > daysAuto) {
        return res.status(400).json({ error: `daysInScopeOverride must be 1..${daysAuto}` });
      }
      if (d !== daysAuto && !String(body.daysInScopeNote || "").trim()) {
        return res.status(400).json({ error: "daysInScopeNote required when days override is set" });
      }
    }
    const meta = await repo.upsertMeta(company, ym, body, req.username);
    res.json({ ok: true, meta });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/months/:ym/generate", async (req, res) => {
  if (!requireEdit(req, res)) return;
  try {
    const company = parseCompany(req);
    const ym = req.params.ym;
    if (!pred.parseYearMonth(ym)) return res.status(400).json({ error: "Invalid year_month" });
    const meta = await repo.getMeta(company, ym);
    const items = await repo.listItems(company);
    const existingLines = await repo.listLines(company, ym);
    const boughtItemIds = new Set(
      existingLines.filter((l) => l.status === "bought" || l.status === "cancelled").map((l) => l.itemId)
    );
    const avgAuto = await computeAvgAuto(company, ym);
    const avgUsed = pred.resolveAvgUsed(avgAuto, meta || {});
    const { daysUsed, daysScale } = pred.resolveDaysUsed(ym, meta || {});
    const upserted = [];
    for (const item of items) {
      if (!pred.isItemDue(item, ym)) continue;
      if (item.cadence === "one_time" && boughtItemIds.has(item.id)) continue;
      const predicted = pred.buildPredictedLine(item, ym, avgUsed, daysUsed, daysScale);
      const line = await repo.upsertPredictedLine(company, ym, predicted);
      upserted.push(line);
    }
    await notifyOfficePo("office_po_generated", {
      title: `Office PO generated — ${ym}`,
      body: `${upserted.length} predicted line(s) for ${company}. Open /office-po?month=${ym}`,
      entityId: `${company}:${ym}`,
      actor: req.username,
      company,
    });
    res.json({ ok: true, count: upserted.length, lines: upserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/lines/:id", async (req, res) => {
  if (!requireEdit(req, res)) return;
  try {
    const company = parseCompany(req);
    const status = req.body?.status;
    if (status && !["predicted", "bought", "postponed", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    if (req.body?.actualQty != null || req.body?.actual_qty != null) {
      return res.status(400).json({ error: "actual_qty is rollup-only; add a purchase instead" });
    }
    const line = await repo.updateLineStatus(company, req.params.id, {
      status,
      note: req.body?.note,
    });
    if (status === "postponed") {
      await notifyOfficePo("office_po_postponed", {
        title: "Office PO line postponed",
        body: `Line ${line.id} postponed for ${line.yearMonth}`,
        entityId: line.id,
        actor: req.username,
        company,
      });
    }
    res.json({ ok: true, line });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/lines/:id/purchases", async (req, res) => {
  if (!requireEdit(req, res)) return;
  try {
    const company = parseCompany(req);
    const purchase = await repo.addPurchase(company, req.params.id, req.body || {}, req.username);
    const line = await repo.getLine(company, req.params.id);
    await notifyOfficePo("office_po_bought", {
      title: "Office PO purchase recorded",
      body: `Bought qty ${purchase.qty} for ${line?.yearMonth || ""}`,
      entityId: line?.id,
      actor: req.username,
      company,
    });
    if (line && line.actualQty > line.predictedQty * 1.25 + 0.001) {
      await notifyOfficePo("office_po_overbuy", {
        title: "Office PO over-buy",
        body: `Actual ${line.actualQty} > predicted ${line.predictedQty} for ${line.yearMonth}`,
        entityId: line.id,
        actor: req.username,
        company,
      });
    }
    res.json({ ok: true, purchase, line });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/purchases/:id", async (req, res) => {
  if (!requireEdit(req, res)) return;
  try {
    const company = parseCompany(req);
    await repo.deletePurchase(company, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
