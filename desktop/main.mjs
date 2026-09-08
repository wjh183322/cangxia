import { app, BrowserWindow, ipcMain, dialog, Notification, session, net, shell, Menu, protocol } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readIndex, deleteWorkFolders, workDir } from "./lib/layout.mjs";
import { collectAwemes, isCollectFeedUrl, mapAweme, mapFolder } from "./lib/aweme.mjs";
import { notifyWechat } from "./lib/push.mjs";
import { abortDownload, runWork } from "./lib/engine.mjs";
import { looksLikeCaptcha } from "./lib/captcha.mjs";
import { APP_SCHEMES, CHROME_UA, EXTRACT_QR_SCRIPT, LOGIN_PAGE_SCRIPT, OPEN_FAVORITE_SCRIPT, SCROLL_FEED_SCRIPT, LIST_SIDE_FOLDERS_SCRIPT, clickSideFolderScript, INSTALL_FOLDER_WATCH_SCRIPT, isHttpUrl } from "./lib/login-page.mjs";

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
let progressWindow = null;
let account = null;
const captured = new Map();
let folders = [{ id: "default", name: "收藏", isDefault: true }];
let settings = { rootPath: "", pushplusToken: "", wxpusherSpt: "", maxPerRefresh: 300 };
let refreshStop = false;
let refreshPaused = false;
let refreshReading = false;
let readingFolderName = "";
let readChoiceResolve = null;
let loginWaiting = false;
let captchaLock = false;
let lastCaptchaNotify = 0;

let lastProgressPayload = null;

function send(channel, payload) {
  mainWindow?.webContents.send(channel, payload);
  if (channel === "cangxia:progress") {
    lastProgressPayload = payload;
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.webContents.send("cangxia:progress", payload);
    }
  }
}

function placeProgressWindow() {
  if (!progressWindow || progressWindow.isDestroyed() || !douyinWindow || douyinWindow.isDestroyed()) return;
  const bounds = douyinWindow.getBounds();
  const width = 520;
  const height = 88;
  progressWindow.setBounds({
    x: bounds.x + Math.round((bounds.width - width) / 2),
    y: bounds.y + 16,
    width,
    height,
  });
}

