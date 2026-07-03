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

function normalizeDeviceType(device) {
  const d = String(device || "").toLowerCase();
  if (d.includes("watch")) return "smartwatch";
  if (d.includes("necklace")) return "necklace";
  if (d.includes("bracelet") || d.includes("band")) return "bracelet";
  return "smartwatch";
}

/** Seed sales_clients / products / prices from distinct values in the sales table. */
async function importFromExistingSales() {
  const { data: sales, error } = await db().from("sales").select("client, device, price, form_data");
  if (error) throw new Error(error.message);

  const { data: existingClients } = await db().from("sales_clients").select("id, name");
  const clientIdByName = new Map(
    (existingClients || []).map((c) => [String(c.name || "").trim().toLowerCase(), c.id])
  );
  const { data: existingProducts } = await db().from("sales_client_products").select("id, client_id, device_type, label");
  const productKey = (clientId, deviceType, label) => `${clientId}|${deviceType}|${label}`;
  const productIdByKey = new Map(
    (existingProducts || []).map((p) => [productKey(p.client_id, p.device_type, p.label || p.device_type), p.id])
  );

  let clientsAdded = 0;
  let productsAdded = 0;
  let pricesAdded = 0;

  for (const sale of sales || []) {
    const fd = sale.form_data || {};
    const clientName = String(sale.client || fd.client || "").trim();
    if (!clientName) continue;
    const cKey = clientName.toLowerCase();
    let clientId = clientIdByName.get(cKey);
    if (!clientId) {
      const { data: ins, error: e1 } = await db().from("sales_clients").insert({ name: clientName }).select().single();
      if (e1) throw new Error(e1.message);
      clientId = ins.id;
      clientIdByName.set(cKey, clientId);
      clientsAdded += 1;
    }

    const deviceRaw = sale.device || fd.deviceType || fd.device || "";
    const deviceType = normalizeDeviceType(deviceRaw);
    const label = String(deviceRaw || deviceType).trim() || deviceType;
    const pKey = productKey(clientId, deviceType, label);
    let productId = productIdByKey.get(pKey);
    if (!productId) {
      const { data: pIns, error: e2 } = await db()
        .from("sales_client_products")
        .insert({ client_id: clientId, device_type: deviceType, label })
        .select()
        .single();
      if (e2) throw new Error(e2.message);
      productId = pIns.id;
      productIdByKey.set(pKey, productId);
      productsAdded += 1;
    }

    const priceVal = Number(sale.price ?? fd.price);
    if (!Number.isFinite(priceVal) || priceVal <= 0) continue;
    const priceLabel = `From sales ($${priceVal})`;
    const { data: existingPrice } = await db()
      .from("sales_client_product_prices")
      .select("id")
      .eq("product_id", productId)
      .eq("price", priceVal)
      .maybeSingle();
    if (!existingPrice) {
      const { error: e3 } = await db().from("sales_client_product_prices").insert({
        product_id: productId,
        label: priceLabel,
        price: priceVal,
      });
      if (e3) throw new Error(e3.message);
      pricesAdded += 1;
    }
  }

  if (clientsAdded || productsAdded || pricesAdded) await bumpRevision();
  return { clientsAdded, productsAdded, pricesAdded, salesScanned: (sales || []).length };
}

async function catalogHasActiveProducts() {
  const catalog = await readSalesClientsCatalog();
  return catalog.some((c) => c.status !== "disabled" && (c.products || []).length > 0);
}

/** When catalog is populated, require valid client/product/price IDs and derive sale fields. */
async function validateAndResolveCatalogSale(body) {
  const catalog = await readSalesClientsCatalog();
  const hasCatalog = catalog.some((c) => c.status !== "disabled" && (c.products || []).length > 0);
  if (!hasCatalog) {
    return {
      client: body.client,
      device: body.device,
      price: body.price,
      formData: body.formData || {},
    };
  }

  const clientId = body.salesClientId || body.formData?.salesClientId;
  const productId = body.salesProductId || body.formData?.salesProductId;
  const priceId = body.salesPriceId || body.formData?.salesPriceId;
  if (!clientId || !productId || !priceId) {
    throw new Error("Select client, device, and price from Settings catalog");
  }

  const client = catalog.find((c) => c.id === clientId);
  if (!client) throw new Error("Invalid client selected");
  if (client.status === "disabled") throw new Error("This client is disabled");
  if (client.status === "hold") {
    throw new Error(client.statusMessage || "This client is on hold — submissions blocked");
  }

  const product = (client.products || []).find((p) => p.id === productId);
  if (!product) throw new Error("Invalid device for this client");
  const priceRow = (product.prices || []).find((pr) => pr.id === priceId);
  if (!priceRow) throw new Error("Invalid price tier");

  const formData = {
    ...(body.formData || {}),
    salesClientId: clientId,
    salesProductId: productId,
    salesPriceId: priceId,
    client: client.name,
    deviceType: product.deviceType,
  };

  return {
    client: client.name,
    device: product.deviceType,
    price: priceRow.price,
    formData,
  };
}

module.exports = {
  readSalesClientsCatalog,
  upsertClient,
  deleteClient,
  upsertProduct,
  deleteProduct,
  upsertPrice,
  deletePrice,
  importFromExistingSales,
  catalogHasActiveProducts,
  validateAndResolveCatalogSale,
};
