import { app, BrowserWindow, ipcMain, dialog, Notification, session, net, shell, Menu, protocol } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readIndex, deleteWorkFolders, workDir } from "./lib/layout.mjs";
import { collectAwemes, isCollectFeedUrl, isFolderListUrl, mapAweme, mapFolder, unwrapAweme } from "./lib/aweme.mjs";
import { notifyWechat } from "./lib/push.mjs";
import { abortDownload, runWork } from "./lib/engine.mjs";
import { looksLikeCaptcha } from "./lib/captcha.mjs";
import { APP_SCHEMES, CHROME_UA, EXTRACT_QR_SCRIPT, LOGIN_PAGE_SCRIPT, OPEN_FAVORITE_SCRIPT, CLICK_FOLDER_TAB_SCRIPT, clickFolderCardScript, locateFolderCardScript, folderInsideScript, installFolderWatchScript, isHttpUrl, validFolderName, WORK_GRID_POINT_SCRIPT, PAGE_COLLECTS_ID_SCRIPT } from "./lib/login-page.mjs";
import { commonQuery, parseCollectsList, nextCursor, waitBdmsScript, signUrlScript, pageFetchScript, hookedXhrScript } from "./lib/page-api.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PARTITION = "persist:cangxia-douyin";
if (process.platform === "win32") app.setAppUserModelId("com.cangxia.app");

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
let readingMax = 300;
let readingStarted = 0;
let readingFolderId = "default";
let readingPattern = "listcollection";
let readingHasMore = true;
let readingOrder = 0;
let seenThisRead = new Set();
let readingCollectsId = "";
let readingInside = false;
let lastHarvestMethod = "";
let lastHarvestCount = 0;
let feedBuffer = [];
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

function defaultFolder() {
  return folders.find((f) => f.isDefault) || folders[0] || { id: "default", name: "收藏", isDefault: true };
}

function folderIdByName(name) {
  const f = folders.find((x) => x.name === name && !x.isDefault);
  if (!f) return "";
  const id = String(f.id || "");
  if (!id || id.startsWith("folder_")) return "";
  return id;
}

async function waitFolderId(name, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && !refreshStop) {
    const id = folderIdByName(name);
    if (id) return id;
    await sleep(200);
  }
  return folderIdByName(name);
}

function ensureFolder(name, id) {
  if (!name || name === "收藏") return defaultFolder();
  const sid = id ? String(id) : "";
  const hit = folders.find((f) => (sid && f.id === sid) || f.name === name);
  if (hit) {
    if (sid && hit.id !== sid && String(hit.id).startsWith("folder_")) {
      folders = folders.map((f) => (f === hit ? { ...f, id: sid } : f));
      return folders.find((f) => f.name === name);
    }
    return hit;
  }
  const folder = { id: sid || `folder_${name}`, name, isDefault: false };
  folders = [...folders, folder];
  return folder;
}

