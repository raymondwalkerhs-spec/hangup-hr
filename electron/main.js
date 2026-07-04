const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const path = require("path");

const fs = require("fs");

const { loadEnvironment, ensureCacheDirectory, assertSupabaseConfigured } = require("../lib/app-bootstrap");

const { createApp } = require("../app");

const { fetchAuthUsers, checkSession } = require("../lib/auth");

const { getSession, destroySession } = require("../lib/session-store");

const { silentUninstall } = require("../lib/uninstall");

const { isOnline } = require("../lib/network");

const PORT = 3847;

const HOST = "127.0.0.1";

const POLL_MS = 5 * 60 * 1000;

let mainWindow = null;

let pollTimer = null;

let currentSessionId = null;

let httpServer = null;

function showFatalError(title, message) {
  dialog.showErrorBox(title, message);
}

function configurePortablePaths() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;

  if (!portableDir) return null;

  const dataDir = path.join(portableDir, "HangupHR-data");

  fs.mkdirSync(dataDir, { recursive: true });

  app.setPath("userData", dataDir);

  process.env.HR_PORTABLE = "1";

  return dataDir;
}

function startServer() {
  return new Promise((resolve, reject) => {
    try {
      const expressApp = createApp();
      const server = expressApp.listen(PORT, HOST);

      server.once("listening", () => resolve(server));

      server.once("error", (err) => {
        if (err.code === "EADDRINUSE") {
          reject(
            new Error(
              `Port ${PORT} is already in use. Close any other Hangup Portal window or app using that port, then try again.`
            )
          );
          return;
        }
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Hangup Portal",
    icon: path.join(__dirname, "..", "Asset", "HRTeam.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      if (validatedURL && !validatedURL.includes(`${HOST}:${PORT}`)) return;
      showFatalError(
        "Hangup Portal — Could not open login page",
        `The app could not load the sign-in screen.\n\n${errorDescription} (${errorCode})\n\nTry closing other Hangup Portal windows and restart. If this continues, reinstall the app.`
      );
    }
  );

  mainWindow.loadURL(`http://${HOST}:${PORT}/login`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function handleTerminated() {
  silentUninstall();

  if (mainWindow) mainWindow.destroy();

  app.quit();
}

async function pollSession() {
  if (!currentSessionId) return;

  const session = getSession(currentSessionId);

  if (!session) return;

  if (!(await isOnline())) return;

  try {
    const users = await fetchAuthUsers();

    const check = await checkSession(session.username, session.password, users);

    if (check.action === "uninstall") {
      await handleTerminated();

      return;
    }

    if (check.action === "admin") {
      destroySession(currentSessionId);

      currentSessionId = null;

      if (mainWindow) {
        await dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "Hangup Portal",
          message: check.message || "Contact Admin.",
          buttons: ["OK"],
        });

        mainWindow.loadURL(`http://${HOST}:${PORT}/login`);
      }
    }
  } catch {
    /* network blip — next poll */
  }
}

async function bootstrap() {
  try {
    assertSupabaseConfigured();
  } catch (err) {
    showFatalError("Hangup Portal — Configuration error", err.message || String(err));
    app.quit();
    return;
  }

  try {
    ensureCacheDirectory(path.join(app.getPath("userData"), "hr-cache"));
  } catch (err) {
    showFatalError(
      "Hangup Portal — Storage error",
      `Could not create local cache folder:\n${err.message}`
    );
    app.quit();
    return;
  }

  try {
    httpServer = await startServer();
  } catch (err) {
    showFatalError("Hangup Portal — Startup error", err.message || String(err));
    app.quit();
    return;
  }

  createWindow();

  ipcMain.handle("pick-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose folder for payroll export",
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("write-file-buffer", async (_, filePath, arrayBuffer) => {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
    return true;
  });

  ipcMain.handle("set-session", (_, sessionId) => {
    currentSessionId = sessionId;
  });

  ipcMain.handle("clear-session", () => {
    currentSessionId = null;
  });

  ipcMain.handle("trigger-uninstall", async () => {
    await handleTerminated();
  });

  const githubUpdater = require("../lib/github-updater");

  ipcMain.handle("check-github-update", async () => {
    try {
      return await githubUpdater.checkForGitHubUpdate();
    } catch (err) {
      return { enabled: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("apply-github-update", async () => {
    const info = await githubUpdater.checkForGitHubUpdate();
    if (!info?.updateAvailable) throw new Error("No update available");
    if (!info.assetUrl && !info.assetId) throw new Error("No update package found for this platform");
    const result = await githubUpdater.applyGitHubUpdate(info);
    if (result?.needsQuit) {
      setTimeout(() => app.quit(), 500);
    }
    return {
      ok: true,
      version: info.latest,
      installRoot: githubUpdater.getInstallRoot(),
      method: result?.method,
      needsQuit: Boolean(result?.needsQuit),
      needsRelaunch: Boolean(result?.needsRelaunch),
    };
  });

  ipcMain.handle("relaunch-app", () => {
    githubUpdater.relaunchApp();
  });

  pollTimer = setInterval(pollSession, POLL_MS);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  configurePortablePaths();

  loadEnvironment();

  app.whenReady().then(async () => {
    const githubUpdater = require("../lib/github-updater");
    const recovery = githubUpdater.recoverOrCompleteUpdate();
    if (recovery?.action === "exit") return;
    if (recovery?.installHealth && !recovery.installHealth.ok) {
      process.env.HR_INSTALL_HEALTH = JSON.stringify(recovery.installHealth);
    }

    await bootstrap();
  }).catch((err) => {
    showFatalError("Hangup Portal — Startup error", err.message || String(err));
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && httpServer) createWindow();
  });
}

app.on("window-all-closed", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (httpServer) {
    try {
      httpServer.close();
    } catch {
      /* ignore */
    }
  }
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (err) => {
  showFatalError("Hangup Portal — Unexpected error", err.message || String(err));
  app.quit();
});
