/**
 * Update package integrity — ASAR header check + optional SHA-256 verification.
 * Prevents "Invalid package app.asar" from corrupted zip extraction or partial copies.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function validateAsarHeader(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Invalid package ${filePath} (missing)`);
  }
  const stat = fs.statSync(filePath);
  if (stat.size < 64) {
    throw new Error(`Invalid package ${filePath} (too small: ${stat.size} bytes)`);
  }
  const fd = fs.openSync(filePath, "r");
  try {
    const sizeBuf = Buffer.alloc(8);
    fs.readSync(fd, sizeBuf, 0, 8, 0);
    const jsonSize = sizeBuf.readUInt32LE(4);
    const jsonStart = 8;
    if (!Number.isFinite(jsonSize) || jsonSize < 2 || jsonStart + jsonSize > stat.size) {
      throw new Error(`Invalid package ${filePath} (bad JSON header size ${jsonSize})`);
    }
    const readLen = Math.min(jsonSize, 8192);
    const headerBuf = Buffer.alloc(readLen);
    fs.readSync(fd, headerBuf, 0, readLen, jsonStart);
    const headerText = headerBuf.toString("utf8", 0, readLen);
    if (!headerText.includes('"files"')) {
      throw new Error(`Invalid package ${filePath} (missing ASAR files header)`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function validatePayloadFile(filePath, rel, expectedSha) {
  const norm = String(rel || "").replace(/\\/g, "/");
  if (norm.toLowerCase().endsWith(".asar")) {
    validateAsarHeader(filePath);
  }
  if (expectedSha) {
    const actual = sha256File(filePath);
    if (actual !== expectedSha) {
      throw new Error(
        `Checksum mismatch for ${norm} (expected ${expectedSha.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`
      );
    }
  }
}

function verifyExtractedPatch(extractDir, patchInfo) {
  const hashes = patchInfo?.fileHashes || {};
  const files = patchInfo?.files || [];
  for (const rel of files) {
    const src = path.join(extractDir, rel.replace(/\//g, path.sep));
    if (!fs.existsSync(src)) {
      throw new Error(`Patch incomplete: missing ${rel}`);
    }
    validatePayloadFile(src, rel, hashes[rel]);
  }
}

function copyFileVerified(src, dest, rel, expectedSha) {
  validatePayloadFile(src, rel, expectedSha);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const staging = `${dest}.hr-staging`;
  try {
    if (fs.existsSync(staging)) fs.unlinkSync(staging);
  } catch {
    /* ignore */
  }
  fs.copyFileSync(src, staging);
  validatePayloadFile(staging, rel, expectedSha);
  fs.copyFileSync(staging, dest);
  try {
    fs.unlinkSync(staging);
  } catch {
    /* ignore */
  }
}

module.exports = {
  sha256File,
  validateAsarHeader,
  validatePayloadFile,
  verifyExtractedPatch,
  copyFileVerified,
};
