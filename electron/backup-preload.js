const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hrBackup", {
  setSession: (id) => ipcRenderer.invoke("set-session", id),
  clearSession: () => ipcRenderer.invoke("clear-session"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  openPath: (p) => ipcRenderer.invoke("open-path", p),
  isDesktop: true,
});
