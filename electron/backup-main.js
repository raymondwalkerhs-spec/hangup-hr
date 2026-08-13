const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { loadEnvironment, ensureCacheDirectory, assertSupabaseConfigured } = require("../lib/app-bootstrap");
const { createBackupApp } = require("../backup-app");

const PORT = 3848;
const HOST = "127.0.0.1";
let mainWindow = null;
let httpServer = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const expressApp = createBackupApp();
    const server = expressApp.listen(PORT, HOST);
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    title: "Hangup Backup",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "backup-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.loadURL(`http://${HOST}:${PORT}/login`);
}

if (app.requestSingleInstanceLock({ role: "hangup-backup" })) {
  loadEnvironment();
  app.whenReady().then(async () => {
    assertSupabaseConfigured();
    ensureCacheDirectory(path.join(app.getPath("userData"), "hr-cache"));
    httpServer = await startServer();
    createWindow();
    ipcMain.handle("pick-folder", async () => {
      const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
      return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle("set-session", () => {});
    ipcMain.handle("clear-session", () => {});
    ipcMain.handle("open-path", (_, p) => { if (p && fs.existsSync(p)) shell.openPath(p); });
  });
}

app.on("window-all-closed", () => {
  if (httpServer) httpServer.close();
  app.quit();
});
