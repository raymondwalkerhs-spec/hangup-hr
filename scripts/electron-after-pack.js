/**
 * Disable Electron embedded ASAR integrity validation so in-app updates can
 * replace app.asar + .exe without "Invalid package app.asar" at launch.
 * electron-builder embeds a hash in the Windows .exe — mismatched asar fails before our code runs.
 */
const fs = require("fs");
const path = require("path");

module.exports = async function afterPack(context) {
  let flipFuses;
  let FuseVersion;
  let FuseV1Options;
  try {
    ({ flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses"));
  } catch {
    console.warn("electron-after-pack: @electron/fuses not installed — skipping fuse flip");
    return;
  }

  const product = context.packager.appInfo.productFilename;
  const candidates = [];

  if (process.platform === "darwin" || context.electronPlatformName === "darwin") {
    const appBundle = fs
      .readdirSync(context.appOutDir)
      .find((n) => n.endsWith(".app"));
    if (appBundle) {
      candidates.push(
        path.join(context.appOutDir, appBundle, "Contents", "MacOS", product)
      );
    }
  } else {
    candidates.push(path.join(context.appOutDir, `${product}.exe`));
  }

  const fuseOptions = {
    version: FuseVersion.V1,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: false,
  };

  for (const exePath of candidates) {
    if (!fs.existsSync(exePath)) continue;
    try {
      await flipFuses(exePath, fuseOptions);
      console.log(`electron-after-pack: disabled ASAR integrity fuse on ${exePath}`);
    } catch (err) {
      console.warn(`electron-after-pack: fuse flip failed for ${exePath}:`, err.message || err);
    }
  }
};