function ingestPayload(url, json) {
  if (isFolderListUrl(url)) {
    const data = json.data || json;
    const list = data.collects_list || data.list || json.collects_list;
    if (Array.isArray(list)) {
      for (const [i, raw] of list.entries()) {
        const mapped = mapFolder(raw, i);
        if (!mapped.name || mapped.isDefault) continue;
        if (/^(视频|音乐|合集|短剧|收藏夹|话题|特效)$/.test(mapped.name)) continue;
        ensureFolder(mapped.name, mapped.id);
      }
    }
  }
  if (!refreshReading) return;
  const isList = /listcollection/i.test(url);
  const isFolderFeed = /collects\/video\/list|collects\/aweme\/list|collects\/item\/list/i.test(url);
  if (readingPattern === "listcollection" ? !isList : !isFolderFeed) return;
  const root = json.data || json;
  const collectsMatch = String(url).match(/collects_id=(\d+)/);
  const feedId = String(collectsMatch?.[1] || root?.collects_id || "");
  if (isFolderFeed && !readingInside) {
    feedBuffer.push({ url, json, feedId, at: Date.now() });
    if (feedBuffer.length > 24) feedBuffer.shift();
    return;
  }
  if (isFolderFeed) {
    if (readingCollectsId && feedId && feedId !== readingCollectsId) return;
    if (!readingCollectsId && feedId) readingCollectsId = feedId;
  }
  if (root && Object.prototype.hasOwnProperty.call(root, "has_more")) {
    readingHasMore = Boolean(Number(root.has_more));
  }
  const awemes = collectAwemes(json);
  const reading = readingFolderName || "收藏";
  const cap = Math.max(1, Number(readingMax) || 300);
  for (const aweme of awemes) {
    const inner = unwrapAweme(aweme) || aweme;
    const id = String(inner.aweme_id || inner.id || aweme.aweme_id || "");
    const isNew = id && !captured.has(id);
    if (isNew && countProgress(readingFolderId, reading, readingStarted) >= cap) {
      refreshReading = false;
      break;
    }
    const custom = folders.find((f) => f.id === String(aweme.collects_id || inner.collects_id || "") && !f.isDefault);
    const folder =
      reading !== "收藏"
        ? ensureFolder(reading, readingCollectsId || custom?.id)
        : custom || defaultFolder();
    if (reading !== "收藏" && readingCollectsId) {
      const aid = String(inner.collects_id || feedId || "");
      if (aid && aid !== readingCollectsId) continue;
    }
    const work = mapAweme(aweme, folder);
    if (!work.id) continue;
    if (folder && !folder.isDefault) {
      work.alsoInFolderIds = [...new Set([...(work.alsoInFolderIds || []), "default"])];
    }
    const prev = captured.get(work.id);
    work.listIndex = readingOrder;
    if (reading === "收藏") work.allIndex = readingOrder;
    readingOrder += 1;
    if (prev) {
      const keepCustom = prev.folderId && prev.folderId !== "default" && reading === "收藏";
      if (keepCustom) {
        work.folderId = prev.folderId;
        work.alsoInFolderIds = [...new Set([...(prev.alsoInFolderIds || []), ...work.alsoInFolderIds, "default"])];
      } else if (prev.folderId !== work.folderId) {
        work.alsoInFolderIds = [...new Set([...(prev.alsoInFolderIds || []), prev.folderId, ...work.alsoInFolderIds])];
      }
    }
    captured.set(work.id, work);
    seenThisRead.add(work.id);
  }
  send("cangxia:sync-count", { works: captured.size, folders: folders.length });
}

function replayFolderBuffer() {
  const recent = feedBuffer.filter((x) => Date.now() - x.at < 25000);
  feedBuffer = [];
  let pick = recent;
  if (readingCollectsId) {
    const matched = recent.filter((x) => x.feedId === readingCollectsId);
    if (matched.length) pick = matched;
    else pick = recent.slice(-1);
  } else if (recent.length) {
    pick = recent.slice(-1);
    if (pick[0]?.feedId) readingCollectsId = pick[0].feedId;
  }
  readingInside = true;
  for (const item of pick) ingestPayload(item.url, item.json);
}

