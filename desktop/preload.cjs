const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cangxia", {
  available: true,
  login: () => ipcRenderer.invoke("cangxia:login"),
  logout: () => ipcRenderer.invoke("cangxia:logout"),
  account: () => ipcRenderer.invoke("cangxia:account"),
  pickRoot: () => ipcRenderer.invoke("cangxia:pick-root"),
  setSettings: (s) => ipcRenderer.invoke("cangxia:set-settings", s),
  refresh: () => ipcRenderer.invoke("cangxia:refresh"),
  stopRefresh: () => ipcRenderer.invoke("cangxia:stop-refresh"),
  resumeRefresh: () => ipcRenderer.invoke("cangxia:resume-refresh"),
  download: (payload) => ipcRenderer.invoke("cangxia:download", payload),
  notifyCaptcha: () => ipcRenderer.invoke("cangxia:notify-captcha"),
  onProgress: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on("cangxia:progress", fn);
    return () => ipcRenderer.removeListener("cangxia:progress", fn);
  },
  onCaptcha: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on("cangxia:captcha", fn);
    return () => ipcRenderer.removeListener("cangxia:captcha", fn);
  },
  onWorkStatus: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on("cangxia:work-status", fn);
    return () => ipcRenderer.removeListener("cangxia:work-status", fn);
  },
  onSyncCount: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on("cangxia:sync-count", fn);
    return () => ipcRenderer.removeListener("cangxia:sync-count", fn);
  },
  onRefreshDone: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on("cangxia:refresh-done", fn);
    return () => ipcRenderer.removeListener("cangxia:refresh-done", fn);
  },
});
