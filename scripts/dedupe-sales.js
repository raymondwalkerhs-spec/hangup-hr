#!/usr/bin/env node
/**
 * Remove duplicate sales (same phone_number + submission_date).
 * Keeps the row with the most attachments, then most form_data keys, then newest updated_at.
 * Merges missing form_data from duplicates into survivor; deletes duplicate sale rows + attachment DB rows.
 *
 * IMPORTANT — storage cleanup:
 * - Does NOT delete files from Dropbox (recordings, confirmations, receipts).
 * - Unique attachments on dropped sales are REASSIGNED to the survivor (same file, new sale_id).
 * - Only deletes sales_attachments rows when kind+file_name duplicates the survivor's set.
 * - Supabase Storage remove() is attempted on dropbox_path but paths are usually Dropbox, not bucket keys.
 * - To free Dropbox space, run a separate orphan-file cleanup after dedupe.
 *
 * Usage:
 *   node scripts/dedupe-sales.js --dry-run
 *   node scripts/dedupe-sales.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getSupabaseAdmin } = require("../lib/supabase-client");

const DRY_RUN = process.argv.includes("--dry-run");
const LOG_PATH = path.join(__dirname, "..", "dedupe-sales-log.txt");

function scoreSale(sale, attachCount) {
  const fd = sale.form_data && typeof sale.form_data === "object" ? sale.form_data : {};
  const fdKeys = Object.values(fd).filter((v) => v != null && String(v).trim() !== "").length;
  const updated = Date.parse(sale.updated_at || sale.created_at || 0) || 0;
  return attachCount * 1000 + fdKeys * 10 + updated / 1e12;
}

function mergeFormData(target, source) {
  const out = { ...target };
  const src = source && typeof source === "object" ? source : {};
  for (const [k, v] of Object.entries(src)) {
    if (v == null || String(v).trim() === "") continue;
    if (out[k] == null || String(out[k]).trim() === "") out[k] = v;
  }
  return out;
}

async function main() {
  const db = getSupabaseAdmin();
  const { data: sales, error } = await db
    .from("sales")
    .select("id, phone_number, submission_date, form_data, agent_id, closer_id, client, device, price, status, created_at, updated_at");
  if (error) throw error;

  const { data: attachments, error: aErr } = await db
    .from("sales_attachments")
    .select("id, sale_id, kind, file_name, dropbox_path");
  if (aErr) throw aErr;

  const attachBySale = new Map();
  for (const a of attachments || []) {
    const list = attachBySale.get(a.sale_id) || [];
    list.push(a);
    attachBySale.set(a.sale_id, list);
  }

  const groups = new Map();
  for (const s of sales || []) {
    const phone = String(s.phone_number || "").replace(/\D/g, "").slice(-10);
    const date = String(s.submission_date || "").slice(0, 10);
    if (!phone || !date) continue;
    const key = `${phone}|${date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const dupGroups = [...groups.entries()].filter(([, list]) => list.length > 1);
  console.log(`Duplicate groups: ${dupGroups.length}${DRY_RUN ? " (DRY RUN)" : ""}`);

  const log = [];
  let deletedSales = 0;
  let deletedAttachments = 0;
  let mergedSales = 0;

  for (const [key, list] of dupGroups) {
    const ranked = list
      .map((s) => ({
        sale: s,
        score: scoreSale(s, (attachBySale.get(s.id) || []).length),
        attaches: attachBySale.get(s.id) || [],
      }))
      .sort((a, b) => b.score - a.score);
    const survivor = ranked[0];
    const losers = ranked.slice(1);
    let fd = survivor.sale.form_data && typeof survivor.sale.form_data === "object" ? { ...survivor.sale.form_data } : {};
    for (const loser of losers) {
      fd = mergeFormData(fd, loser.sale.form_data);
    }
    const survivorAttachKeys = new Set(
      survivor.attaches.map((a) => `${a.kind}|${a.file_name}`)
    );
    log.push(`KEEP ${survivor.sale.id} DROP ${losers.map((l) => l.sale.id).join(",")} key=${key}`);
    mergedSales++;

    if (!DRY_RUN) {
      await db.from("sales").update({ form_data: fd }).eq("id", survivor.sale.id);
    }

    for (const loser of losers) {
      for (const att of loser.attaches) {
        const dk = `${att.kind}|${att.file_name}`;
        if (!survivorAttachKeys.has(dk) && !DRY_RUN) {
          await db.from("sales_attachments").update({ sale_id: survivor.sale.id }).eq("id", att.id);
          survivorAttachKeys.add(dk);
        } else if (!DRY_RUN) {
          await db.from("sales_attachments").delete().eq("id", att.id);
          if (att.dropbox_path) {
            try {
              await db.storage.from("sales-attachments").remove([att.dropbox_path]);
            } catch {
              /* ignore storage cleanup errors */
            }
          }
          deletedAttachments++;
        } else {
          deletedAttachments++;
        }
      }
      if (!DRY_RUN) {
        await db.from("sales_attachments").delete().eq("sale_id", loser.sale.id);
        await db.from("sales").delete().eq("id", loser.sale.id);
      }
      deletedSales++;
    }
  }

  const summary = [
    `groups=${dupGroups.length} merged=${mergedSales} deletedSales=${deletedSales} deletedAttachments=${deletedAttachments} dryRun=${DRY_RUN}`,
    ...log,
  ].join("\n");
  fs.writeFileSync(LOG_PATH, summary, "utf8");
  console.log(summary.split("\n")[0]);
  console.log("Log:", LOG_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
