const fs = require("fs");
const path = require("path");
const { getSupabaseAdmin } = require("./supabase-client");
const storage = require("./storage");
const business = require("./business-repo");
const store = require("./data-store");
const { buildExport } = require("./sales-export");
const { BACKUP_TABLES, SALES_ATTACHMENT_KINDS, RPM_ATTACHMENT_KINDS } = require("./backup-tables");
const programStorage = require("./sale-program-storage");
const rpmRepo = require("./rpm-sales-repo");

const BUCKET = storage.BUCKET;
const PAGE = 1000;

function db() {
  return getSupabaseAdmin();
}

function missingTable(err) {
  const m = String(err?.message || "").toLowerCase();
  return err?.code === "42P01" || m.includes("does not exist") || m.includes("schema cache");
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function writeJson(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

async function fetchTable(table) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db().from(table).select("*").range(from, from + PAGE - 1);
    if (error) {
      if (missingTable(error)) return null;
      throw new Error(`${table}: ${error.message}`);
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function downloadFile(storagePath, dest) {
  const { data, error } = await db().storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(error.message);
  const buf = Buffer.from(await data.arrayBuffer());
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function listAllStorage(prefix = "") {
  const out = [];
  async function walk(folder) {
    const { data, error } = await db().storage.from(BUCKET).list(folder, { limit: 1000 });
    if (error) {
      if (/not found/i.test(error.message)) return;
      throw error;
    }
    for (const item of data || []) {
      const rel = folder ? `${folder}/${item.name}` : item.name;
      if (item.id === null && !item.metadata) await walk(rel);
      else out.push(rel);
    }
  }
  await walk(prefix);
  return out;
}

async function exportDb(root, onProgress) {
  const summary = { tables: {}, skipped: [] };
  let i = 0;
  for (const table of BACKUP_TABLES) {
    i += 1;
    onProgress?.({ progress: Math.round((i / BACKUP_TABLES.length) * 40), message: `Table ${table}` });
    const rows = await fetchTable(table);
    if (rows === null) {
      summary.skipped.push(table);
      continue;
    }
    writeJson(path.join(root, "database", `${table}.json`), rows);
    summary.tables[table] = rows.length;
  }
  return summary;
}

async function exportStorage(root, onProgress) {
  const objects = await listAllStorage("");
  const summary = { files: 0, bytes: 0, errors: [] };
  let i = 0;
  for (const obj of objects) {
    i += 1;
    onProgress?.({ progress: 42 + Math.round((i / Math.max(objects.length, 1)) * 55), message: obj });
    try {
      summary.bytes += await downloadFile(obj, path.join(root, "storage", obj.split("/").join(path.sep)));
      summary.files += 1;
    } catch (e) {
      summary.errors.push({ path: obj, error: e.message });
    }
  }
  return summary;
}

async function runFullBackup(outputRoot, onProgress) {
  const root = path.join(outputRoot, `hangup-full-backup-${stamp()}`);
  ensureDir(root);
  const database = await exportDb(root, onProgress);
  const storageSummary = await exportStorage(root, onProgress);
  const manifest = { type: "full", createdAt: new Date().toISOString(), database, storage: storageSummary };
  writeJson(path.join(root, "manifest.json"), manifest);
  return { root, manifest };
}

async function readAllAttachments(table = "sales_attachments") {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db().from(table).select("*").range(from, from + PAGE - 1);
    if (error) {
      if (missingTable(error)) return [];
      throw error;
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function backupAttachmentRows({ attachments, saleIdField, rootSubdir, kinds, summary, onProgress }) {
  const kindSet = new Set(kinds);
  const filtered = attachments.filter(
    (a) => kindSet.has(a.kind) && programStorage.isSaleProgramStoragePath(a.dropbox_path || a.dropboxPath || "")
  );
  let i = 0;
  for (const att of filtered) {
    i += 1;
    onProgress?.({
      progress: 25 + Math.round((i / Math.max(filtered.length, 1)) * 70),
      message: att.file_name || att.fileName,
    });
    const saleId = att[saleIdField];
    const storagePath = att.dropbox_path || att.dropboxPath;
    const rel = `${rootSubdir}/${saleId}/${att.kind}/${safeName(att.file_name || att.fileName)}`;
    try {
      summary.bytes += await downloadFile(storagePath, path.join(summary.root, rel));
      summary.attachments += 1;
    } catch (e) {
      summary.errors.push({ id: att.id, error: e.message });
    }
  }
}

function safeName(n) {
  return String(n || "file").replace(/[<>:"/\\|?*]/g, "_");
}

async function runSalesBackup(outputRoot, onProgress, opts = {}) {
  const root = path.join(outputRoot, `hangup-sales-backup-${stamp()}`);
  ensureDir(root);
  await store.ensureSynced();
  let sales = await business.readSales({}, { skipCache: true });
  if (opts.from) sales = sales.filter((s) => String(s.submissionDate || s.effectiveDate || "") >= opts.from);
  if (opts.to) sales = sales.filter((s) => String(s.submissionDate || s.effectiveDate || "") <= opts.to);
  const employees = store.getEmployees();
  onProgress?.({ progress: 15, message: `Excel (${sales.length} rows)` });
  const { buffer } = await buildExport({ sales, employees, format: "xlsx" });
  fs.writeFileSync(path.join(root, "sales.xlsx"), buffer);
  const saleIds = new Set(sales.map((s) => s.id));
  const mlaAttachments = (await readAllAttachments("sales_attachments")).filter(
    (a) =>
      saleIds.has(a.sale_id) &&
      programStorage.isMlaStoragePath(a.dropbox_path || "")
  );
  const summary = { excelRows: sales.length, attachments: 0, bytes: 0, errors: [], root };
  await backupAttachmentRows({
    attachments: mlaAttachments,
    saleIdField: "sale_id",
    rootSubdir: "mla-attachments",
    kinds: SALES_ATTACHMENT_KINDS,
    summary,
    onProgress,
  });
  const manifest = {
    type: "sales",
    saleProgram: "mla",
    createdAt: new Date().toISOString(),
    kinds: SALES_ATTACHMENT_KINDS,
    summary: { excelRows: summary.excelRows, attachments: summary.attachments, bytes: summary.bytes, errors: summary.errors },
  };
  writeJson(path.join(root, "manifest.json"), manifest);
  return { root, manifest };
}

async function runRpmSalesBackup(outputRoot, onProgress, opts = {}) {
  const root = path.join(outputRoot, `hangup-rpm-sales-backup-${stamp()}`);
  ensureDir(root);
  let rpmSales = await rpmRepo.readRpmSales({});
  if (opts.from) {
    rpmSales = rpmSales.filter((s) => String(s.submissionDate || s.effectiveDate || "") >= opts.from);
  }
  if (opts.to) {
    rpmSales = rpmSales.filter((s) => String(s.submissionDate || s.effectiveDate || "") <= opts.to);
  }
  writeJson(path.join(root, "rpm-sales.json"), rpmSales);
  const rpmSaleIds = new Set(rpmSales.map((s) => s.id));
  const rpmAttachments = (await readAllAttachments("rpm_sales_attachments")).filter((a) =>
    rpmSaleIds.has(a.rpm_sale_id)
  );
  const summary = { rows: rpmSales.length, attachments: 0, bytes: 0, errors: [], root };
  await backupAttachmentRows({
    attachments: rpmAttachments,
    saleIdField: "rpm_sale_id",
    rootSubdir: "rpm-attachments",
    kinds: RPM_ATTACHMENT_KINDS,
    summary,
    onProgress,
  });
  const manifest = {
    type: "rpm-sales",
    saleProgram: "rpm",
    createdAt: new Date().toISOString(),
    kinds: RPM_ATTACHMENT_KINDS,
    summary: { rows: summary.rows, attachments: summary.attachments, bytes: summary.bytes, errors: summary.errors },
  };
  writeJson(path.join(root, "manifest.json"), manifest);
  return { root, manifest };
}

module.exports = { runFullBackup, runSalesBackup, runRpmSalesBackup, SALES_ATTACHMENT_KINDS, RPM_ATTACHMENT_KINDS };
