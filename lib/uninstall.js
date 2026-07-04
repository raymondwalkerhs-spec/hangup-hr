const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function silentUninstall() {
  const exeDir = path.dirname(process.execPath);
  const names = [
    "Uninstall Hangup Portal.exe",
    "Uninstall Hangup HR Beta.exe",
    "Uninstall Hangup HR.exe",
    "Uninstall Hangup HR System.exe",
    "Uninstall.exe",
  ];

  for (const name of names) {
    const uninstaller = path.join(exeDir, name);
    if (fs.existsSync(uninstaller)) {
      try {
        spawn(uninstaller, ["/S"], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        }).unref();
        return true;
      } catch {
        /* fall through */
      }
    }
  }
  return false;
}

module.exports = { silentUninstall };