async function snapshotWorks() {
  const works = [...captured.values()].map((w) => {
    if (seenThisRead.size && !seenThisRead.has(w.id)) {
      return { ...w, listIndex: (w.listIndex ?? 0) + 1_000_000 };
    }
    return w;
  }).sort((a, b) => (a.listIndex ?? 0) - (b.listIndex ?? 0));
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
  const method = lastHarvestMethod;
  const folder = readingFolderName;
  const harvested = lastHarvestCount;
  refreshReading = false;
  readingFolderName = "";
  readingStarted = 0;
  readingInside = false;
  feedBuffer = [];
  seenThisRead = new Set();
  closeProgressWindow();
  send("cangxia:refresh-done", { ...snap, method, folder, harvested });
  send("cangxia:progress", { active: false, current: 0, total: 0, message: "" });
  if (method) {
    try {
      new Notification({
        title: harvested > 0 ? "藏匣读取完成" : "藏匣没有读到",
        body: harvested > 0 ? `${method} 读到「${folder || "收藏"}」${harvested} 条` : method,
      }).show();
    } catch {
      /* ignore */
    }
  }
  lastHarvestMethod = "";
  lastHarvestCount = 0;
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
      message: `正在读取「${folderName}」 ${got}/${max}`,
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

async function openFavoriteFresh(win) {
  await win.loadURL("https://www.douyin.com/user/self", { userAgent: CHROME_UA });
  await sleep(2800);
}

function mouseClick(win, x, y) {
  const wc = win.webContents;
  wc.sendInputEvent({ type: "mouseMove", x, y });
  wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

async function wheelBurst(win) {
  const wc = win.webContents;
  let x = 760;
  let y = 520;
  try {
    const pt = await wc.executeJavaScript(WORK_GRID_POINT_SCRIPT);
    if (pt?.x && pt?.y) {
      x = pt.x;
      y = pt.y;
    }
  } catch {
    /* keep default */
  }
  wc.sendInputEvent({ type: "mouseMove", x, y });
  await sleep(80);
  for (let i = 0; i < 6; i++) {
    if (refreshStop || !win || win.isDestroyed()) return;
    wc.sendInputEvent({
      type: "mouseWheel",
      x,
      y,
      deltaX: 0,
      deltaY: 1200,
      canScroll: true,
    });
    await sleep(600);
  }
}

async function sessionMsToken() {
  try {
    const list = await session.fromPartition(PARTITION).cookies.get({ domain: ".douyin.com" });
    return list.find((c) => c.name === "msToken")?.value || "";
  } catch {
    return "";
  }
}

function sessionRequest(method, url, body = null) {
  return new Promise((resolve) => {
    const req = net.request({
      method,
      url,
      session: session.fromPartition(PARTITION),
      useSessionCookies: true,
    });
    req.setHeader("User-Agent", CHROME_UA);
    req.setHeader("Referer", "https://www.douyin.com/user/self");
    req.setHeader("Origin", "https://www.douyin.com");
    req.setHeader("Accept", "application/json, text/plain, */*");
    if (method === "POST") {
      req.setHeader("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
    }
    let data = "";
    req.on("response", (res) => {
      res.on("data", (chunk) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, json, text: data.slice(0, 220) });
      });
    });
    req.on("error", (err) => resolve({ status: 0, json: null, text: String(err?.message || err) }));
    if (body) req.write(body);
    req.end();
  });
}

async function signedRequest(win, { method = "GET", path, query = {}, body = null }) {
  const msToken = await sessionMsToken();
  const qs = new URLSearchParams(commonQuery({ ...query, ...(msToken ? { msToken } : {}) })).toString();
  const unsigned = `${path}?${qs}`;
  let aBogus = "";
  try {
    aBogus = await win.webContents.executeJavaScript(signUrlScript(method, unsigned));
  } catch {
    aBogus = "";
  }
  const url = aBogus ? `${unsigned}&a_bogus=${encodeURIComponent(aBogus)}` : unsigned;
  let res = { status: 0, json: null, text: "empty" };
  try {
    res = await win.webContents.executeJavaScript(pageFetchScript({ method, url, body }), true);
  } catch (err) {
    res = { status: 0, json: null, text: String(err?.message || err) };
  }
  if (!jsonOk(res?.json)) {
    const fallback = await sessionRequest(method, url, body);
    if (jsonOk(fallback.json)) res = fallback;
  }
  res.signed = Boolean(aBogus);
  return res;
}

async function hookedRequest(win, { method = "GET", path, query = {}, body = null }) {
  const msToken = await sessionMsToken();
  const qs = new URLSearchParams(commonQuery({ ...query, ...(msToken ? { msToken } : {}) })).toString();
  const pathOnly = String(path).replace(/^https?:\/\/www\.douyin\.com/, "");
  const url = `${pathOnly}?${qs}`;
  try {
    return await win.webContents.executeJavaScript(hookedXhrScript({ method, url, body }), true);
  } catch (err) {
    return { status: 0, json: null, text: String(err?.message || err) };
  }
}

async function netCookieRequest(win, { method = "GET", path, query = {}, body = null }) {
  const msToken = await sessionMsToken();
  const qs = new URLSearchParams(commonQuery({ ...query, ...(msToken ? { msToken } : {}) })).toString();
  return sessionRequest(method, `${path}?${qs}`, body);
}

