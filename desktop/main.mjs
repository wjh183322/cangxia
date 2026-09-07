import { app, BrowserWindow, ipcMain, dialog, Notification, session, net } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWorkFolder, readIndex, writeIndex } from "./lib/layout.mjs";
import { collectAwemes, mapAweme, mapFolder } from "./lib/aweme.mjs";
import { notifyWechat } from "./lib/push.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PARTITION = "persist:cangxia-douyin";

let mainWindow = null;
let douyinWindow = null;
let account = null;
const captured = new Map();
let folders = [{ id: "default", name: "收藏", isDefault: true }];
let settings = { rootPath: "", pushplusToken: "", wxpusherSpt: "", maxPerRefresh: 300 };
let refreshStop = false;
let refreshPaused = false;

function send(channel, payload) {
  mainWindow?.webContents.send(channel, payload);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0c0c0d",
    title: "藏匣",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const url = process.env.CANGXIA_URL || "http://127.0.0.1:8080/";
  void mainWindow.loadURL(url);
}

function douyinSession() {
  return session.fromPartition(PARTITION);
}

function isLoggedInCookies(cookies) {
  return cookies.some((c) => ["sessionid", "sid_guard", "sessionid_ss"].includes(c.name) && c.value);
}

function looksLikeCaptcha(url) {
  return /captcha|verify|sec_sdk|slide/i.test(url);
}

async function attachNetwork(win) {
  const wc = win.webContents;
  try {
    wc.debugger.attach("1.3");
  } catch {
    return;
  }
  await wc.debugger.sendCommand("Network.enable");
  wc.debugger.on("message", async (_e, method, params) => {
    if (method === "Network.responseReceived") {
      const url = params.response?.url || "";
      if (looksLikeCaptcha(url)) {
        refreshPaused = true;
        send("cangxia:captcha", { reason: "page" });
        return;
      }
      if (!/aweme|collect/i.test(url) || params.response.mimeType?.includes("html")) return;
      try {
        const body = await wc.debugger.sendCommand("Network.getResponseBody", {
          requestId: params.requestId,
        });
        const json = JSON.parse(body.body);
        ingestPayload(url, json);
      } catch {
        /* ignore non-json */
      }
    }
  });
}

function ingestPayload(url, json) {
  if (/collects\/list|collection\/list/i.test(url)) {
    const data = json.data || json;
    const list = data.collects_list || data.list || [];
    if (Array.isArray(list) && list.length) {
      folders = list.map((raw, i) => mapFolder(raw, i));
      if (!folders.some((f) => f.isDefault)) {
        folders = [{ id: "default", name: "收藏", isDefault: true }, ...folders];
      }
    }
  }
  const awemes = collectAwemes(json);
  for (const aweme of awemes) {
    const folder = folders.find((f) => f.id === String(aweme.collects_id || "")) || folders[0];
    const work = mapAweme(aweme, folder);
    if (!work.id) continue;
    const prev = captured.get(work.id);
    if (prev && prev.folderId !== work.folderId) {
      work.alsoInFolderIds = [...new Set([...(prev.alsoInFolderIds || []), prev.folderId])];
      work.folderId = prev.folderId;
    }
    captured.set(work.id, work);
  }
  send("cangxia:sync-count", { works: captured.size, folders: folders.length });
}

async function snapshotWorks() {
  const works = [...captured.values()].sort((a, b) => b.collectedAt - a.collectedAt);
  if (settings.rootPath) {
    const index = await readIndex(settings.rootPath);
    const downloaded = new Set((index.records || []).map((r) => r.id));
    for (const w of works) {
      if (downloaded.has(w.id)) w.status = "downloaded";
    }
  }
  return { folders, works };
}

async function completeRefresh() {
  const snap = await snapshotWorks();
  send("cangxia:refresh-done", snap);
  send("cangxia:progress", { active: false, current: 0, total: 0, message: "" });
}

async function runRefreshLoop(win, max) {
  await sleep(1800);
  let last = 0;
  let idle = 0;
  while (win && !win.isDestroyed() && !refreshStop) {
    while (refreshPaused && !refreshStop) await sleep(400);
    if (refreshStop || !win || win.isDestroyed()) break;
    const n = captured.size;
    send("cangxia:progress", {
      active: true,
      current: Math.min(n, max),
      total: max,
      message: `正在读取收藏 ${n}/${max}`,
    });
    if (n >= max) break;
    try {
      await win.webContents.executeJavaScript(
        "window.scrollTo(0, document.documentElement.scrollHeight)",
      );
    } catch {
      break;
    }
    await sleep(1200);
    if (captured.size === last) idle += 1;
    else idle = 0;
    last = captured.size;
    if (idle >= 4) break;
  }
  await completeRefresh();
}

