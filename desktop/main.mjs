import { app, BrowserWindow, ipcMain, dialog, Notification, session, net, shell, Menu, protocol } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readIndex, deleteWorkFolders, workDir } from "./lib/layout.mjs";
import { collectAwemes, mapAweme, mapFolder } from "./lib/aweme.mjs";
import { notifyWechat } from "./lib/push.mjs";
import { abortDownload, runWork } from "./lib/engine.mjs";
import { looksLikeCaptcha } from "./lib/captcha.mjs";
import { APP_SCHEMES, CHROME_UA, EXTRACT_QR_SCRIPT, LOGIN_PAGE_SCRIPT, OPEN_FAVORITE_SCRIPT, SCROLL_FEED_SCRIPT, isHttpUrl } from "./lib/login-page.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PARTITION = "persist:cangxia-douyin";

protocol.registerSchemesAsPrivileged(
  APP_SCHEMES.map((scheme) => ({
    scheme,
    privileges: { standard: true, supportFetchAPI: true, bypassCSP: true },
  })),
);

let mainWindow = null;
let douyinWindow = null;
let qrWindow = null;
let account = null;
const captured = new Map();
let folders = [{ id: "default", name: "收藏", isDefault: true }];
let settings = { rootPath: "", pushplusToken: "", wxpusherSpt: "", maxPerRefresh: 300 };
let refreshStop = false;
let refreshPaused = false;
let loginWaiting = false;
let captchaLock = false;
let lastCaptchaNotify = 0;

function send(channel, payload) {
  mainWindow?.webContents.send(channel, payload);
}

function uiIndex() {
  return join(__dirname, "ui", "index.html");
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0c0c0d",
    title: "藏匣",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const fromEnv = process.env.CANGXIA_URL;
  if (fromEnv) {
    void mainWindow.loadURL(fromEnv);
    return;
  }
  const index = uiIndex();
  void mainWindow.loadFile(index).catch(() => {
    dialog.showErrorBox("藏匣", "界面文件缺失。请先在项目根目录执行 npm run build:desktop。");
  });
}

function douyinSession() {
  return session.fromPartition(PARTITION);
}

function blockAppSchemes(ses) {
  for (const scheme of APP_SCHEMES) {
    try {
      ses.protocol.handle(scheme, () => new Response("", { status: 204 }));
    } catch {
      /* already registered */
    }
  }
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === "openExternal") {
      callback(false);
      return;
    }
    callback(true);
  });
}

function hardenContents(contents) {
  contents.setUserAgent(CHROME_UA);
  contents.setWindowOpenHandler(({ url }) => (isHttpUrl(url) ? { action: "allow" } : { action: "deny" }));
  contents.on("will-navigate", (e, url) => {
    if (!isHttpUrl(url)) e.preventDefault();
  });
  contents.on("will-redirect", (e, url) => {
    if (!isHttpUrl(url)) e.preventDefault();
  });
  contents.on("will-frame-navigate", (e) => {
    if (e.url && !isHttpUrl(e.url)) e.preventDefault();
  });
}

function isLoggedInCookies(cookies) {
  return cookies.some((c) => ["sessionid", "sid_guard", "sessionid_ss"].includes(c.name) && c.value);
}

function emitCaptcha(reason) {
  if (captchaLock) return;
  captchaLock = true;
  refreshPaused = true;
  send("cangxia:captcha", { reason: reason || "page" });
}

function clearCaptchaLock() {
  captchaLock = false;
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
        emitCaptcha("page");
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
  await sleep(800);
  let last = 0;
  let idle = 0;
  let favTries = 0;
  while (win && !win.isDestroyed() && !refreshStop) {
    while (refreshPaused && !refreshStop) await sleep(400);
    if (refreshStop || !win || win.isDestroyed()) break;
    const n = captured.size;
    send("cangxia:progress", {
      active: true,
      current: Math.min(n, max),
      total: max,
      message: n === 0 ? "正在打开「收藏」页…" : `正在读取收藏 ${n}/${max}`,
    });
    if (n >= max) break;
    try {
      const tab = await win.webContents.executeJavaScript(OPEN_FAVORITE_SCRIPT);
      if (n === 0 && tab !== "already") {
        favTries += 1;
        if (favTries <= 12) {
          await sleep(1100);
          continue;
        }
      }
      await win.webContents.executeJavaScript(SCROLL_FEED_SCRIPT);
    } catch {
      break;
    }
    await sleep(1400);
    if (captured.size === last) idle += 1;
    else idle = 0;
    last = captured.size;
    if (last > 0 && idle >= 5) break;
    if (last === 0 && idle >= 10) break;
  }
  await completeRefresh();
}

