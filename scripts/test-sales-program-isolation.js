/**
 * Audit MLA vs RPM isolation: separate tables, client catalogs, storage roots, employee flags.
 */
require("dotenv").config();
const assert = require("assert");
const salesClients = require("../lib/sales-clients-repo");
const saleProgramAccess = require("../lib/sale-program-access");
const programStorage = require("../lib/sale-program-storage");
const { BACKUP_TABLES } = require("../lib/backup-tables");

async function main() {
  const mlaHangup = await salesClients.readSalesClientsCatalog("hangup", { saleProgram: "mla" });
  const rpmHangup = await salesClients.readSalesClientsCatalog("hangup", { saleProgram: "rpm" });

  const mlaNames = mlaHangup.map((c) => String(c.name || "").toLowerCase());
  const rpmNames = rpmHangup.map((c) => String(c.name || "").toLowerCase());

  const mlaHas = await salesClients.catalogHasActiveProducts("hangup", { saleProgram: "mla" });
  const rpmHas = await salesClients.catalogHasActiveProducts("hangup", { saleProgram: "rpm" });
  const rpmClientsOk = await salesClients.catalogHasActiveClients("hangup", { saleProgram: "rpm" });

  assert.ok(!mlaNames.includes("rpm1"), "RPM1 must not appear in MLA catalog");
  assert.ok(!mlaNames.includes("rpm2"), "RPM2 must not appear in MLA catalog");
  assert.ok(rpmNames.includes("rpm1") || rpmNames.length === 0, "RPM catalog probe");
  assert.ok(rpmHas || rpmClientsOk, "RPM catalog should be active when clients exist");

  const dialer = { id: "AG1", sales_mla_enabled: false, sales_rpm_enabled: true };
  const tl = { id: "TL1", sales_mla_enabled: true, sales_rpm_enabled: true };
  assert.deepEqual(saleProgramAccess.employeePrograms(dialer), ["rpm"]);
  assert.deepEqual(saleProgramAccess.employeePrograms(tl), ["mla", "rpm"]);

  assert.notStrictEqual(programStorage.MLA_TABLES.sales, programStorage.RPM_TABLES.sales);
  assert.notStrictEqual(programStorage.MLA_TABLES.attachments, programStorage.RPM_TABLES.attachments);
  for (const table of [
    programStorage.MLA_TABLES.sales,
    programStorage.MLA_TABLES.attachments,
    programStorage.RPM_TABLES.sales,
    programStorage.RPM_TABLES.attachments,
  ]) {
    assert.ok(BACKUP_TABLES.includes(table), `backup must include ${table}`);
  }

  const mlaQr = programStorage.qualityRecordFolder("mla", "sale-1");
  const rpmQr = programStorage.qualityRecordFolder("rpm", "sale-2");
  assert.ok(mlaQr.startsWith(`${programStorage.MLA_STORAGE_PREFIX}/`), "MLA quality_record root");
  assert.ok(rpmQr.startsWith(`${programStorage.RPM_STORAGE_PREFIX}/`), "RPM quality_record root");
  assert.ok(mlaQr.includes("/quality_record"), "MLA quality_record subfolder");
  assert.ok(rpmQr.includes("/quality_record"), "RPM quality_record subfolder");
  assert.ok(!mlaQr.startsWith(programStorage.RPM_STORAGE_PREFIX), "MLA quality path must not use RPM root");

  const mlaPath = programStorage.mlaSaleObjectPath("s1", "quality_record", "review.pdf");
  const rpmPath = programStorage.rpmSaleObjectPath("s2", "quality_record", "review.pdf");
  assert.ok(programStorage.isMlaStoragePath(mlaPath));
  assert.ok(programStorage.isRpmStoragePath(rpmPath));
  assert.ok(programStorage.isMlaStoragePath(`sales-attachments/legacy/q.pdf`), "legacy MLA prefix");
  assert.equal(programStorage.saleProgramFromStoragePath(rpmPath), "rpm");
  assert.equal(programStorage.saleProgramFromStoragePath(mlaPath), "mla");

  console.log(`MLA catalog active: ${mlaHas} (${mlaHangup.length} clients)`);
  console.log(`RPM catalog active: ${rpmHas} (${rpmHangup.length} clients, client-only check: ${rpmClientsOk})`);
  console.log(`MLA quality folder: ${mlaQr}`);
  console.log(`RPM quality folder: ${rpmQr}`);
  console.log("sales program isolation audit: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
