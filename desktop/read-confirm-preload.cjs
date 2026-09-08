const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cangxiaRead", {
  name: () => new URLSearchParams(window.location.search).get("name") || "收藏",
  choose: (yes) => ipcRenderer.invoke("cangxia:read-choice", Boolean(yes)),
});
