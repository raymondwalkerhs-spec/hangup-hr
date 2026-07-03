#!/usr/bin/env node
/**
 * Compare Dropbox sales folders vs sales_attachments rows.
 * Usage: node scripts/audit-dropbox-sales.js [--fix-links]
 */
require("dotenv").config();
const https = require("https");
const { getSupabaseAdmin } = require("../lib/supabase-client");

const FIX_LINKS = process.argv.includes("--fix-links");
const FOLDER = process.env.DROPBOX_SALES_FOLDER || "/Hangup-HR/Sales";

function dropboxApi(path, body) {
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) throw new Error("DROPBOX_ACCESS_TOKEN required");
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.dropboxapi.com",
        path,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = { raw: text };
          }
          if (res.statusCode >= 400) reject(new Error(data.error_summary || text));
          else resolve(data);
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listFolder(path) {
  const out = [];
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const data = cursor
      ? await dropboxApi("/2/files/list_folder/continue", { cursor })
      : await dropboxApi("/2/files/list_folder", { path, recursive: true });
    for (const e of data.entries || []) {
      if (e[".tag"] === "file") out.push(e.path_display);
    }
    hasMore = data.has_more;
    cursor = data.cursor;
  }
  return out;
}

async function main() {
  const db = getSupabaseAdmin();
  const { data: attachments, error } = await db.from("sales_attachments").select("*");
  if (error) throw new Error(error.message);

  const missingPath = (attachments || []).filter((a) => !a.dropbox_path);
  const missingLink = (attachments || []).filter((a) => a.dropbox_path && !a.dropbox_link);

  console.log(`Attachments: ${attachments?.length || 0}`);
  console.log(`Missing dropbox_path: ${missingPath.length}`);
  console.log(`Missing dropbox_link: ${missingLink.length}`);

  let dropboxFiles = [];
  try {
    dropboxFiles = await listFolder(FOLDER);
    console.log(`Dropbox files under ${FOLDER}: ${dropboxFiles.length}`);
  } catch (err) {
    console.warn(`Dropbox list skipped: ${err.message}`);
  }

  const dbPaths = new Set((attachments || []).map((a) => a.dropbox_path).filter(Boolean));
  const orphanFiles = dropboxFiles.filter((p) => !dbPaths.has(p));
  console.log(`Orphan Dropbox files (no DB row): ${orphanFiles.length}`);
  orphanFiles.slice(0, 20).forEach((p) => console.log(`  orphan ${p}`));

  if (FIX_LINKS && missingLink.length) {
    let fixed = 0;
    for (const row of missingLink) {
      try {
        const shared = await dropboxApi("/2/sharing/create_shared_link_with_settings", {
          path: row.dropbox_path,
          settings: { requested_visibility: "team" },
        });
        if (shared.url) {
          await db.from("sales_attachments").update({ dropbox_link: shared.url }).eq("id", row.id);
          fixed += 1;
        }
      } catch (err) {
        console.warn(`  link fix ${row.id}: ${err.message}`);
      }
    }
    console.log(`Fixed shared links: ${fixed}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