async function harvestMcp(win, ctx) {
  if (ctx.folderName === "收藏") {
    await win.webContents.executeJavaScript(OPEN_FAVORITE_SCRIPT);
    await sleep(2500);
  } else {
    await win.webContents.executeJavaScript(OPEN_FAVORITE_SCRIPT);
    await sleep(2000);
    await win.webContents.executeJavaScript(CLICK_FOLDER_TAB_SCRIPT);
    await sleep(3500);
    readingCollectsId = folderIdByName(ctx.folderName);
  }
  return harvestByIntercept(win, ctx);
}

function jsonOk(json) {
  if (!json || typeof json !== "object") return false;
  const code = json.status_code;
  if (code !== undefined && Number(code) !== 0) return false;
  return true;
}

async function harvestVia(win, { folderId, folderName, max, started }, doRequest) {
  readingInside = true;
  refreshReading = true;
  try {
    const ready = await win.webContents.executeJavaScript(waitBdmsScript());
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: max,
      message: ready?.bdms ? "已接上抖音签名，开始读接口" : "签名脚本未就绪，仍尝试读接口",
    });
  } catch {
    /* continue */
  }

  if (folderName === "收藏") {
    let cursor = 0;
    for (let page = 0; page < 80; page += 1) {
      if (refreshStop || !win || win.isDestroyed()) return countProgress(folderId, folderName, started);
      if (countProgress(folderId, folderName, started) >= max) return countProgress(folderId, folderName, started);
      send("cangxia:progress", {
        active: true,
        current: Math.min(countProgress(folderId, folderName, started), max),
        total: max,
        message: `接口读取「收藏」 ${countProgress(folderId, folderName, started)}/${max}`,
      });
      const body = `cursor=${cursor}&count=10`;
      let res = await doRequest(win, {
        method: "POST",
        path: "https://www.douyin.com/aweme/v1/web/aweme/listcollection/",
        query: { count: "10", cursor: String(cursor) },
        body,
      });
      if (!jsonOk(res.json) || !collectAwemes(res.json).length) {
        res = await doRequest(win, {
          method: "GET",
          path: "https://www.douyin.com/aweme/v1/web/aweme/listcollection/",
          query: { count: "10", cursor: String(cursor) },
        });
      }
      if (!jsonOk(res.json)) {
        send("cangxia:progress", {
          active: true,
          current: countProgress(folderId, folderName, started),
          total: max,
          message: `收藏接口失败 ${res.status} ${res.json?.status_msg || res.text || ""}`.slice(0, 80),
        });
        break;
      }
      ingestPayload("https://www.douyin.com/aweme/v1/web/aweme/listcollection/", res.json);
      const next = nextCursor(res.json, cursor);
      if (!next.hasMore) break;
      if (String(next.cursor) === String(cursor)) break;
      cursor = next.cursor;
      await sleep(400);
    }
    return countProgress(folderId, folderName, started);
  }

  send("cangxia:progress", {
    active: true,
    current: 0,
    total: max,
    message: `接口列出收藏夹，定位「${folderName}」`,
  });
  const listRes = await doRequest(win, {
    method: "GET",
    path: "https://www.douyin.com/aweme/v1/web/collects/list/",
    query: { cursor: "0", count: "40" },
  });
  if (jsonOk(listRes.json)) ingestPayload("https://www.douyin.com/aweme/v1/web/collects/list/", listRes.json);
  const parsed = parseCollectsList(listRes.json);
  for (const item of parsed) ensureFolder(item.name, item.id);
  const hit = parsed.find((x) => x.name === folderName) || parsed.find((x) => x.name.includes(folderName));
  const id = String(hit?.id || folderIdByName(folderName) || "");
  if (!id) {
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: max,
      message: `没拿到「${folderName}」的 id（${listRes.status} ${listRes.json?.status_msg || (listRes.signed ? "已签名" : "未签名")}）`.slice(0, 90),
    });
    await sleep(1800);
    return 0;
  }
  readingCollectsId = id;
  let cursor = 0;
  for (let page = 0; page < 80; page += 1) {
    if (refreshStop || !win || win.isDestroyed()) return countProgress(folderId, folderName, started);
    if (countProgress(folderId, folderName, started) >= max) return countProgress(folderId, folderName, started);
    send("cangxia:progress", {
      active: true,
      current: Math.min(countProgress(folderId, folderName, started), max),
      total: max,
      message: `接口读取「${folderName}」 ${countProgress(folderId, folderName, started)}/${max}`,
    });
    const url = `https://www.douyin.com/aweme/v1/web/collects/video/list/?collects_id=${id}&cursor=${cursor}`;
    const res = await doRequest(win, {
      method: "GET",
      path: "https://www.douyin.com/aweme/v1/web/collects/video/list/",
      query: { collects_id: id, cursor: String(cursor), count: "10" },
    });
    if (!jsonOk(res.json)) {
      send("cangxia:progress", {
        active: true,
        current: countProgress(folderId, folderName, started),
        total: max,
        message: `夹接口失败 ${res.status} ${res.json?.status_msg || res.text || ""}`.slice(0, 80),
      });
      break;
    }
    ingestPayload(url, res.json);
    const next = nextCursor(res.json, cursor);
    if (!next.hasMore) break;
    if (String(next.cursor) === String(cursor)) break;
    cursor = next.cursor;
    await sleep(400);
  }
  return countProgress(folderId, folderName, started);
}

