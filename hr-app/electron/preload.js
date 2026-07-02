const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hrDesktop", {
  setSession: (id) => ipcRenderer.invoke("set-session", id),
  clearSession: () => ipcRenderer.invoke("clear-session"),
  triggerUninstall: () => ipcRenderer.invoke("trigger-uninstall"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  writeFileBuffer: (filePath, arrayBuffer) => ipcRenderer.invoke("write-file-buffer", filePath, arrayBuffer),
  isDesktop: true,
});
