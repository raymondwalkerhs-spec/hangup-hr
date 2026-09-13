const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function throwDb(error, ctx) {
  const msg = error?.message || String(error);
  const e = new Error(`${ctx}: ${msg}`);
  e.cause = error;
  throw e;
}

function mapItem(r) {
  if (!r) return null;
  return {
    id: r.id,
    company: r.company,
    name: r.name,
    category: r.category || "",
    unit: r.unit || "",
    scaleMode: r.scale_mode,
    perEmployees: r.per_employees != null ? Number(r.per_employees) : null,
    packQty: r.pack_qty != null ? Number(r.pack_qty) : null,
    officeQty: r.office_qty != null ? Number(r.office_qty) : null,
    ignoreDaysScale: !!r.ignore_days_scale,
    cadence: r.cadence,
    everyNMonths: r.every_n_months != null ? Number(r.every_n_months) : null,
    anchorYearMonth: r.anchor_year_month || "",
    unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
    active: r.active !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapMeta(r) {
  if (!r) return null;
  return {
    company: r.company,
    yearMonth: r.year_month,
    avgEmployeesOverride: r.avg_employees_override != null ? Number(r.avg_employees_override) : null,
    daysInScopeOverride: r.days_in_scope_override != null ? Number(r.days_in_scope_override) : null,
    daysInScopeNote: r.days_in_scope_note || "",
    overrideNote: r.override_note || "",
    updatedBy: r.updated_by || "",
    updatedAt: r.updated_at,
  };
}

function mapLine(r) {
  if (!r) return null;
  return {
    id: r.id,
    company: r.company,
    yearMonth: r.year_month,
    itemId: r.item_id,
    status: r.status,
    predictedQty: Number(r.predicted_qty) || 0,
    predictedCost: r.predicted_cost != null ? Number(r.predicted_cost) : null,
    actualQty: Number(r.actual_qty) || 0,
    actualCost: Number(r.actual_cost) || 0,
    avgEmployeesUsed: r.avg_employees_used != null ? Number(r.avg_employees_used) : null,
    daysInScopeUsed: r.days_in_scope_used != null ? Number(r.days_in_scope_used) : null,
    note: r.note || "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPurchase(r) {
  if (!r) return null;
  return {
    id: r.id,
    monthLineId: r.month_line_id,
    company: r.company,
    qty: Number(r.qty) || 0,
    unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
    orderRef: r.order_ref || "",
    boughtAt: r.bought_at,
    boughtBy: r.bought_by || "",
    note: r.note || "",
  };
}

async function listItems(company, { includeInactive = false } = {}) {
  if (!useSupabase()) return [];
  let q = db().from("office_po_items").select("*").eq("company", company).order("name");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throwDb(error, "officePo.listItems");
  return (data || []).map(mapItem);
}

async function createItem(company, body) {
  const row = {
    company,
    name: String(body.name || "").trim(),
    category: body.category || null,
    unit: body.unit || null,
    scale_mode: body.scaleMode || body.scale_mode || "employee",
    per_employees: body.perEmployees ?? body.per_employees ?? null,
    pack_qty: body.packQty ?? body.pack_qty ?? null,
    office_qty: body.officeQty ?? body.office_qty ?? null,
    ignore_days_scale: body.ignoreDaysScale === true,
    cadence: body.cadence || "monthly",
    every_n_months: body.everyNMonths ?? body.every_n_months ?? null,
    anchor_year_month: body.anchorYearMonth || body.anchor_year_month || null,
    unit_price: body.unitPrice ?? body.unit_price ?? null,
    active: true,
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw new Error("name required");
  const { data, error } = await db().from("office_po_items").insert(row).select("*").single();
  if (error) throwDb(error, "officePo.createItem");
  return mapItem(data);
}

async function updateItem(company, id, body) {
  const patch = { updated_at: new Date().toISOString() };
  const map = {
    name: "name",
    category: "category",
    unit: "unit",
    scaleMode: "scale_mode",
    perEmployees: "per_employees",
    packQty: "pack_qty",
    officeQty: "office_qty",
    ignoreDaysScale: "ignore_days_scale",
    cadence: "cadence",
    everyNMonths: "every_n_months",
    anchorYearMonth: "anchor_year_month",
    unitPrice: "unit_price",
    active: "active",
  };
  for (const [k, col] of Object.entries(map)) {
    if (body[k] !== undefined) patch[col] = body[k];
  }
  const { data, error } = await db()
    .from("office_po_items")
    .update(patch)
    .eq("id", id)
    .eq("company", company)
    .select("*")
    .single();
  if (error) throwDb(error, "officePo.updateItem");
  return mapItem(data);
}

async function softDeleteItem(company, id) {
  return updateItem(company, id, { active: false });
}

async function getMeta(company, ym) {
  const { data, error } = await db()
    .from("office_po_month_meta")
    .select("*")
    .eq("company", company)
    .eq("year_month", ym)
    .maybeSingle();
  if (error) throwDb(error, "officePo.getMeta");
  return mapMeta(data);
}

async function upsertMeta(company, ym, body, username) {
  const row = {
    company,
    year_month: ym,
    avg_employees_override:
      body.avgEmployeesOverride === null || body.avgEmployeesOverride === ""
        ? null
        : body.avgEmployeesOverride != null
          ? Number(body.avgEmployeesOverride)
          : undefined,
    days_in_scope_override:
      body.daysInScopeOverride === null || body.daysInScopeOverride === ""
        ? null
        : body.daysInScopeOverride != null
          ? Number(body.daysInScopeOverride)
          : undefined,
    days_in_scope_note: body.daysInScopeNote != null ? String(body.daysInScopeNote) : undefined,
    override_note: body.overrideNote != null ? String(body.overrideNote) : undefined,
    updated_by: username || null,
    updated_at: new Date().toISOString(),
  };
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
  const { data, error } = await db()
    .from("office_po_month_meta")
    .upsert(row, { onConflict: "company,year_month" })
    .select("*")
    .single();
  if (error) throwDb(error, "officePo.upsertMeta");
  return mapMeta(data);
}

async function listLines(company, ym) {
  const { data, error } = await db()
    .from("office_po_month_lines")
    .select("*")
    .eq("company", company)
    .eq("year_month", ym);
  if (error) throwDb(error, "officePo.listLines");
  return (data || []).map(mapLine);
}

async function listPurchasesForLines(lineIds) {
  if (!lineIds.length) return [];
  const { data, error } = await db()
    .from("office_po_purchases")
    .select("*")
    .in("month_line_id", lineIds)
    .order("bought_at", { ascending: false });
  if (error) throwDb(error, "officePo.listPurchases");
  return (data || []).map(mapPurchase);
}

async function upsertPredictedLine(company, ym, predicted) {
  const existing = await db()
    .from("office_po_month_lines")
    .select("*")
    .eq("company", company)
    .eq("year_month", ym)
    .eq("item_id", predicted.itemId)
    .maybeSingle();
  if (existing.error) throwDb(existing.error, "officePo.upsertPredictedLine.find");
  const row = existing.data;
  if (row && row.status !== "predicted") {
    return mapLine(row);
  }
  const payload = {
    company,
    year_month: ym,
    item_id: predicted.itemId,
    status: "predicted",
    predicted_qty: predicted.predictedQty,
    predicted_cost: predicted.predictedCost,
    avg_employees_used: predicted.avgEmployeesUsed,
    days_in_scope_used: predicted.daysInScopeUsed,
    updated_at: new Date().toISOString(),
  };
  if (row) {
    const { data, error } = await db()
      .from("office_po_month_lines")
      .update(payload)
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throwDb(error, "officePo.upsertPredictedLine.update");
    return mapLine(data);
  }
  const { data, error } = await db().from("office_po_month_lines").insert(payload).select("*").single();
  if (error) throwDb(error, "officePo.upsertPredictedLine.insert");
  return mapLine(data);
}

async function getLine(company, id) {
  const { data, error } = await db()
    .from("office_po_month_lines")
    .select("*")
    .eq("id", id)
    .eq("company", company)
    .maybeSingle();
  if (error) throwDb(error, "officePo.getLine");
  return mapLine(data);
}

async function updateLineStatus(company, id, { status, note }) {
  const patch = { updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (note !== undefined) patch.note = note;
  const { data, error } = await db()
    .from("office_po_month_lines")
    .update(patch)
    .eq("id", id)
    .eq("company", company)
    .select("*")
    .single();
  if (error) throwDb(error, "officePo.updateLineStatus");
  return mapLine(data);
}

async function addPurchase(company, lineId, body, username) {
  const line = await getLine(company, lineId);
  if (!line) throw new Error("Line not found");
  const qty = Number(body.qty);
  if (!(qty >= 0)) throw new Error("qty required");
  const row = {
    month_line_id: lineId,
    company,
    qty,
    unit_price: body.unitPrice != null ? Number(body.unitPrice) : null,
    order_ref: body.orderRef || null,
    bought_by: username || null,
    note: body.note || null,
  };
  const { data, error } = await db().from("office_po_purchases").insert(row).select("*").single();
  if (error) throwDb(error, "officePo.addPurchase");
  await recomputeLineActuals(company, lineId);
  return mapPurchase(data);
}

async function deletePurchase(company, purchaseId) {
  const { data: pur, error: e1 } = await db()
    .from("office_po_purchases")
    .select("*")
    .eq("id", purchaseId)
    .eq("company", company)
    .maybeSingle();
  if (e1) throwDb(e1, "officePo.deletePurchase.find");
  if (!pur) throw new Error("Purchase not found");
  const { error } = await db().from("office_po_purchases").delete().eq("id", purchaseId);
  if (error) throwDb(error, "officePo.deletePurchase");
  await recomputeLineActuals(company, pur.month_line_id);
  return true;
}

async function recomputeLineActuals(company, lineId) {
  const purchases = await listPurchasesForLines([lineId]);
  let actualQty = 0;
  let actualCost = 0;
  for (const p of purchases) {
    actualQty += p.qty;
    if (p.unitPrice != null) actualCost += p.qty * p.unitPrice;
  }
  actualQty = Math.round(actualQty * 100) / 100;
  actualCost = Math.round(actualCost * 100) / 100;
  const status = purchases.length ? "bought" : "predicted";
  const { data, error } = await db()
    .from("office_po_month_lines")
    .update({
      actual_qty: actualQty,
      actual_cost: actualCost,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lineId)
    .eq("company", company)
    .select("*")
    .single();
  if (error) throwDb(error, "officePo.recomputeLineActuals");
  return mapLine(data);
}

module.exports = {
  listItems,
  createItem,
  updateItem,
  softDeleteItem,
  getMeta,
  upsertMeta,
  listLines,
  listPurchasesForLines,
  upsertPredictedLine,
  getLine,
  updateLineStatus,
  addPurchase,
  deletePurchase,
  recomputeLineActuals,
  mapItem,
  mapLine,
  mapMeta,
};