async function harvestByIntercept(win, { folderId, folderName, max, started }) {
  refreshReading = true;
  readingInside = true;
  send("cangxia:progress", {
    active: true,
    current: 0,
    total: max,
    message: `正在读取「${folderName}」 0/${max}`,
  });
  await waitForNewItems(captured.size, 8000, folderName, folderId, started, max);
  if (countProgress(folderId, folderName, started) >= max) return countProgress(folderId, folderName, started);
  let idle = 0;
  while (win && !win.isDestroyed() && !refreshStop) {
    while (refreshPaused && !refreshStop) await sleep(400);
    if (refreshStop || !win || win.isDestroyed()) break;
    const got = countProgress(folderId, folderName, started);
    send("cangxia:progress", {
      active: true,
      current: Math.min(got, max),
      total: max,
      message: `正在读取「${folderName}」 ${got}/${max}`,
    });
    if (got >= max) break;
    if (!readingHasMore && got > 0) break;
    const before = captured.size;
    await wheelBurst(win);
    const grew = await waitForNewItems(before, 4000, folderName, folderId, started, max);
    if (countProgress(folderId, folderName, started) >= max) break;
    if (grew) idle = 0;
    else idle += 1;
    if (idle >= 4) break;
  }
  return countProgress(folderId, folderName, started);
}

async function openNamedFolder(win, folderName) {
  send("cangxia:progress", {
    active: true,
    current: 0,
    total: 1,
    message: `正在打开收藏夹，准备点进「${folderName}」`,
  });
  await win.webContents.executeJavaScript(OPEN_FAVORITE_SCRIPT);
  await sleep(2500);
  await win.webContents.executeJavaScript(CLICK_FOLDER_TAB_SCRIPT);
  await sleep(2500);
  readingCollectsId = (await waitFolderId(folderName)) || readingCollectsId;
  send("cangxia:progress", {
    active: true,
    current: 0,
    total: 1,
    message: readingCollectsId ? `已对准「${folderName}」，正在点进` : `正在点进「${folderName}」`,
  });
  await sleep(1000);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (refreshStop || !win || win.isDestroyed()) return "none";
    let inside = { ok: false };
    try {
      inside = await win.webContents.executeJavaScript(folderInsideScript(folderName));
    } catch {
      inside = { ok: false };
    }
    if (inside?.ok) return "in";
    let loc = { how: "none", x: 0, y: 0 };
    try {
      loc = await win.webContents.executeJavaScript(locateFolderCardScript(folderName));
    } catch {
      loc = { how: "none", x: 0, y: 0 };
    }
    if (loc?.how && loc.how !== "none" && loc.x) {
      send("cangxia:progress", {
        active: true,
        current: 0,
        total: 1,
        message: `正在点进「${folderName}」`,
      });
      mouseClick(win, loc.x, loc.y);
      await sleep(500);
      try {
        await win.webContents.executeJavaScript(clickFolderCardScript(folderName));
      } catch {
        /* ignore */
      }
    }
    await sleep(1600);
  }
  return "none";
}

