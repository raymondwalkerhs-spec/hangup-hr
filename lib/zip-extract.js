/**
 * Safe zip extraction — never use PowerShell Expand-Archive (corrupts large app.asar).
 * adm-zip extractAllTo is also avoided (chmod ENOENT on Windows).
 */
const fs = require("fs");
const path = require("path");
const { validateAsarHeader } = require("./update-integrity");

function resolveSafeZipDest(extractDir, entryName) {
  const root = path.resolve(extractDir);
  const name = String(entryName || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!name || name.endsWith("/")) return null;
  if (name.includes("..") || path.isAbsolute(name)) {
    throw new Error(`Zip slip rejected: ${name}`);
  }
  const dest = path.resolve(root, ...name.split("/").filter(Boolean));
  if (dest !== root && !dest.startsWith(root + path.sep)) {
    throw new Error(`Zip slip rejected: ${name}`);
  }
  return dest;
}

function extractZipSafe(zipPath, extractDir) {
  const AdmZip = require("adm-zip");
  const root = path.resolve(extractDir);
  fs.mkdirSync(root, { recursive: true });
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, "/").replace(/^\.\//, "");
    const dest = resolveSafeZipDest(root, name);
    if (!dest) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const data = entry.getData();
    if (!data || !data.length) {
      console.warn(`SKIP empty zip entry: ${name}`);
      continue;
    }
    fs.writeFileSync(dest, data);
    if (name.toLowerCase().endsWith(".asar")) {
      validateAsarHeader(dest);
    }
  }
}

module.exports = { extractZipSafe, resolveSafeZipDest };
