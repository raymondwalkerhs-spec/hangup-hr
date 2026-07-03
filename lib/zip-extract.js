/**
 * Safe zip extraction — never use PowerShell Expand-Archive (corrupts large app.asar).
 * adm-zip extractAllTo is also avoided (chmod ENOENT on Windows).
 */
const fs = require("fs");
const path = require("path");
const { validateAsarHeader } = require("./update-integrity");

function extractZipSafe(zipPath, extractDir) {
  const AdmZip = require("adm-zip");
  fs.mkdirSync(extractDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!name || name.endsWith("/")) continue;
    const dest = path.join(extractDir, ...name.split("/").filter(Boolean));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const data = entry.getData();
    if (!data || !data.length) {
      throw new Error(`Zip entry empty: ${name}`);
    }
    fs.writeFileSync(dest, data);
    if (name.toLowerCase().endsWith(".asar")) {
      validateAsarHeader(dest);
    }
  }
}

module.exports = { extractZipSafe };