function openProgressWindow() {
  if (progressWindow && !progressWindow.isDestroyed()) {
    placeProgressWindow();
    progressWindow.show();
    return;
  }
  progressWindow = new BrowserWindow({
    width: 520,
    height: 88,
    resizable: false,
    frame: false,
    title: "读取进度",
    parent: douyinWindow || mainWindow || undefined,
    modal: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#161618",
    webPreferences: {
      preload: join(__dirname, "read-progress-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  progressWindow.setMenuBarVisibility(false);
  progressWindow.webContents.on("did-finish-load", () => {
    if (lastProgressPayload) progressWindow?.webContents.send("cangxia:progress", lastProgressPayload);
  });
  void progressWindow.loadFile(join(__dirname, "read-progress.html"));
  placeProgressWindow();
  if (douyinWindow && !douyinWindow.isDestroyed()) {
    douyinWindow.on("move", placeProgressWindow);
    douyinWindow.on("resize", placeProgressWindow);
  }
  progressWindow.on("closed", () => {
    progressWindow = null;
  });
}

function closeProgressWindow() {
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.close();
  progressWindow = null;
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
    /* already attached */
  }
  try {
    await wc.debugger.sendCommand("Network.enable");
  } catch {
    return;
  }
  const pending = new Map();
  wc.debugger.removeAllListeners("message");
  wc.debugger.on("message", async (_e, method, params) => {
    if (method === "Network.responseReceived") {
      const url = params.response?.url || "";
      if (looksLikeCaptcha(url)) {
        emitCaptcha("page");
        return;
      }
      const mime = String(params.response?.mimeType || "");
      if (mime.includes("html") || mime.includes("image") || mime.includes("video") || mime.includes("font")) return;
      if (!/aweme|collect|favorite|sns/i.test(url)) return;
      pending.set(params.requestId, url);
      return;
    }
    if (method === "Network.loadingFailed") {
      pending.delete(params.requestId);
      return;
    }
    if (method !== "Network.loadingFinished") return;
    const url = pending.get(params.requestId);
    pending.delete(params.requestId);
    if (!url) return;
    try {
      const body = await wc.debugger.sendCommand("Network.getResponseBody", { requestId: params.requestId });
      const raw = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body;
      const text = String(raw || "").trim();
      if (!text.startsWith("{") && !text.startsWith("[")) return;
      ingestPayload(url, JSON.parse(text));
    } catch {
      /* ignore non-json */
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
  if (!refreshReading) return;
  if (!isCollectFeedUrl(url)) return;
  const awemes = collectAwemes(json);
  for (const aweme of awemes) {
    const folder = folders.find((f) => f.id === String(aweme.collects_id || "")) || folders[0];
    const work = mapAweme(aweme, folder);
    if (!work.id) continue;
    const prev = captured.get(work.id);
    if (prev) {
      work.listIndex = prev.listIndex;
      work.allIndex = prev.allIndex;
      if (readingFolderName === "收藏") work.allIndex = prev.allIndex ?? captured.size;
      if (prev.folderId !== work.folderId) {
        work.alsoInFolderIds = [...new Set([...(prev.alsoInFolderIds || []), prev.folderId])];
        work.folderId = prev.folderId;
      }
    } else {
      work.listIndex = captured.size;
      if (readingFolderName === "收藏") work.allIndex = captured.size;
    }
    captured.set(work.id, work);
  }
  send("cangxia:sync-count", { works: captured.size, folders: folders.length });
}

async function snapshotWorks() {
  const works = [...captured.values()].sort((a, b) => (a.listIndex ?? 0) - (b.listIndex ?? 0));
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
  refreshReading = false;
  readingFolderName = "";
  closeProgressWindow();
  const snap = await snapshotWorks();
  send("cangxia:refresh-done", snap);
  send("cangxia:progress", { active: false, current: 0, total: 0, message: "" });
}

function countInFolder(folderId) {
  let n = 0;
  for (const w of captured.values()) {
    if (w.folderId === folderId || (w.alsoInFolderIds || []).includes(folderId)) n += 1;
  }
  return n;
}

function countProgress(folderId, folderName, started) {
  if (folderName === "收藏") return Math.max(0, captured.size - started);
  if (folderId) return Math.max(0, countInFolder(folderId) - started);
  return Math.max(0, captured.size - started);
}

async function waitForNewItems(prevCount, timeoutMs, folderName, folderId, started, max) {
  const t0 = Date.now();
  let last = captured.size;
  let lastChange = Date.now();
  while (Date.now() - t0 < timeoutMs && !refreshStop) {
    const got = countProgress(folderId, folderName, started);
    send("cangxia:progress", {
      active: true,
      current: Math.min(got, max),
      total: max,
      message: `正在识别「${folderName}」 ${got}/${max}，认完这一排再翻`,
    });
    if (got >= max) return true;
    await sleep(200);
    if (captured.size !== last) {
      last = captured.size;
      lastChange = Date.now();
    }
    if (captured.size > prevCount && Date.now() - lastChange > 1100) return true;
  }
  return captured.size > prevCount;
}

async function scrollUntilCap(win, { folderId, folderName, max, started }) {
  try {
    if (folderName && folderName !== "收藏") {
      await win.webContents.executeJavaScript(clickSideFolderScript(folderName));
    } else {
      await win.webContents.executeJavaScript(OPEN_FAVORITE_SCRIPT);
    }
  } catch {
    return;
  }

  await waitForNewItems(captured.size, 6000, folderName, folderId, started, max);
  if (countProgress(folderId, folderName, started) >= max) return;

  let idle = 0;
  while (win && !win.isDestroyed() && !refreshStop) {
    while (refreshPaused && !refreshStop) await sleep(400);
    if (refreshStop || !win || win.isDestroyed()) return;
    const got = countProgress(folderId, folderName, started);
    send("cangxia:progress", {
      active: true,
      current: Math.min(got, max),
      total: max,
      message: `正在读取「${folderName}」 ${got}/${max}`,
    });
    if (got >= max) return;
    const before = captured.size;
    let scrolled = "row";
    try {
      scrolled = await win.webContents.executeJavaScript(SCROLL_FEED_SCRIPT);
    } catch {
      return;
    }
    send("cangxia:progress", {
      active: true,
      current: Math.min(got, max),
      total: max,
      message: `往下翻了一排，等待识别「${folderName}」 ${got}/${max}`,
    });
    const grew = await waitForNewItems(before, 5000, folderName, folderId, started, max);
    if (countProgress(folderId, folderName, started) >= max) return;
    if (grew) idle = 0;
    else idle += 1;
    if (scrolled === "end" && !grew) return;
    if (idle >= 3) return;
  }
}

function closeReadPrompt() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.getTitle() === "开始读取" && !w.isDestroyed()) w.close();
  }
}

function askReadFolder(name) {
  closeReadPrompt();
  return new Promise((resolve) => {
    if (readChoiceResolve) {
      readChoiceResolve(false);
      readChoiceResolve = null;
    }
    const prompt = new BrowserWindow({
      width: 440,
      height: 240,
      resizable: false,
      title: "开始读取",
      parent: douyinWindow || mainWindow || undefined,
      modal: true,
      autoHideMenuBar: true,
      backgroundColor: "#0c0c0d",
      webPreferences: {
        preload: join(__dirname, "read-confirm-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    prompt.setMenuBarVisibility(false);
    let settled = false;
    const finish = (yes) => {
      if (settled) return;
      settled = true;
      readChoiceResolve = null;
      if (!prompt.isDestroyed()) prompt.close();
      resolve(Boolean(yes));
    };
    readChoiceResolve = finish;
    void prompt.loadFile(join(__dirname, "read-confirm.html"), { query: { name: name || "收藏" } });
    prompt.on("closed", () => finish(false));
  });
}

async function watchAndRead(win, max) {
  const denied = new Set();
  send("cangxia:progress", {
    active: true,
    current: 0,
    total: max,
    message: "已打开抖音。请点进「收藏」，或再点左边某个收藏夹",
  });
  while (win && !win.isDestroyed() && !refreshStop) {
    let state = { view: "other", name: "" };
    try {
      state = await win.webContents.executeJavaScript(INSTALL_FOLDER_WATCH_SCRIPT);
    } catch {
      break;
    }
    const key = `${state?.view || "other"}:${state?.name || ""}`;
    if ((state.view === "favorite" || state.view === "folder") && state.name && !denied.has(key)) {
      send("cangxia:progress", {
        active: true,
        current: 0,
        total: max,
        message: `已识别到「${state.name}」，等待你确认是否读取`,
      });
      const yes = await askReadFolder(state.name);
      if (refreshStop || !win || win.isDestroyed()) break;
      if (yes) {
        refreshReading = true;
        readingFolderName = state.name || "收藏";
        const folder = folders.find((f) => f.name === state.name);
        const started = folder ? countInFolder(folder.id) : captured.size;
        await scrollUntilCap(win, {
          folderId: folder?.id || (state.name === "收藏" ? "default" : null),
          folderName: state.name,
          max,
          started,
        });
        await completeRefresh();
        if (win && !win.isDestroyed()) win.close();
        return;
      }
      denied.add(key);
      send("cangxia:progress", {
        active: true,
        current: 0,
        total: max,
        message: "未读取。可点另一个收藏夹，或点停止",
      });
    }
    await sleep(800);
  }
  await completeRefresh();
  if (win && !win.isDestroyed()) win.close();
}

function openDouyinWindow(path = "https://www.douyin.com/", { assistQr = false, forRefresh = false } = {}) {
  const width = forRefresh ? 1320 : assistQr ? 560 : 1100;
  if (douyinWindow && !douyinWindow.isDestroyed()) {
    if (assistQr) douyinWindow.hide();
    else {
      douyinWindow.setSize(width, 820);
      douyinWindow.show();
      douyinWindow.focus();
    }
    void douyinWindow.loadURL(path, { userAgent: CHROME_UA });
    return douyinWindow;
  }
  douyinWindow = new BrowserWindow({
    width,
    height: forRefresh ? 820 : 760,
    title: assistQr ? "抖音登录" : "抖音",
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
    if (!loginWaiting) {
      void douyinWindow.webContents.executeJavaScript(INSTALL_FOLDER_WATCH_SCRIPT).catch(() => {});
    }
  });
  void douyinWindow.loadURL(path, { userAgent: CHROME_UA });
  douyinWindow.on("closed", () => {
    douyinWindow = null;
    if (loginWaiting) loginWaiting = false;
    if (readChoiceResolve) readChoiceResolve(false);
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
  refreshReading = false;
  const max = Number(settings.maxPerRefresh) || 300;
  const win = openDouyinWindow("https://www.douyin.com/user/self", { forRefresh: true });
  openProgressWindow();
  send("cangxia:progress", {
    active: true,
    current: 0,
    total: max,
    message: "已打开抖音（作品页）。请点进「收藏」或某个收藏夹",
  });
  void watchAndRead(win, max);
  return { ok: true, waiting: true };
});

ipcMain.handle("cangxia:stop-refresh", async () => {
  refreshStop = true;
  refreshPaused = false;
  refreshReading = false;
  if (readChoiceResolve) readChoiceResolve(false);
  clearCaptchaLock();
  return { ok: true };
});

ipcMain.handle("cangxia:resume-refresh", async () => {
  refreshPaused = false;
  clearCaptchaLock();
  return { ok: true };
});

ipcMain.handle("cangxia:read-choice", async (_e, yes) => {
  if (readChoiceResolve) readChoiceResolve(Boolean(yes));
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
      ...((work.videos?.length ? work.videos : work.videoUrl ? [{ id: `${work.id}_v`, url: work.videoUrl }] : []) || [])
        .filter((clip) => clip?.url && !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(clip.url))
        .map((clip, i) => ({
          key: clip.id || `vid-${i}`,
          name: `视频${i + 1}.mp4`,
          type: "video",
          url: clip.url,
          status: "waiting",
        })),
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