function openDouyinWindow(path = "https://www.douyin.com/", { assistQr = false } = {}) {
  if (douyinWindow && !douyinWindow.isDestroyed()) {
    if (assistQr) douyinWindow.hide();
    else {
      douyinWindow.show();
      douyinWindow.focus();
    }
    void douyinWindow.loadURL(path, { userAgent: CHROME_UA });
    return douyinWindow;
  }
  douyinWindow = new BrowserWindow({
    width: 980,
    height: 760,
    title: assistQr ? "抖音登录" : "抖音收藏",
    parent: assistQr ? undefined : mainWindow || undefined,
    show: !assistQr,
    skipTaskbar: assistQr,
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  hardenContents(douyinWindow.webContents);
  void attachNetwork(douyinWindow);
  douyinWindow.webContents.on("dom-ready", () => {
    if (loginWaiting || assistQr) {
      void douyinWindow.webContents.executeJavaScript(LOGIN_PAGE_SCRIPT).catch(() => {});
    }
  });
  douyinWindow.webContents.on("did-finish-load", () => {
    const url = douyinWindow.webContents.getURL();
    if (!loginWaiting && /user\/self|showTab=favorite/.test(url)) {
      void douyinWindow.webContents.executeJavaScript(OPEN_FAVORITE_SCRIPT).catch(() => {});
    }
  });
  void douyinWindow.loadURL(path, { userAgent: CHROME_UA });
  douyinWindow.on("closed", () => {
    douyinWindow = null;
    if (loginWaiting) loginWaiting = false;
  });
  return douyinWindow;
}

function openQrWindow() {
  if (qrWindow && !qrWindow.isDestroyed()) {
    qrWindow.focus();
    return qrWindow;
  }
  qrWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    title: "扫码登录",
    parent: mainWindow || undefined,
    autoHideMenuBar: true,
    backgroundColor: "#0c0c0d",
    webPreferences: {
      preload: join(__dirname, "qr-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  qrWindow.setMenuBarVisibility(false);
  void qrWindow.loadFile(join(__dirname, "qr.html"));
  qrWindow.on("closed", () => {
    qrWindow = null;
    if (loginWaiting) {
      loginWaiting = false;
      if (douyinWindow && !douyinWindow.isDestroyed()) douyinWindow.close();
    }
  });
  return qrWindow;
}

function closeQrWindow() {
  if (qrWindow && !qrWindow.isDestroyed()) qrWindow.close();
  qrWindow = null;
}

function hideLoginBrowser() {
  if (douyinWindow && !douyinWindow.isDestroyed()) douyinWindow.close();
}

async function pumpQr(win) {
  let last = "";
  let tries = 0;
  while (loginWaiting && win && !win.isDestroyed()) {
    tries += 1;
    try {
      const data = await win.webContents.executeJavaScript(EXTRACT_QR_SCRIPT);
      if (data && data !== last && qrWindow && !qrWindow.isDestroyed()) {
        last = data;
        qrWindow.webContents.send("cangxia:qr-code", data);
      }
    } catch {
      /* page not ready */
    }
    if (tries === 8 && !last && qrWindow && !qrWindow.isDestroyed()) {
      qrWindow.webContents.send("cangxia:qr-status", "正在打开抖音登录页，请稍候…");
    }
    if (tries === 25 && !last && qrWindow && !qrWindow.isDestroyed()) {
      qrWindow.webContents.send("cangxia:qr-status", "还没拿到码。请确认网络能打开抖音，或关掉后重试。");
    }
    await sleep(700);
  }
}

function finishLoginAccount(cookies) {
  loginWaiting = false;
  clearCaptchaLock();
  closeQrWindow();
  hideLoginBrowser();
  account = { nickname: "已登录", douyinId: "" };
  const names = cookies.find((c) => c.name === "sessionid");
  if (names) account.douyinId = names.value.slice(0, 6);
  return { ok: true, account };
}

ipcMain.handle("cangxia:login", async () => {
  loginWaiting = true;
  const win = openDouyinWindow("https://www.douyin.com/", { assistQr: true });
  openQrWindow();
  void pumpQr(win);
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const cookies = await douyinSession().cookies.get({ domain: ".douyin.com" });
    if (isLoggedInCookies(cookies)) return finishLoginAccount(cookies);
    if (!loginWaiting) return { ok: false, error: "已取消登录" };
    if (win.isDestroyed()) {
      loginWaiting = false;
      closeQrWindow();
      return { ok: false, error: "登录窗口已关闭" };
    }
    await sleep(800);
  }
  loginWaiting = false;
  closeQrWindow();
  hideLoginBrowser();
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
  clearCaptchaLock();
  return { ok: true };
});

ipcMain.handle("cangxia:resume-refresh", async () => {
  refreshPaused = false;
  clearCaptchaLock();
  return { ok: true };
});

ipcMain.handle("cangxia:finish-refresh", async () => snapshotWorks());

ipcMain.handle("cangxia:download", async (_e, payload) => {
  const { works, folderNames } = payload;
  const rootPath = settings.rootPath;
  if (!rootPath) return { ok: false, error: "未选择下载根目录" };
  for (const work of works || []) {
    const files = [
      ...(work.images || []).map((img, i) => ({
        key: img.id || `img-${i}`,
        name: `图${i + 1}.jpg`,
        type: "image",
        url: img.url,
        status: "waiting",
      })),
      ...((work.videos?.length ? work.videos : work.videoUrl ? [{ id: `${work.id}_v`, url: work.videoUrl }] : []) || []).map(
        (clip, i) => ({
          key: clip.id || `vid-${i}`,
          name: `视频${i + 1}.mp4`,
          type: "video",
          url: clip.url,
          status: "waiting",
        }),
      ),
    ];
    const res = await runWork({
      work,
      folderName: folderNames?.[work.folderId] || "收藏",
      files,
      rootPath,
      session: douyinSession(),
      send,
    });
    if (res?.aborted) return res;
  }
  send("cangxia:progress", { active: false, current: 0, total: 0, message: "" });
  return { ok: true };
});

ipcMain.handle("cangxia:dl-run", async (_e, payload) => {
  const rootPath = settings.rootPath;
  if (!rootPath) return { ok: false, error: "未选择下载根目录" };
  return runWork({
    work: payload.work,
    folderName: payload.folderName || "收藏",
    files: payload.files || [],
    rootPath,
    session: douyinSession(),
    send,
  });
});

ipcMain.handle("cangxia:dl-abort", async (_e, reason) => {
  abortDownload(reason);
  return { ok: true };
});

ipcMain.handle("cangxia:open-work-folder", async (_e, item) => {
  const rootPath = settings.rootPath;
  if (!rootPath) return { ok: false };
  const index = await readIndex(rootPath);
  const rec = (index.records || []).find((r) => r.id === item?.id);
  const dir = rec?.dir || workDir(rootPath, item?.folderName || "收藏", item?.title, item?.id);
  await shell.openPath(dir);
  return { ok: true };
});

ipcMain.handle("cangxia:delete-works", async (_e, payload) => {
  const rootPath = settings.rootPath;
  if (!rootPath) return { ok: false, error: "未选择下载根目录" };
  const items = payload?.works || [];
  if (!items.length) return { ok: true, deleted: [] };
  await deleteWorkFolders(rootPath, items);
  return { ok: true };
});

ipcMain.handle("cangxia:captcha-ack", async () => {
  clearCaptchaLock();
  return { ok: true };
});

ipcMain.handle("cangxia:notify-captcha", async () => {
  const now = Date.now();
  if (now - lastCaptchaNotify < 120000) return { ok: true, skipped: true };
  lastCaptchaNotify = now;
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
  Menu.setApplicationMenu(null);
  blockAppSchemes(session.defaultSession);
  blockAppSchemes(douyinSession());
  app.on("web-contents-created", (_e, contents) => hardenContents(contents));
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
