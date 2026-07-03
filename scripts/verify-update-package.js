#!/usr/bin/env node
/**
 * Verify a GitHub update zip before publishing: extract safely, validate ASAR + SHA-256.
 * Usage: node scripts/verify-update-package.js <path-to.zip>
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { extractZipSafe } = require("../lib/zip-extract");
const { verifyExtractedPatch, validateAsarHeader } = require("../lib/update-integrity");

function main() {
  const zipPath = process.argv[2];
  if (!zipPath || !fs.existsSync(zipPath)) {
    console.error("Usage: node scripts/verify-update-package.js <path-to.zip>");
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hangup-hr-verify-"));
  const extractDir = path.join(tmp, "extracted");
  try {
    console.log(`Extracting ${zipPath}…`);
    extractZipSafe(zipPath, extractDir);

    const updateInfoPath = path.join(extractDir, "update-info.json");
    if (fs.existsSync(updateInfoPath)) {
      const patchInfo = JSON.parse(fs.readFileSync(updateInfoPath, "utf8"));
      console.log(
        `Patch ${patchInfo.fromVersion} → ${patchInfo.toVersion} (${patchInfo.platform}) — ${patchInfo.files?.length || 0} files`
      );
      verifyExtractedPatch(extractDir, patchInfo);
      console.log("Patch integrity OK (all files + checksums).");
    } else {
      const asar = path.join(extractDir, "resources", "app.asar");
      if (fs.existsSync(asar)) {
        validateAsarHeader(asar);
        console.log("Full zip: resources/app.asar OK.");
      } else {
        const entries = fs.readdirSync(extractDir);
        const root =
          entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()
            ? path.join(extractDir, entries[0])
            : extractDir;
        const nested = path.join(root, "resources", "app.asar");
        if (fs.existsSync(nested)) {
          validateAsarHeader(nested);
          console.log("Full zip: nested app.asar OK.");
        } else {
          throw new Error("No update-info.json or resources/app.asar found in zip");
        }
      }
    }
    console.log("VERIFY PASSED");
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main();