function openDouyinWindow(path = "https://www.douyin.com/") {
  if (douyinWindow && !douyinWindow.isDestroyed()) {
    douyinWindow.focus();
    void douyinWindow.loadURL(path);
    return douyinWindow;
  }
  douyinWindow = new BrowserWindow({
    width: 980,
    height: 760,
    title: "抖音登录 / 收藏",
    parent: mainWindow || undefined,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void attachNetwork(douyinWindow);
  void douyinWindow.loadURL(path);
  douyinWindow.on("closed", () => {
    douyinWindow = null;
  });
  return douyinWindow;
}

ipcMain.handle("cangxia:login", async () => {
  const win = openDouyinWindow("https://www.douyin.com/");
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const cookies = await douyinSession().cookies.get({ domain: ".douyin.com" });
    if (isLoggedInCookies(cookies)) {
      account = { nickname: "已登录", douyinId: "" };
      try {
        const names = cookies.find((c) => c.name === "sessionid");
        if (names) account.douyinId = names.value.slice(0, 6);
      } catch {
        /* ignore */
      }
      return { ok: true, account };
    }
    if (win.isDestroyed()) return { ok: false, error: "登录窗口已关闭" };
    await sleep(800);
  }
  return { ok: false, error: "登录超时" };
});

ipcMain.handle("cangxia:logout", async () => {
  await douyinSession().clearStorageData();
  account = null;
  captured.clear();
  return { ok: true };
});

ipcMain.handle("cangxia:account", async () => account);

ipcMain.handle("cangxia:pick-root", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "选择下载根目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false };
  settings.rootPath = res.filePaths[0];
  return { ok: true, path: settings.rootPath };
});

ipcMain.handle("cangxia:set-settings", async (_e, next) => {
  settings = { ...settings, ...next };
  return { ok: true };
});

ipcMain.handle("cangxia:refresh", async () => {
  captured.clear();
  refreshStop = false;
  refreshPaused = false;
  const max = Number(settings.maxPerRefresh) || 300;
  const win = openDouyinWindow("https://www.douyin.com/user/self?showTab=favorite");
  send("cangxia:progress", {
    active: true,
    current: 0,
    total: max,
    message: `正在读取收藏，最多 ${max} 条`,
  });
  void runRefreshLoop(win, max);
  return { ok: true, waiting: true };
});

ipcMain.handle("cangxia:stop-refresh", async () => {
  refreshStop = true;
  refreshPaused = false;
  return { ok: true };
});

ipcMain.handle("cangxia:resume-refresh", async () => {
  refreshPaused = false;
  return { ok: true };
});

ipcMain.handle("cangxia:finish-refresh", async () => snapshotWorks());

ipcMain.handle("cangxia:download", async (_e, payload) => {
  const { works, folderNames } = payload;
  const rootPath = settings.rootPath;
  if (!rootPath) return { ok: false, error: "未选择下载根目录" };
  const index = await readIndex(rootPath);
  const records = [...(index.records || [])];
  const queue = works.filter((w) => {
    const rec = records.find((r) => r.id === w.id);
    if (w.status === "stale") return false;
    if (!rec) return true;
    if (w.kind === "video" || w.kind === "mixed") {
      return rec.videoStatus !== "saved" || rec.status !== "downloaded";
    }
    return rec.status !== "downloaded";
  });
  for (let i = 0; i < queue.length; i++) {
    const work = queue[i];
    send("cangxia:progress", {
      active: true,
      current: i + 1,
      total: queue.length,
      message:
        work.kind === "video" || work.kind === "mixed"
          ? `正在保存图片和原视频 ${work.title}`
          : `正在保存 ${work.title}`,
    });
    const folderName = folderNames[work.folderId] || "收藏";
    const imageFiles = [];
    for (const img of work.images || []) {
      try {
        const bytes = await fetchBytes(img.url);
        imageFiles.push({ name: `${img.id}.jpg`, bytes });
      } catch {
        /* skip missing file */
      }
    }
    const videoFiles = [];
    const clips = work.videos?.length ? work.videos : work.videoUrl ? [{ url: work.videoUrl }] : [];
    for (const clip of clips) {
      try {
        videoFiles.push({ bytes: await fetchBytes(clip.url) });
      } catch {
        /* skip missing clip */
      }
    }
    if (imageFiles.length === 0 && videoFiles.length === 0) {
      send("cangxia:work-status", { id: work.id, status: "no-origin" });
      continue;
    }
    const saved = await ensureWorkFolder({
      rootPath,
      folderName,
      work: {
        ...work,
        status: imageFiles.length ? "downloaded" : "no-origin",
      },
      imageFiles,
      videoFiles,
    });
    const status = imageFiles.length ? "downloaded" : "no-origin";
    const videoStatus = clips.length ? saved.videoStatus : "none";
    const rec = { id: work.id, dir: saved.dir, status, videoStatus, at: new Date().toISOString() };
    const idx = records.findIndex((r) => r.id === work.id);
    if (idx >= 0) records[idx] = rec;
    else records.push(rec);
    await writeIndex(rootPath, records);
    send("cangxia:work-status", { id: work.id, status, videoStatus });
  }
  send("cangxia:progress", { active: false, current: 0, total: 0, message: "" });
  return { ok: true };
});

ipcMain.handle("cangxia:notify-captcha", async () => {
  if (Notification.isSupported()) {
    new Notification({ title: "藏匣", body: "抖音弹出了验证码，请回电脑完成滑块。" }).show();
  }
  await notifyWechat({
    title: "藏匣：需要验证码",
    content: "请回到电脑，在已打开的抖音窗口完成滑块后继续。",
    pushplusToken: settings.pushplusToken,
    wxpusherSpt: settings.wxpusherSpt,
  });
  return { ok: true };
});

async function fetchBytes(url) {
  const res = await net.fetch(url, {
    session: douyinSession(),
    headers: { Referer: "https://www.douyin.com/" },
  });
  if (!res.ok) throw new Error(String(res.status));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) throw new Error("empty");
  return buf;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
