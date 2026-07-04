#!/usr/bin/env node
/**
 * Backfill catalog IDs (salesClientId / salesProductId / salesPriceId) into
 * sales.form_data for sales that only have text client/device values.
 *
 * Matching: client name (case-insensitive) → device type → price (when the
 * client has multiple products of the same device type). Favored products win
 * ties. Sales that cannot be matched unambiguously are reported and skipped.
 *
 * Usage:
 *   node scripts/backfill-sale-catalog-ids.js --dry-run
 *   node scripts/backfill-sale-catalog-ids.js
 */
require("dotenv").config();

const { getSupabaseAdmin } = require("../lib/supabase-client");
const { readSalesClientsCatalog } = require("../lib/sales-clients-repo");

const DRY_RUN = process.argv.includes("--dry-run");
const PAGE_SIZE = 500;

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function resolveSale(clients, sale) {
  const fd = sale.form_data && typeof sale.form_data === "object" ? sale.form_data : {};
  const clientName = norm(sale.client || fd.client);
  if (!clientName) return { skip: "no client name" };

  const client = clients.find((c) => norm(c.name) === clientName);
  if (!client) return { skip: `no catalog client matches "${sale.client || fd.client}"` };

  const deviceType = norm(sale.device || fd.deviceType);
  const priceValue = sale.price != null ? Number(sale.price) : fd.price != null ? Number(fd.price) : null;

  let candidates = deviceType
    ? (client.products || []).filter((p) => norm(p.deviceType) === deviceType)
    : [];
  if (!candidates.length) return { skip: `client "${client.name}" has no product with device "${deviceType}"` };

  if (candidates.length > 1 && priceValue != null) {
    const withPrice = candidates.filter((p) => (p.prices || []).some((pr) => Number(pr.price) === priceValue));
    if (withPrice.length) candidates = withPrice;
  }
  if (candidates.length > 1) {
    const favored = candidates.filter((p) => p.isFavored);
    if (favored.length) candidates = favored;
  }
  const product = candidates[0];

  let price = null;
  if (priceValue != null) {
    price = (product.prices || []).find((pr) => Number(pr.price) === priceValue) || null;
  }
  if (!price && (product.prices || []).length === 1) price = product.prices[0];

  return {
    clientId: client.id,
    productId: product.id,
    priceId: price ? price.id : null,
    clientNameCanonical: client.name,
    deviceTypeCanonical: product.deviceType,
  };
}

async function main() {
  const db = getSupabaseAdmin();
  const clients = await readSalesClientsCatalog();
  if (!clients.length) {
    console.error("No sales clients configured — nothing to match against. Aborting.");
    process.exit(1);
  }
  console.log(`Catalog: ${clients.length} clients loaded.${DRY_RUN ? " (DRY RUN)" : ""}`);

  let offset = 0;
  let scanned = 0;
  let updated = 0;
  let alreadyOk = 0;
  const skipped = [];

  for (;;) {
    const { data: rows, error } = await db
      .from("sales")
      .select("id, client, device, price, form_data")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!rows || !rows.length) break;

    for (const sale of rows) {
      scanned += 1;
      const fd = sale.form_data && typeof sale.form_data === "object" ? sale.form_data : {};
      if (fd.salesClientId && fd.salesProductId && fd.salesPriceId) {
        alreadyOk += 1;
        continue;
      }
      const res = resolveSale(clients, sale);
      if (res.skip) {
        skipped.push({ id: sale.id, client: sale.client, device: sale.device, price: sale.price, reason: res.skip });
        continue;
      }
      const nextForm = {
        ...fd,
        salesClientId: res.clientId,
        salesProductId: res.productId,
        client: fd.client || res.clientNameCanonical,
        deviceType: fd.deviceType || res.deviceTypeCanonical,
      };
      if (res.priceId) nextForm.salesPriceId = res.priceId;

      if (!DRY_RUN) {
        const { error: upErr } = await db.from("sales").update({ form_data: nextForm }).eq("id", sale.id);
        if (upErr) {
          skipped.push({ id: sale.id, reason: `update failed: ${upErr.message}` });
          continue;
        }
      }
      updated += 1;
    }
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`\nScanned: ${scanned}`);
  console.log(`Already had catalog IDs: ${alreadyOk}`);
  console.log(`${DRY_RUN ? "Would update" : "Updated"}: ${updated}`);
  console.log(`Skipped (no unambiguous match): ${skipped.length}`);
  if (skipped.length) {
    console.log("\nSkipped sales:");
    for (const s of skipped.slice(0, 50)) {
      console.log(`  ${s.id} — client="${s.client || ""}" device="${s.device || ""}" price=${s.price ?? ""} → ${s.reason}`);
    }
    if (skipped.length > 50) console.log(`  …and ${skipped.length - 50} more`);
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
