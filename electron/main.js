const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");

const path = require("path");

const fs = require("fs");

const { assertPathUnderRoot } = require("../lib/path-guard");

const { loadEnvironment, ensureCacheDirectory, assertSupabaseConfigured } = require("../lib/app-bootstrap");

const { createApp } = require("../app");

const { fetchAuthUsers, checkSessionByUserRecord } = require("../lib/auth");

const { getSession, destroySession } = require("../lib/session-store");

const { silentUninstall } = require("../lib/uninstall");

const { isOnline } = require("../lib/network");
const { authDebug, authDebugError, isAuthDebug } = require("../lib/auth-debug");

const PORT = 3847;

const HOST = "127.0.0.1";

const POLL_MS = 5 * 60 * 1000;

const PROTOCOL = "hangup-portal";

let mainWindow = null;

let pollTimer = null;

let currentSessionId = null;

let httpServer = null;

function parseOAuthCallbackUrl(url) {
  try {
    const raw = String(url || "");
    if (!raw.toLowerCase().startsWith(`${PROTOCOL}://`)) return null;
    // hangup-portal://auth/callback?code=...
    const normalized = raw.replace(/^hangup-portal:/i, "https:");
    const u = new URL(normalized);
    const code = u.searchParams.get("code") || new URLSearchParams(u.hash.replace(/^#/, "")).get("code");
    const error = u.searchParams.get("error_description") || u.searchParams.get("error");
    if (!code && !error) return { url: raw };
    return { code: code || null, error: error || null, url: raw };
  } catch {
    return null;
  }
}

function deliverOAuthCallback(url) {
  const payload = parseOAuthCallbackUrl(url);
  if (!payload) return false;
  try {
    const store = require("../lib/oauth-pending-store");
    if (payload.code || payload.error) {
      store.completeOauthFromCallback({
        code: payload.code,
        error: payload.error,
        mode: store.getPendingMode() || "cold",
      });
    }
  } catch {
    /* ignore */
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Put code in the URL so a remount still sees it (do not IPC-then-reload).
    const mode = (() => {
      try {
        return new URL(mainWindow.webContents.getURL()).searchParams.get("mode") || "cold";
      } catch {
        return "cold";
      }
    })();
    const qs = new URLSearchParams();
    if (payload.code) qs.set("code", payload.code);
    if (payload.error) qs.set("error", payload.error);
    qs.set("mode", mode);
    mainWindow.loadURL(`http://${HOST}:${PORT}/oauth-pending?${qs.toString()}`);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  return true;
}

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
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
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

  if (!session) {
    authDebug("electron.pollSession.miss", { sessionId: currentSessionId });
    return;
  }

  if (!(await isOnline())) return;

  try {
    const users = await fetchAuthUsers();

    const check = checkSessionByUserRecord(session.username, users, session.passwordChangedAtSnapshot);
    authDebug("electron.pollSession.check", { username: session.username, action: check.action });

    if (check.action === "uninstall") {
      await handleTerminated();

      return;
    }

    if (check.action === "admin") {
      authDebug("electron.pollSession.kick", { username: session.username, message: check.message });
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
  } catch (err) {
    authDebugError("electron.pollSession", err);
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
    if (isAuthDebug()) {
      console.log("[auth-debug] Auth debug logging is ON (HR_AUTH_DEBUG). Watch this terminal during login.");
    }
  } catch (err) {
    showFatalError("Hangup Portal — Startup error", err.message || String(err));
    app.quit();
    return;
  }

  createWindow();

let allowedWriteRoot = null;

  ipcMain.handle("pick-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose folder for payroll export",
    });
    if (result.canceled || !result.filePaths?.[0]) {
      allowedWriteRoot = null;
      return null;
    }
    allowedWriteRoot = path.resolve(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle("write-file-buffer", async (_, filePath, arrayBuffer) => {
    if (!allowedWriteRoot) {
      throw new Error("Choose an export folder first");
    }
    const dest = path.resolve(String(filePath || ""));
    assertPathUnderRoot(dest, allowedWriteRoot, "Write path must be inside the selected export folder");
    const dir = path.dirname(dest);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, Buffer.from(arrayBuffer));
    return true;
  });

  ipcMain.handle("set-session", (_, sessionId) => {
    authDebug("electron.setSession", { sessionId });
    currentSessionId = sessionId;
  });

  ipcMain.handle("clear-session", () => {
    authDebug("electron.clearSession");
    currentSessionId = null;
  });

  ipcMain.handle("trigger-uninstall", async () => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Uninstall Hangup Portal",
      message: "This will remove the application from your computer. Continue?",
      buttons: ["Cancel", "Uninstall"],
      defaultId: 0,
      cancelId: 0,
    });
    if (response !== 1) return false;
    await handleTerminated();
    return true;
  });

  const githubUpdater = require("../lib/github-updater");

  ipcMain.handle("check-github-update", async () => {
    try {
      const cloudUpdater = require("../lib/cloud-updater");
      return await cloudUpdater.checkForUpdate();
    } catch (err) {
      return { enabled: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("apply-github-update", async () => {
    const cloudUpdater = require("../lib/cloud-updater");
    const info = await cloudUpdater.checkForUpdate();
    if (!info?.updateAvailable) throw new Error("No update available");
    if (!info.assetUrl && !info.assetId) throw new Error("No update package found for this platform");
    const result = await cloudUpdater.applyUpdate(info);
    if (result?.needsQuit) {
      setTimeout(() => app.quit(), 500);
    }
    return {
      ok: true,
      version: info.latest,
      installRoot: require("../lib/github-updater").getInstallRoot(),
      method: result?.method,
      needsQuit: Boolean(result?.needsQuit),
      needsRelaunch: Boolean(result?.needsRelaunch),
    };
  });

  ipcMain.handle("relaunch-app", () => {
    githubUpdater.relaunchApp();
  });

  ipcMain.handle("open-external", async (_evt, url) => {
    const target = String(url || "");
    if (!/^https:\/\//i.test(target) && !target.toLowerCase().startsWith(`${PROTOCOL}://`)) {
      throw new Error("Only https or hangup-portal URLs allowed");
    }
    await shell.openExternal(target);
    return true;
  });

  pollTimer = setInterval(pollSession, POLL_MS);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = (argv || []).find((a) => String(a).toLowerCase().startsWith(`${PROTOCOL}://`));
    if (deepLink) deliverOAuthCallback(deepLink);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Protocol registration stub — packaging also needs protocols in package.json
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliverOAuthCallback(url);
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

    // Cold-start deep link (Windows passes protocol URL in argv)
    const bootLink = (process.argv || []).find((a) => String(a).toLowerCase().startsWith(`${PROTOCOL}://`));

    await bootstrap();
    if (bootLink) deliverOAuthCallback(bootLink);
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