async function scrollUntilCap(win, { folderId, folderName, max, started }) {
  readingOrder = 0;
  readingHasMore = true;
  seenThisRead = new Set();
  readingCollectsId = "";
  readingInside = true;
  feedBuffer = [];
  refreshReading = true;
  const ctx = { folderId, folderName, max, started };
  const steps = [
    ["1/5 f2 页面XHR", () => harvestVia(win, ctx, hookedRequest)],
    ["2/5 TikTokDownloader 签名", () => harvestVia(win, ctx, signedRequest)],
    ["3/5 douyin-downloader cookie", () => harvestVia(win, ctx, netCookieRequest)],
    ["4/5 LightJUNction 再试XHR", () => harvestVia(win, ctx, hookedRequest)],
    ["5/5 MCP 拦页面", () => harvestMcp(win, ctx)],
  ];
  try {
    await openFavoriteFresh(win);
    for (const [label, run] of steps) {
      if (refreshStop || !win || win.isDestroyed()) return;
      send("cangxia:progress", {
        active: true,
        current: countProgress(folderId, folderName, started),
        total: max,
        message: `尝试 ${label} 读「${folderName}」`,
      });
      const got = await run();
      if (got > 0) {
        lastHarvestMethod = label;
        lastHarvestCount = got;
        send("cangxia:progress", {
          active: true,
          current: Math.min(got, max),
          total: max,
          message: `${label} 读到 ${got} 条`,
        });
        return;
      }
    }
    lastHarvestMethod = `五种方法都没读到「${folderName}」`;
    lastHarvestCount = 0;
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: max,
      message: `五种方法都没读到「${folderName}」`,
    });
  } catch (err) {
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: max,
      message: `读取出错：${String(err?.message || err)}`.slice(0, 80),
    });
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
    message: "请点「收藏」读总收藏，或点「收藏夹」再点某一个夹",
  });
  while (win && !win.isDestroyed() && !refreshStop) {
    let state = { view: "other", name: "", cards: [] };
    try {
      state = await win.webContents.executeJavaScript(installFolderWatchScript(folders.map((f) => f.name)));
    } catch {
      break;
    }
    for (const card of state?.cards || []) {
      if (card?.name) ensureFolder(card.name);
    }
    for (const name of state?.side || []) {
      if (name) ensureFolder(name);
    }
    if (state.view === "folder-grid" || state.view === "folder-list") {
      const names = (state.side || []).length ? state.side.join("、") : `${(state.cards || []).length} 个`;
      send("cangxia:progress", {
        active: true,
        current: 0,
        total: max,
        message: `已打开收藏夹列表（${names}）。请点左侧某一个夹，例如玛丽罗斯`,
      });
      await sleep(600);
      continue;
    }
    const key = `${state?.view || "other"}:${state?.name || ""}`;
    const nameOk = state.name === "收藏" || validFolderName(state.name);
    if ((state.view === "favorite" || state.view === "folder") && state.name && nameOk && !denied.has(key)) {
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
        const folder = ensureFolder(readingFolderName);
        readingFolderId = folder.id;
        readingMax = max;
        readingStarted = countInFolder(folder.id);
        readingPattern = readingFolderName === "收藏" ? "listcollection" : "collects/video/list";
        readingHasMore = true;
        const started = readingStarted;
        await scrollUntilCap(win, {
          folderId: folder.id,
          folderName: readingFolderName,
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
        message: "未读取。请点「收藏夹」里的某一个夹，或点停止",
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
      void douyinWindow.webContents.executeJavaScript(installFolderWatchScript(folders.map((f) => f.name))).catch(() => {});
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
  const max = Math.max(1, Number(settings.maxPerRefresh) || 300);
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
          urls: clip.urls || [clip.url],
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
