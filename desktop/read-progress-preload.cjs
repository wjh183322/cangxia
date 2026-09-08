const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cangxiaProgress", {
  onUpdate: (cb) => {
    const fn = (_e, data) => cb(data || {});
    ipcRenderer.on("cangxia:progress", fn);
  },
  stop: () => ipcRenderer.invoke("cangxia:stop-refresh"),
});
