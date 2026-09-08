const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cangxiaQr", {
  onCode: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on("cangxia:qr-code", fn);
  },
  onStatus: (cb) => {
    const fn = (_e, text) => cb(text);
    ipcRenderer.on("cangxia:qr-status", fn);
  },
});
