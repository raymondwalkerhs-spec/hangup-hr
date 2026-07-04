#!/usr/bin/env node
/**
 * electron-builder only supports macOS targets when running on macOS.
 * https://www.electron.build/multi-platform-build
 */
if (process.platform !== "darwin") {
  console.error("");
  console.error("Hangup Portal: macOS builds cannot run on " + process.platform + ".");
  console.error("");
  console.error("Use one of these options:");
  console.error("  1. On a Mac — cd hr-app && npm run dist:mac");
  console.error("     (or ./scripts/build-macos.sh)");
  console.error("  2. GitHub Actions — push the repo and run the");
  console.error("     \"Build macOS\" workflow (uses a macOS runner).");
  console.error("  3. Cloud Mac — rent a Mac VM, clone the project, build there.");
  console.error("");
  console.error("Windows builds still work here: npm run dist:all");
  console.error("");
  process.exit(1);
}
