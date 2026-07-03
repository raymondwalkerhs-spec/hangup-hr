const { getSupabaseAdmin } = require("./supabase-client");
const { bumpRevision } = require("./settings-revision");

function db() {
  return getSupabaseAdmin();
}

function mapClient(r) {
  return {
    id: r.id,
    name: r.name,
    status: r.status || "active",
    statusMessage: r.status_message || "",
    sortOrder: r.sort_order || 0,
    products: [],
  };
}

function mapProduct(r) {
  return {
    id: r.id,
    clientId: r.client_id,
    deviceType: r.device_type,
    label: r.label || r.device_type,
    isFavored: r.is_favored === true,
    priorityNote: r.priority_note || "",
    active: r.active !== false,
    sortOrder: r.sort_order || 0,
    prices: [],
  };
}

function mapPrice(r) {
  return {
    id: r.id,
    productId: r.product_id,
    label: r.label || "Standard",
    price: Number(r.price) || 0,
    active: r.active !== false,
    sortOrder: r.sort_order || 0,
  };
}

async function readSalesClientsCatalog() {
  const { data: clients, error: e1 } = await db().from("sales_clients").select("*").order("sort_order").order("name");
  if (e1) throw new Error(e1.message);
  const { data: products, error: e2 } = await db().from("sales_client_products").select("*").order("sort_order");
  if (e2) throw new Error(e2.message);
  const { data: prices, error: e3 } = await db().from("sales_client_product_prices").select("*").order("sort_order");
  if (e3) throw new Error(e3.message);

  const priceByProduct = new Map();
  for (const p of prices || []) {
    if (!priceByProduct.has(p.product_id)) priceByProduct.set(p.product_id, []);
    priceByProduct.get(p.product_id).push(mapPrice(p));
  }
  const prodByClient = new Map();
  for (const p of products || []) {
    const mapped = mapProduct(p);
    mapped.prices = (priceByProduct.get(p.id) || []).filter((x) => x.active);
    if (!prodByClient.has(p.client_id)) prodByClient.set(p.client_id, []);
    prodByClient.get(p.client_id).push(mapped);
  }
  return (clients || []).map((c) => {
    const out = mapClient(c);
    out.products = (prodByClient.get(c.id) || []).filter((p) => p.active);
    return out;
  });
}

async function upsertClient(payload) {
  const row = {
    name: String(payload.name || "").trim(),
    status: payload.status || "active",
    status_message: payload.statusMessage || "",
    sort_order: Number(payload.sortOrder) || 0,
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw new Error("Client name required");
  let q = db().from("sales_clients");
  if (payload.id) {
    const { data, error } = await q.update(row).eq("id", payload.id).select().single();
    if (error) throw new Error(error.message);
    await bumpRevision();
    return mapClient(data);
  }
  const { data, error } = await q.insert(row).select().single();
  if (error) throw new Error(error.message);
  await bumpRevision();
  return mapClient(data);
}

async function deleteClient(id) {
  const { error } = await db().from("sales_clients").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await bumpRevision();
}

async function upsertProduct(payload) {
  const row = {
    client_id: payload.clientId,
    device_type: payload.deviceType,
    label: payload.label || payload.deviceType,
    is_favored: payload.isFavored === true,
    priority_note: payload.priorityNote || "",
    active: payload.active !== false,
    sort_order: Number(payload.sortOrder) || 0,
    updated_at: new Date().toISOString(),
  };
  let data, error;
  if (payload.id) {
    ({ data, error } = await db().from("sales_client_products").update(row).eq("id", payload.id).select().single());
  } else {
    ({ data, error } = await db().from("sales_client_products").insert(row).select().single());
  }
  if (error) throw new Error(error.message);
  await bumpRevision();
  return mapProduct(data);
}

async function deleteProduct(id) {
  const { error } = await db().from("sales_client_products").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await bumpRevision();
}

async function upsertPrice(payload) {
  const row = {
    product_id: payload.productId,
    label: payload.label || "Standard",
    price: Number(payload.price) || 0,
    active: payload.active !== false,
    sort_order: Number(payload.sortOrder) || 0,
  };
  let data, error;
  if (payload.id) {
    ({ data, error } = await db().from("sales_client_product_prices").update(row).eq("id", payload.id).select().single());
  } else {
    ({ data, error } = await db().from("sales_client_product_prices").insert(row).select().single());
  }
  if (error) throw new Error(error.message);
  await bumpRevision();
  return mapPrice(data);
}

async function deletePrice(id) {
  const { error } = await db().from("sales_client_product_prices").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await bumpRevision();
}

module.exports = {
  readSalesClientsCatalog,
  upsertClient,
  deleteClient,
  upsertProduct,
  deleteProduct,
  upsertPrice,
  deletePrice,
};
