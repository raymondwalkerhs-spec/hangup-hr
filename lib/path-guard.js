const path = require("path");

/** True when resolved dest is root or a file/dir under root. */
function isPathUnderRoot(destPath, rootPath) {
  const dest = path.resolve(String(destPath || ""));
  const root = path.resolve(String(rootPath || ""));
  return dest === root || dest.startsWith(root + path.sep);
}

function assertPathUnderRoot(destPath, rootPath, message) {
  if (!isPathUnderRoot(destPath, rootPath)) {
    throw new Error(message || "Write path must be inside the selected export folder");
  }
}

module.exports = { isPathUnderRoot, assertPathUnderRoot };
