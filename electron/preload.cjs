// Мост между интерфейсом и Electron: только эти функции видны странице (window.jsmDesktop).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jsmDesktop", {
  platform: process.platform,

  notify: (title, body, roomId) => ipcRenderer.invoke("notify", { title, body, roomId }),
  onNotificationClick: (cb) => {
    const h = (_e, roomId) => cb(roomId);
    ipcRenderer.on("notification-click", h);
    return () => ipcRenderer.off("notification-click", h);
  },
  attention: () => ipcRenderer.send("attention"),
  showWindow: () => ipcRenderer.send("show-window"),
  setLang: (lang) => ipcRenderer.send("lang", lang),
  setBadge: (count, image) => ipcRenderer.send("badge", count, image),
  onPickSource: (cb) => {
    const h = async (_e, id, sources) => ipcRenderer.send("pick-source-result", id, await cb(sources));
    ipcRenderer.on("pick-source", h);
    return () => ipcRenderer.off("pick-source", h);
  },

  saveDownload: (name, data) => ipcRenderer.invoke("save-download", { name, data }),
  saveAs: (name, data) => ipcRenderer.invoke("save-as", { name, data }),
  openPath: (file) => ipcRenderer.invoke("open-path", file),
  showItem: (file) => ipcRenderer.invoke("show-item", file),
  fileExists: (file) => ipcRenderer.invoke("file-exists", file),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  autostartGet: () => ipcRenderer.invoke("autostart-get"),
  autostartSet: (on) => ipcRenderer.invoke("autostart-set", on),

  updaterEnabled: () => ipcRenderer.invoke("update-enabled"),
  updateCheck: () => ipcRenderer.invoke("update-check"),
  updateDownload: async (onProgress) => {
    const h = (_e, percent) => onProgress(percent);
    ipcRenderer.on("update-progress", h);
    try {
      await ipcRenderer.invoke("update-download");
    } finally {
      ipcRenderer.off("update-progress", h);
    }
  },
  updateInstall: () => ipcRenderer.send("update-install"),

  quit: () => ipcRenderer.send("quit"),
});
