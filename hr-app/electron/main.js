const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const path = require("path");

const fs = require("fs");

const { loadEnvironment, ensureCacheDirectory } = require("../lib/app-bootstrap");



const { createApp } = require("../app");

const { fetchAuthUsers, checkSession } = require("../lib/auth-sheet");

const { getSession, destroySession } = require("../lib/session-store");

const { silentUninstall } = require("../lib/uninstall");

const { isOnline } = require("../lib/network");



const PORT = 3847;

const POLL_MS = 5 * 60 * 1000;

let mainWindow = null;

let pollTimer = null;

let currentSessionId = null;



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

  return new Promise((resolve) => {

    const expressApp = createApp();

    const server = expressApp.listen(PORT, () => resolve(server));

  });

}



function createWindow() {

  mainWindow = new BrowserWindow({

    width: 1400,

    height: 900,

    minWidth: 1024,

    minHeight: 700,

    title: "Hangup HR",
    icon: path.join(__dirname, "..", "Asset", "HRTeam.png"),
    autoHideMenuBar: true,

    webPreferences: {

      preload: path.join(__dirname, "preload.js"),

      contextIsolation: true,

      nodeIntegration: false,

    },

  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

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

    const check = checkSession(session.username, session.password, users);

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

          title: "Hangup HR",

          message: check.message || "Contact Admin.",

          buttons: ["OK"],

        });

        mainWindow.loadURL(`http://localhost:${PORT}/login`);

      }

    }

  } catch {

    /* network blip — next poll */

  }

}



configurePortablePaths();

loadEnvironment();



app.whenReady().then(async () => {

  try {

    ensureCacheDirectory(path.join(app.getPath("userData"), "hr-cache"));

  } catch (err) {

    dialog.showErrorBox(

      "Hangup HR — Storage error",

      `Could not create local cache folder:\n${err.message}`

    );

  }



  await startServer();

  createWindow();



  ipcMain.handle("set-session", (_, sessionId) => {

    currentSessionId = sessionId;

  });



  ipcMain.handle("clear-session", () => {

    currentSessionId = null;

  });



  ipcMain.handle("trigger-uninstall", async () => {

    await handleTerminated();

  });



  pollTimer = setInterval(pollSession, POLL_MS);



  app.on("activate", () => {

    if (BrowserWindow.getAllWindows().length === 0) createWindow();

  });

});



app.on("window-all-closed", () => {

  if (pollTimer) clearInterval(pollTimer);

  if (process.platform !== "darwin") app.quit();

});

