import { app, BrowserWindow, ipcMain, dialog, Notification, session, net, shell, Menu, protocol } from "electron";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readIndex, deleteWorkFolders, workDir, relocateWorkFolder, exists } from "./lib/layout.mjs";
import { collectAwemes, isCollectFeedUrl, isFolderListUrl, mapAweme, mapFolder, unwrapAweme } from "./lib/aweme.mjs";
import { notifyWechat } from "./lib/push.mjs";
import { abortDownload, runWork } from "./lib/engine.mjs";
import { looksLikeCaptcha } from "./lib/captcha.mjs";
import { APP_SCHEMES, CHROME_UA, EXTRACT_QR_SCRIPT, LOGIN_PAGE_SCRIPT, OPEN_FAVORITE_SCRIPT, CLICK_FOLDER_TAB_SCRIPT, FOLDER_LIST_READY_SCRIPT, LOCATE_FOLDER_TAB_SCRIPT, FAVORITE_ALL_URL, FAVORITE_FOLDER_LIST_URL, clickFolderCardScript, clickFolderSideScript, clickOtherFolderScript, locateFolderCardScript, folderInsideScript, installFolderWatchScript, isHttpUrl, validFolderName, WORK_GRID_POINT_SCRIPT, GRID_CARDS_SCRIPT, PAGE_COLLECTS_ID_SCRIPT, LIST_VISIBLE_FOLDERS_SCRIPT, SCROLL_FEED_SCRIPT, SCROLL_GRID_TOP_SCRIPT, CLOSE_NEW_FOLDER_DIALOG_SCRIPT, mcpClickExactNameScript } from "./lib/login-page.mjs";
import { commonQuery, parseCollectsList, parseDouyinJson, sameCollectsId, requestCursor, requestCollectsId, isZeroCursor, nextCursor, waitBdmsScript, signUrlScript, pageFetchScript, hookedXhrScript, NUDGE_MOUSE_SCRIPT, PAGE_TOKENS_SCRIPT, HOOK_PAGE_FEEDS_SCRIPT, DRAIN_PAGE_FEEDS_SCRIPT, LIST_COLLECT_URLS_SCRIPT } from "./lib/page-api.mjs";

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
let readingOrderStart = 0;
let harvestIdOrder = [];
let seenThisRead = new Set();
let awemePool = new Map();
let gridOrderOnly = false;
let readingCollectsId = "";
let readingInside = false;
let seenZeroCursor = false;
let lastHarvestMethod = "";
let lastHarvestCount = 0;
let lastHarvestError = "";
let readingFolderTotal = 0;
let readingCursor = 0;
let netTrace = [];
let knownSkip = new Set();
let skippedIds = new Set();

function shortUrl(url) {
  const s = String(url || "");
  const host = ((s.match(/^https?:\/\/([^/]+)/i) || [])[1] || "").replace(/\.douyin\.com$/i, "").replace(/^www-?/i, "");
  const path = s.replace(/^https?:\/\/[^/]+/i, "").split("?")[0];
  return `${host}${path}`.slice(-56);
}

function isNoiseUrl(url) {
  return /zijieapi|monitor_browser|byteimg|\/goofy\/|mcs\.|\/report|\/log\/|sentry|collect\/batch/i.test(String(url || ""));
}

function isHarvestUrl(url) {
  if (isNoiseUrl(url)) return false;
  const u = String(url || "");
  if (isCollectFeedUrl(u) || isFolderListUrl(u)) return true;
  return /aweme\/v1\/web\//i.test(u);
}

function traceNet(url, tag) {
  netTrace.push(`${tag}:${shortUrl(url)}`);
  if (netTrace.length > 16) netTrace.shift();
}
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

function attachCdnReferer(ses) {
  const filter = {
    urls: [
      "*://*.douyinpic.com/*",
      "*://*.byteimg.com/*",
      "*://*.douyinstatic.com/*",
      "*://*.ibytedtos.com/*",
    ],
  };
  ses.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
    cb({
      requestHeaders: {
        ...details.requestHeaders,
        Referer: "https://www.douyin.com/",
        Origin: "https://www.douyin.com",
      },
    });
  });
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

async function waitWhilePaused() {
  while (refreshPaused && !refreshStop) await sleep(400);
}

function requestBlocked(res) {
  const msg = `${res?.status || ""} ${res?.json?.status_code ?? ""} ${res?.json?.status_msg || ""} ${res?.text || ""}`;
  return /403|Argus|Sign Invalid|Blocked|verify|captcha|验证码/i.test(msg);
}

function rankCapturedByCollectTime(folderId) {
  const mine = [...captured.values()].filter(
    (w) => w.folderId === folderId || (w.alsoInFolderIds || []).includes(folderId),
  );
  mine.sort((a, b) => {
    if (a.collectTimeKnown && b.collectTimeKnown && a.collectedAt !== b.collectedAt) {
      return (b.collectedAt || 0) - (a.collectedAt || 0);
    }
    return (a.listIndex ?? 0) - (b.listIndex ?? 0);
  });
  mine.forEach((w, i) => {
    w.listIndex = i;
    captured.set(w.id, w);
  });
  harvestIdOrder = mine.map((w) => w.id);
}

async function attachNetwork(win) {
  const wc = win.webContents;
  try {
    wc.debugger.attach("1.3");
  } catch {
    /* already attached */
  }
  try {
    await wc.debugger.sendCommand("Network.enable", { maxPostDataSize: 65536 });
  } catch {
    return;
  }
  const pending = new Map();
  wc.debugger.removeAllListeners("message");
  wc.debugger.on("message", async (_e, method, params) => {
    if (method === "Network.requestWillBeSent") {
      const req = params.request || {};
      const url = req.url || "";
      if (!isHarvestUrl(url)) return;
      const post = req.postData || "";
      pending.set(params.requestId, {
        url,
        post,
        needPost: Boolean(req.hasPostData && !post),
        cursor: requestCursor(url, post),
      });
      return;
    }
    if (method === "Network.responseReceived") {
      const url = params.response?.url || "";
      if (looksLikeCaptcha(url)) {
        emitCaptcha("page");
        return;
      }
      const mime = String(params.response?.mimeType || "");
      if (mime.includes("html") || mime.includes("image") || mime.includes("video") || mime.includes("font")) return;
      if (!isHarvestUrl(url)) return;
      const prev = pending.get(params.requestId) || { url, cursor: requestCursor(url) };
      pending.set(params.requestId, { ...prev, url });
      traceNet(url, prev.cursor && prev.cursor !== "0" ? `net-c${prev.cursor}` : "net");
      return;
    }
    if (method === "Network.loadingFailed") {
      pending.delete(params.requestId);
      return;
    }
    if (method !== "Network.loadingFinished") return;
    const meta = pending.get(params.requestId);
    pending.delete(params.requestId);
    if (!meta?.url) return;
    let post = meta.post || "";
    if (meta.needPost) {
      try {
        const pd = await wc.debugger.sendCommand("Network.getRequestPostData", { requestId: params.requestId });
        post = pd.postData || post;
      } catch {
        /* ignore */
      }
    }
    const cursor = requestCursor(meta.url, post);
    try {
      const body = await wc.debugger.sendCommand("Network.getResponseBody", { requestId: params.requestId });
      const raw = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body;
      const text = String(raw || "").trim();
      if (!text.startsWith("{") && !text.startsWith("[")) {
        traceNet(meta.url, "notjson");
        return;
      }
      ingestPayload(meta.url, parseDouyinJson(text) || JSON.parse(text), cursor, post);
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

function ingestPayload(url, json, cursorHint, postHint = "") {
  if (isFolderListUrl(url)) {
    const data = json.data || json;
    const list = data.collects_list || data.list || json.collects_list;
    if (Array.isArray(list)) {
      for (const [i, raw] of list.entries()) {
        const mapped = mapFolder(raw, i);
        if (!mapped.name || mapped.isDefault) continue;
        if (!validFolderName(mapped.name)) continue;
        ensureFolder(mapped.name, mapped.id);
        poolAwemes(raw);
        const nested = raw.aweme_list || raw.awemes || raw.item_list || raw.items;
        if (Array.isArray(nested)) {
          for (const a of nested) {
            const inner = unwrapAweme(a) || a;
            const id = String(inner?.aweme_id || inner?.id || "");
            if (id) awemePool.set(id, inner);
          }
        }
      }
    }
  }
  if (!refreshReading) {
    if (isFolderListUrl(url)) {
      /* folders already handled */
    } else {
      traceNet(url, "noread");
    }
    return;
  }
  const isList = /listcollection/i.test(url);
  const hasCollectsQuery = /collects_id=\d+/i.test(url);
  const isFolderFeed =
    hasCollectsQuery ||
    (/collects\/video\/list|collects\/aweme\/list|collects\/item\/list|\/web\/collects\//i.test(url) &&
      !/collects\/list\/?(?:\?|$)/i.test(url));
  poolAwemes(json);
  const named = (readingFolderName || "收藏") !== "收藏";
  const curEarly = cursorHint || requestCursor(url, postHint);
  const feedIdEarly = String(
    requestCollectsId(url, postHint) ||
      json?.data?.collects_id_str ||
      json?.collects_id_str ||
      json?.data?.collects_id ||
      json?.collects_id ||
      "",
  );
  if (named && isFolderFeed && !readingInside) {
    feedBuffer.push({ url, json, feedId: feedIdEarly, at: Date.now(), cursor: curEarly, post: postHint });
    if (feedBuffer.length > 40) feedBuffer.shift();
    traceNet(url, curEarly && curEarly !== "0" ? `buf-c${curEarly}` : "buf");
    if (gridOrderOnly) return;
  }
  if (gridOrderOnly) {
    traceNet(url, "pool");
    return;
  }
  if (readingPattern === "listcollection" ? !isList : !isFolderFeed) {
    traceNet(url, isList ? "skip-总收藏" : "skip");
    return;
  }
  const root = json.data || json;
  const collectsMatch = String(url).match(/collects_id=(\d+)/);
  const feedId = String(collectsMatch?.[1] || requestCollectsId(url, postHint) || root?.collects_id_str || root?.collects_id || feedIdEarly);
  const cur = curEarly || requestCursor(url, postHint);
  if (named && isFolderFeed) {
    if (!readingInside) {
      return;
    }
    if (!readingCollectsId && feedId) readingCollectsId = feedId;
    if (readingCollectsId && feedId && !sameCollectsId(feedId, readingCollectsId)) {
      traceNet(url, `id-mismatch:${feedId}`);
      return;
    }
    if (cur && Number(cur) > 0 && seenThisRead.size === 0 && !readingInside) {
      traceNet(url, `late-cursor:${cur}`);
      return;
    }
    if (!cur || cur === "0" || seenThisRead.size > 0) seenZeroCursor = true;
  }
  if (root && Object.prototype.hasOwnProperty.call(root, "has_more")) {
    readingHasMore = Boolean(Number(root.has_more));
  }
  const awemes = collectAwemes(json);
  if (!awemes.length) {
    const code = json.status_code ?? json.data?.status_code ?? "";
    const msg = json.status_msg || json.data?.status_msg || "";
    traceNet(url, `empty${code}${msg ? `:${String(msg).slice(0, 12)}` : ""}`);
    return;
  }
  const reading = readingFolderName || "收藏";
  const cap = Math.max(1, Number(readingMax) || 300);
  for (const aweme of awemes) {
    const inner = unwrapAweme(aweme) || aweme;
    const id = String(inner.aweme_id || inner.id || aweme.aweme_id || "");
    if (id && knownSkip.has(id)) skippedIds.add(id);
    const countIt = Boolean(id) && !knownSkip.has(id);
    if (countIt && seenThisRead.size >= cap) {
      refreshReading = false;
      break;
    }
    const folder = reading !== "收藏" ? ensureFolder(reading, readingCollectsId) : defaultFolder();
    const work = mapAweme(aweme, folder);
    if (!work.id) continue;
    if (folder && !folder.isDefault) {
      work.alsoInFolderIds = [...new Set([...(work.alsoInFolderIds || []), "default"])];
    }
    const prev = captured.get(work.id);
    if (id && !harvestIdOrder.includes(id)) harvestIdOrder.push(id);
    const pos = id ? harvestIdOrder.indexOf(id) : harvestIdOrder.length;
    if (reading === "收藏") work.allIndex = Math.max(0, pos);
    else work.listIndex = readingOrderStart + Math.max(0, pos);
    if (prev) {
      if (work.allIndex == null && prev.allIndex != null) work.allIndex = prev.allIndex;
      if (work.listIndex == null && prev.listIndex != null) work.listIndex = prev.listIndex;
      const keepCustom = prev.folderId && prev.folderId !== "default" && reading === "收藏";
      if (keepCustom) {
        work.folderId = prev.folderId;
        work.alsoInFolderIds = [...new Set([...(prev.alsoInFolderIds || []), ...work.alsoInFolderIds, "default"])];
      } else if (prev.folderId !== work.folderId) {
        work.alsoInFolderIds = [...new Set([...(prev.alsoInFolderIds || []), prev.folderId, ...work.alsoInFolderIds])];
      }
    }
    captured.set(work.id, work);
    if (countIt) seenThisRead.add(work.id);
  }
  send("cangxia:sync-count", { works: captured.size, folders: folders.length });
}

function poolAwemes(json) {
  for (const aweme of collectAwemes(json)) {
    const inner = unwrapAweme(aweme) || aweme;
    const id = String(inner.aweme_id || inner.id || aweme.aweme_id || "");
    if (id) awemePool.set(id, inner);
  }
}

function ingestPooledOrCard(card, folder) {
  const id = String(card?.id || "");
  if (!id) return;
  const cap = Math.max(1, Number(readingMax) || 300);
  const countIt = !knownSkip.has(id);
  if (knownSkip.has(id)) skippedIds.add(id);
  if (countIt && seenThisRead.size >= cap) return;
  const folderRef = folder || ensureFolder(readingFolderName, readingCollectsId);
  const pooled = awemePool.get(id);
  const work = mapAweme(
    pooled || {
      aweme_id: id,
      desc: card.title || "未命名",
      aweme_type: card.kind === "video" ? 0 : 68,
      video: card.cover ? { origin_cover: { url_list: [card.cover] }, cover: { url_list: [card.cover] } } : {},
      images: card.kind !== "video" && card.cover ? [{ url_list: [card.cover] }] : [],
    },
    folderRef,
  );
  if (!work.id) return;
  if (folderRef && !folderRef.isDefault) {
    work.alsoInFolderIds = [...new Set([...(work.alsoInFolderIds || []), "default"])];
  }
  if (!harvestIdOrder.includes(work.id)) harvestIdOrder.push(work.id);
  const pos = harvestIdOrder.indexOf(work.id);
  if (readingFolderName === "收藏") work.allIndex = Math.max(0, pos);
  else work.listIndex = readingOrderStart + Math.max(0, pos);
  captured.set(work.id, work);
  if (countIt) seenThisRead.add(work.id);
}

async function harvestFromGrid(win, ctx) {
  const max = Math.max(1, Number(ctx.max) || 20);
  const folder = ensureFolder(ctx.folderName, readingCollectsId);
  const seen = new Set();
  let idle = 0;
  const snap = async () => {
    await drainPageFeeds(win);
    let cards = [];
    try {
      cards = await win.webContents.executeJavaScript(GRID_CARDS_SCRIPT);
    } catch {
      cards = [];
    }
    let fresh = 0;
    for (const card of cards || []) {
      const id = String(card?.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      fresh += 1;
      ingestPooledOrCard(card, folder);
      if (seenThisRead.size >= max) break;
    }
    sendReadProgress(ctx.folderName, "，页面格子");
    return fresh;
  };
  await scrollGridTop(win);
  await snap();
  while (win && !win.isDestroyed() && !refreshStop && seenThisRead.size < max && idle < 16) {
    await wheelBurst(win);
    const fresh = await snap();
    if (seenThisRead.size >= max) break;
    if (!fresh) idle += 1;
    else idle = 0;
    await sleep(200);
  }
  return seenThisRead.size;
}

function replayFolderBuffer() {
  const recent = feedBuffer.filter((x) => Date.now() - x.at < 25000);
  feedBuffer = [];
  for (const item of recent) {
    if (item?.json) poolAwemes(item.json);
  }
}

function packetsForFolder(folderName) {
  const id = folderIdByName(folderName) || readingCollectsId;
  return feedBuffer.filter((x) => {
    if (!x?.json || !collectAwemes(x.json).length) return false;
    if (!id) return true;
    if (!x.feedId) return true;
    return sameCollectsId(x.feedId, id);
  });
}

function ingestBufferedFirstPage(folderName) {
  const folder = ensureFolder(folderName, readingCollectsId);
  const id = folderIdByName(folderName) || readingCollectsId;
  if (id && !String(id).startsWith("folder_")) readingCollectsId = String(id);
  const packets = packetsForFolder(folderName).slice().sort((a, b) => {
    const az = !a.cursor || a.cursor === "0" ? 0 : 1;
    const bz = !b.cursor || b.cursor === "0" ? 0 : 1;
    if (az !== bz) return az - bz;
    return (a.at || 0) - (b.at || 0);
  });
  const cap = Math.max(1, Number(readingMax) || 20);
  for (const p of packets) {
    if (p.feedId && !readingCollectsId) readingCollectsId = String(p.feedId);
    for (const aweme of collectAwemes(p.json)) {
      const inner = unwrapAweme(aweme) || aweme;
      const awemeId = String(inner.aweme_id || inner.id || "");
      if (!awemeId) continue;
      awemePool.set(awemeId, inner);
      ingestPooledOrCard(
        {
          id: awemeId,
          title: inner.desc || "",
          kind: Array.isArray(inner.images) && inner.images.length ? "album" : "video",
          cover: "",
        },
        folder,
      );
      if (seenThisRead.size >= cap) return seenThisRead.size;
    }
  }
  return seenThisRead.size;
}

async function waitListPageFirst(win, folderName, timeoutMs = 7000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && !refreshStop && win && !win.isDestroyed()) {
    await drainPageFeeds(win);
    if (packetsForFolder(folderName).length) return true;
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: Math.max(1, Number(readingMax) || 20),
      message: `卡片墙收「${folderName}」第一包 ${Math.round((Date.now() - t0) / 1000)}s`,
    });
    await sleep(350);
  }
  await drainPageFeeds(win);
  return packetsForFolder(folderName).length > 0;
}

async function snapshotWorks() {
  const works = [...captured.values()].map((w) => {
    if (seenThisRead.size && !seenThisRead.has(w.id)) {
      if (readingFolderName === "收藏") return { ...w, allIndex: (w.allIndex ?? 0) + 1_000_000 };
      return { ...w, listIndex: (w.listIndex ?? 0) + 1_000_000 };
    }
    return w;
  }).sort((a, b) => {
    if (readingFolderName === "收藏") return (a.allIndex ?? 1e12) - (b.allIndex ?? 1e12);
    return (a.listIndex ?? 1e12) - (b.listIndex ?? 1e12);
  });
  if (settings.rootPath) {
    const index = await readIndex(settings.rootPath);
    const downloaded = new Set((index.records || []).map((r) => r.id));
    for (const w of works) {
      if (downloaded.has(w.id)) w.status = "downloaded";
    }
  }
  const snapFolders =
    readingFolderName && readingFolderName !== "收藏"
      ? folders.filter((f) => f.isDefault || f.name === readingFolderName)
      : folders.filter((f) => f.isDefault);
  return { folders: snapFolders, works };
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

function countProgress() {
  return seenThisRead.size;
}

function progressTotal() {
  if (Number(readingFolderTotal) > 0) return Number(readingFolderTotal);
  const n = Number(readingMax);
  if (n > 0 && n < 10000) return n;
  return 0;
}

function progressLabel(folderName, extra = "") {
  const got = countProgress();
  const total = progressTotal();
  return total
    ? `读「${folderName}」 ${got}/${total}${extra}`
    : `读「${folderName}」 ${got}条${extra}`;
}

function sendReadProgress(folderName, extra = "") {
  const total = progressTotal();
  send("cangxia:progress", {
    active: true,
    current: countProgress(),
    total,
    message: progressLabel(folderName, extra),
  });
}

async function drainPageFeeds(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const feeds = await win.webContents.executeJavaScript(DRAIN_PAGE_FEEDS_SCRIPT);
    for (const f of feeds || []) {
      const rawUrl = String(f.url || "");
      const url = /^https?:/i.test(rawUrl) ? rawUrl : `https://www.douyin.com${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
      let json = null;
      try {
        json = parseDouyinJson(f.text);
      } catch {
        json = null;
      }
      if (json) ingestPayload(url, json);
      traceNet(url, json ? "page" : "page-raw");
    }
  } catch {
    /* ignore */
  }
}

async function waitForNewItems(prevCount, timeoutMs, folderName) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && !refreshStop) {
    const got = countProgress();
    send("cangxia:progress", {
      active: true,
      current: got,
      total: progressTotal(),
      message: progressLabel(folderName),
    });
    if (readingFolderTotal && got >= readingFolderTotal) return true;
    if (Number(readingMax) < 10000 && got >= Number(readingMax)) return true;
    await sleep(200);
  }
  return countProgress() > prevCount;
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

async function scrollGridTop(win) {
  if (!win || win.isDestroyed()) return;
  try {
    await win.webContents.executeJavaScript(SCROLL_GRID_TOP_SCRIPT);
  } catch {
    /* ignore */
  }
  const wc = win.webContents;
  let x = 760;
  let y = 420;
  try {
    const pt = await wc.executeJavaScript(WORK_GRID_POINT_SCRIPT);
    if (pt?.x && pt?.y) {
      x = pt.x;
      y = pt.y;
    }
  } catch {
    /* keep */
  }
  wc.sendInputEvent({ type: "mouseMove", x, y });
  await sleep(60);
  for (let i = 0; i < 8; i += 1) {
    wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY: -900, canScroll: true });
    await sleep(80);
  }
  try {
    await win.webContents.executeJavaScript(SCROLL_GRID_TOP_SCRIPT);
  } catch {
    /* ignore */
  }
}

async function cdpClick(wc, x, y) {
  const down = { type: "mousePressed", x, y, button: "left", clickCount: 1 };
  const up = { type: "mouseReleased", x, y, button: "left", clickCount: 1 };
  try {
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", down);
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", up);
  } catch {
    wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  }
}

async function cdpKey(wc, key, code, vk) {
  const payload = {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  };
  try {
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", payload);
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", { ...payload, type: "keyUp" });
  } catch {
    wc.sendInputEvent({ type: "keyDown", keyCode: vk });
    wc.sendInputEvent({ type: "keyUp", keyCode: vk });
  }
}

async function wheelBurst(win) {
  const wc = win.webContents;
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
  } catch {
    /* already */
  }
  try {
    await wc.executeJavaScript(CLOSE_NEW_FOLDER_DIALOG_SCRIPT);
  } catch {
    /* ignore */
  }
  win.focus();
  try {
    wc.focus();
  } catch {
    /* ignore */
  }
  let x = 520;
  let y = 380;
  try {
    const pt = await wc.executeJavaScript(SCROLL_FEED_SCRIPT);
    if (pt?.x && pt?.y) {
      x = pt.x;
      y = pt.y;
    }
  } catch {
    /* keep */
  }
  await cdpClick(wc, x, y);
  await sleep(120);
  await cdpClick(wc, x, y);
  await sleep(160);
  for (let i = 0; i < 10; i++) {
    if (refreshStop || !win || win.isDestroyed()) return;
    await cdpKey(wc, "ArrowDown", "ArrowDown", 40);
    await sleep(90);
  }
  await sleep(280);
}

async function mcpClickFavorite(win) {
  for (let i = 0; i < 6; i += 1) {
    let r = "none";
    try {
      r = await win.webContents.executeJavaScript(OPEN_FAVORITE_SCRIPT);
    } catch {
      r = "none";
    }
    if (String(r).startsWith("clicked")) return r;
    await sleep(700);
  }
  return "none";
}

async function waitFolderListVisible(win, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (refreshStop || !win || win.isDestroyed()) return false;
    let ready = false;
    try {
      ready = Boolean(await win.webContents.executeJavaScript(FOLDER_LIST_READY_SCRIPT));
    } catch {
      ready = false;
    }
    if (ready) return true;
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: 1,
      message: "请点「收藏夹」子标签（视频旁边），等到左侧出现「新建收藏夹」",
    });
    try {
      await win.webContents.executeJavaScript(CLICK_FOLDER_TAB_SCRIPT);
    } catch {
      /* ignore */
    }
    try {
      const loc = await win.webContents.executeJavaScript(LOCATE_FOLDER_TAB_SCRIPT);
      if (loc?.x) mouseClick(win, loc.x, loc.y);
    } catch {
      /* ignore */
    }
    await sleep(900);
  }
  return false;
}

async function mcpClickFolderTab(win) {
  for (let i = 0; i < 6; i += 1) {
    let r = "none";
    try {
      r = await win.webContents.executeJavaScript(CLICK_FOLDER_TAB_SCRIPT);
    } catch {
      r = "none";
    }
    if (String(r).startsWith("clicked")) return r;
    await sleep(700);
  }
  return "none";
}

async function waitFolderVideoList(win, collectsId, timeoutMs) {
  const t0 = Date.now();
  const id = String(collectsId || "");
  while (Date.now() - t0 < timeoutMs) {
    if (refreshStop || !win || win.isDestroyed()) return false;
    await drainPageFeeds(win);
    const hit = feedBuffer.find((f) => {
      const list = /collects\/(video|aweme|item)\/list/i.test(f.url || "");
      if (!list) return false;
      if (f.cursor && f.cursor !== "0") return false;
      if (id && f.feedId) return sameCollectsId(f.feedId, id);
      if (!id && f.feedId) return true;
      return false;
    });
    if (hit) return true;
    const net = netTrace.some((t) => /collects\/(video|aweme|item)\/list/i.test(t) && (!id || t.includes(id) || sameCollectsId(id, (t.match(/collects_id=(\d+)/) || [])[1])));
    if (net) return true;
    if (countProgress(readingFolderId, readingFolderName, readingStarted) > 0) return true;
    await sleep(400);
  }
  return false;
}

async function sessionCookie(name) {
  try {
    const list = await session.fromPartition(PARTITION).cookies.get({ domain: ".douyin.com" });
    return list.find((c) => c.name === name)?.value || "";
  } catch {
    return "";
  }
}

async function sessionMsToken() {
  return sessionCookie("msToken");
}

async function pageQuery(win, extra = {}) {
  let tokens = {};
  try {
    tokens = (await win.webContents.executeJavaScript(PAGE_TOKENS_SCRIPT)) || {};
  } catch {
    tokens = {};
  }
  const uifid = tokens.uifid || (await sessionCookie("UIFID")) || (await sessionCookie("UIFID_TEMP"));
  const msToken = tokens.msToken || (await sessionMsToken());
  const webid = tokens.webid || "";
  const fp = tokens.verifyFp || tokens.fp || "";
  if (!uifid) noteHarvest("页面没有 uifid");
  return commonQuery({
    ...extra,
    ...(msToken ? { msToken } : {}),
    ...(uifid ? { uifid } : {}),
    ...(webid ? { webid } : {}),
    ...(fp ? { verifyFp: fp, fp } : {}),
  });
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
          json = parseDouyinJson(data);
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
  const qs = new URLSearchParams(await pageQuery(win, query)).toString();
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
  const qs = new URLSearchParams(await pageQuery(win, query)).toString();
  const pathOnly = String(path).replace(/^https?:\/\/www\.douyin\.com/, "");
  const url = `${pathOnly}?${qs}`;
  try {
    return await win.webContents.executeJavaScript(hookedXhrScript({ method, url, body }), true);
  } catch (err) {
    return { status: 0, json: null, text: String(err?.message || err) };
  }
}

async function netCookieRequest(win, { method = "GET", path, query = {}, body = null }) {
  const qs = new URLSearchParams(await pageQuery(win, query)).toString();
  return sessionRequest(method, `${path}?${qs}`, body);
}

async function nativeFetchRequest(win, { method = "GET", path, query = {}, body = null }) {
  const qs = new URLSearchParams(await pageQuery(win, query)).toString();
  const pathOnly = String(path).replace(/^https?:\/\/www\.douyin\.com/, "");
  const url = `${pathOnly}?${qs}`;
  try {
    return await win.webContents.executeJavaScript(pageFetchScript({ method, url, body }), true);
  } catch (err) {
    return { status: 0, json: null, text: String(err?.message || err) };
  }
}

function noteHarvest(err) {
  lastHarvestError = String(err || "").replace(/\s+/g, " ").slice(0, 96);
}

async function currentHref(win) {
  try {
    return String(await win.webContents.executeJavaScript("location.href") || "");
  } catch {
    return "";
  }
}

async function loadAndWait(win, url) {
  if (!win || win.isDestroyed()) return;
  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        win.webContents.removeListener("did-finish-load", onOk);
        win.webContents.removeListener("did-fail-load", onFail);
      } catch {
        /* ignore */
      }
      resolve();
    };
    const onOk = () => done();
    const onFail = () => done();
    const timer = setTimeout(done, 18000);
    win.webContents.once("did-finish-load", onOk);
    win.webContents.once("did-fail-load", onFail);
    win.loadURL(url, { userAgent: CHROME_UA }).catch(() => done());
  });
  await sleep(600);
}

function pageIsTarget(href, folderName) {
  if (!/\/user\/self/i.test(href || "")) return false;
  if (folderName === "收藏") {
    return /showTab=favorite(?!_collection)/i.test(href) || /showTab=favorite(&|$)/i.test(href);
  }
  return /showSubTab=favorite_folder/i.test(href);
}

async function waitPageReady(win, folderName = "收藏") {
  const target = folderName === "收藏" ? FAVORITE_ALL_URL : FAVORITE_FOLDER_LIST_URL;
  sendReadProgress(folderName === "收藏" ? "收藏" : folderName, "，打开页面");
  let href = await currentHref(win);
  for (let i = 0; i < 16 && !pageIsTarget(href, folderName); i += 1) {
    await sleep(400);
    if (!win || win.isDestroyed()) return;
    href = await currentHref(win);
  }
  if (!pageIsTarget(href, folderName)) {
    await loadAndWait(win, target);
  }
  try {
    await win.webContents.executeJavaScript(HOOK_PAGE_FEEDS_SCRIPT);
  } catch {
    /* ignore */
  }
  try {
    await win.webContents.executeJavaScript(NUDGE_MOUSE_SCRIPT);
  } catch {
    /* ignore */
  }
  try {
    await win.webContents.executeJavaScript(waitBdmsScript());
  } catch {
    /* continue */
  }
}

async function harvestFolderNames(win) {
  send("cangxia:progress", {
    active: true,
    current: 0,
    total: 1,
    message: "正在读取自建收藏夹名单，等收藏夹卡片出现",
  });
  const href = await currentHref(win);
  if (!/showSubTab=favorite_folder/i.test(href)) {
    await win.loadURL(FAVORITE_FOLDER_LIST_URL, { userAgent: CHROME_UA });
    await sleep(4000);
  }
  try {
    await win.webContents.executeJavaScript(HOOK_PAGE_FEEDS_SCRIPT);
  } catch {
    /* ignore */
  }
  try {
    await win.webContents.executeJavaScript(OPEN_FAVORITE_SCRIPT);
  } catch {
    /* ignore */
  }
  await sleep(1200);
  const deadline = Date.now() + 28000;
  const startedAt = Date.now();
  let visible = [];
  let round = 0;
  while (Date.now() < deadline && !refreshStop) {
    round += 1;
    try {
      await win.webContents.executeJavaScript(CLICK_FOLDER_TAB_SCRIPT);
    } catch {
      /* ignore */
    }
    await sleep(round === 1 ? 2200 : 1400);
    await drainPageFeeds(win);
    try {
      visible = await win.webContents.executeJavaScript(LIST_VISIBLE_FOLDERS_SCRIPT);
    } catch {
      visible = [];
    }
    const names = [...new Set((visible || []).filter((n) => validFolderName(n)))];
    const fromApi = folders.filter((f) => !f.isDefault).map((f) => f.name);
    const got = [...new Set([...names, ...fromApi])];
    send("cangxia:progress", {
      active: true,
      current: got.length,
      total: Math.max(1, got.length),
      message: got.length ? `已识别收藏夹：${got.join("、")}` : `等待收藏夹卡片（${Math.round((Date.now() - startedAt) / 1000)}s）`,
    });
    if (got.length) {
      for (const name of got) ensureFolder(name);
      await sleep(600);
      return;
    }
  }
  for (const name of visible || []) {
    if (validFolderName(name)) ensureFolder(name);
  }
}

async function harvestMcp(win, ctx) {
  if (ctx.folderName === "收藏") {
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: ctx.max || 1,
      message: `点「收藏」，拦 listcollection`,
    });
    await mcpClickFavorite(win);
    await sleep(6000);
    readingInside = true;
    const got = await harvestByIntercept(win, ctx);
    if (!got) noteHarvest("拦包0条 listcollection");
    return got;
  }

  send("cangxia:progress", {
    active: true,
    current: 0,
    total: ctx.max || 1,
    message: `打开收藏夹列表，再点「${ctx.folderName}」`,
  });
  const href = await currentHref(win);
  if (!/showSubTab=favorite_folder/i.test(href)) {
    try {
      await win.loadURL(FAVORITE_FOLDER_LIST_URL, { userAgent: CHROME_UA });
      await sleep(2800);
    } catch {
      await mcpClickFavorite(win);
      await sleep(2500);
    }
  }
  try {
    await win.webContents.executeJavaScript(HOOK_PAGE_FEEDS_SCRIPT);
  } catch {
    /* ignore */
  }
  const listReady = await waitFolderListVisible(win, 28000);
  if (!listReady) {
    noteHarvest("没打开收藏夹列表");
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: ctx.max || 1,
      message: "左侧没有「新建收藏夹」，没进收藏夹列表",
    });
    return 0;
  }
  const tab = "list-ready";

  const expectedId = folderIdByName(ctx.folderName);
  readingCollectsId = expectedId || "";
  harvestIdOrder = [];
  readingInside = false;
  seenZeroCursor = true;
  gridOrderOnly = false;
  send("cangxia:progress", {
    active: true,
    current: 0,
    total: ctx.max || 1,
    message: `卡片墙收「${ctx.folderName}」第一包`,
  });
  await waitListPageFirst(win, ctx.folderName, 7000);
  if (!readingCollectsId) {
    const hit = packetsForFolder(ctx.folderName).find((x) => x.feedId);
    if (hit?.feedId) readingCollectsId = String(hit.feedId);
  }
  const first = ingestBufferedFirstPage(ctx.folderName);
  send("cangxia:progress", {
    active: true,
    current: Math.min(first, ctx.max || 1),
    total: ctx.max || 1,
    message: `卡片墙已收「${ctx.folderName}」${first} 条，点进夹继续`,
  });
  if (first >= (ctx.max || 1)) return first;

  let mcpHit = { how: "none" };
  try {
    mcpHit = await win.webContents.executeJavaScript(mcpClickExactNameScript(ctx.folderName));
  } catch {
    mcpHit = { how: "none" };
  }
  if (mcpHit?.how === "mcp" && mcpHit.x) mouseClick(win, mcpHit.x, mcpHit.y);
  const how = await openNamedFolder(win, ctx.folderName, { skipNav: true });

  let inside = false;
  for (let i = 0; i < 8; i += 1) {
    try {
      inside = Boolean((await win.webContents.executeJavaScript(folderInsideScript(ctx.folderName)))?.ok);
    } catch {
      inside = false;
    }
    if (inside) break;
    await sleep(500);
  }
  if (!inside && how === "none" && mcpHit?.how === "none") {
    noteHarvest(`没点进夹 tab=${tab}`);
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: ctx.max || 1,
      message: `没点进「${ctx.folderName}」`,
    });
    return 0;
  }
  if (!inside) {
    noteHarvest("页面不在目标夹");
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: ctx.max || 1,
      message: `页面还不是「${ctx.folderName}」，不读，避免读成别的夹`,
    });
    return 0;
  }

  await scrollGridTop(win);
  await sleep(400);
  try {
    const pageId = await win.webContents.executeJavaScript(PAGE_COLLECTS_ID_SCRIPT);
    if (pageId && (!readingCollectsId || sameCollectsId(pageId, readingCollectsId))) readingCollectsId = String(pageId);
    else if (pageId && !readingCollectsId) readingCollectsId = String(pageId);
  } catch {
    /* ignore */
  }
  if (!readingCollectsId) {
    const fromBuf = feedBuffer.find((f) => f.feedId);
    if (fromBuf?.feedId) readingCollectsId = String(fromBuf.feedId);
  }
  gridOrderOnly = true;
  readingInside = true;
  replayFolderBuffer();
  await drainPageFeeds(win);
  try {
    const fromGrid = await harvestFromGrid(win, ctx);
    return fromGrid || first || 0;
  } finally {
    gridOrderOnly = false;
  }
}

function jsonOk(json) {
  if (!json || typeof json !== "object") return false;
  const code = json.status_code;
  if (code !== undefined && Number(code) !== 0) return false;
  return true;
}

async function harvestVia(win, { folderId, folderName, max, started, label }, doRequest) {
  refreshReading = true;
  lastHarvestError = "";
  const tag = label || "接口";
  if (folderName === "收藏") readingInside = true;

  if (folderName === "收藏") {
    try {
      const listRes = await doRequest(win, {
        method: "GET",
        path: "https://www.douyin.com/aweme/v1/web/collects/list/",
        query: { cursor: "0", count: "40" },
      });
      if (jsonOk(listRes.json)) ingestPayload("https://www.douyin.com/aweme/v1/web/collects/list/", listRes.json);
    } catch {
      /* ignore folder list */
    }
    let cursor = 0;
    for (let page = 0; page < 80; page += 1) {
      if (refreshStop || !win || win.isDestroyed()) return countProgress(folderId, folderName, started);
      if (countProgress(folderId, folderName, started) >= max) return countProgress(folderId, folderName, started);
      send("cangxia:progress", {
        active: true,
        current: Math.min(countProgress(folderId, folderName, started), max),
        total: max,
        message: `${tag} 读「收藏」 ${countProgress(folderId, folderName, started)}/${max}`,
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
        noteHarvest(`${res.status} ${res.json?.status_code ?? ""} ${res.json?.status_msg || res.text || ""}`);
        send("cangxia:progress", {
          active: true,
          current: countProgress(folderId, folderName, started),
          total: max,
          message: `${tag} 收藏接口失败 ${lastHarvestError}`.slice(0, 90),
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

  sendReadProgress(folderName, "，列出收藏夹");
  const listRes = await doRequest(win, {
    method: "GET",
    path: "https://www.douyin.com/aweme/v1/web/collects/list/",
    query: { cursor: "0", count: "40" },
  });
  if (jsonOk(listRes.json)) ingestPayload("https://www.douyin.com/aweme/v1/web/collects/list/", listRes.json);
  else noteHarvest(`list ${listRes.status} ${listRes.json?.status_code ?? ""} ${listRes.json?.status_msg || listRes.text || ""}`);
  const parsed = parseCollectsList(listRes.json);
  for (const item of parsed) ensureFolder(item.name, item.id);
  const hit = parsed.find((x) => x.name === folderName);
  const id = String(hit?.id || readingCollectsId || folderIdByName(folderName) || "");
  if (!id || id.startsWith("folder_")) {
    if (!lastHarvestError) noteHarvest(`没拿到「${folderName}」id`);
    sendReadProgress(folderName);
    await sleep(800);
    return 0;
  }
  readingCollectsId = id;
  readingInside = true;
  let cursor = 0;
  const folderTotal = Number(hit?.count) > 0 ? Number(hit.count) : 0;
  readingFolderTotal = folderTotal;
  const pageSize = 10;
  let emptyStreak = 0;
  let failStreak = 0;
  for (let page = 0; page < 2500; page += 1) {
    await waitWhilePaused();
    if (refreshStop || !win || win.isDestroyed()) return countProgress();
    const got = countProgress();
    if (got >= max) return got;
    if (folderTotal && got >= folderTotal) break;
    sendReadProgress(folderName);
    const url = `https://www.douyin.com/aweme/v1/web/collects/video/list/?collects_id=${id}&cursor=${cursor}`;
    const res = await doRequest(win, {
      method: "GET",
      path: "https://www.douyin.com/aweme/v1/web/collects/video/list/",
      query: { collects_id: id, cursor: String(cursor), count: String(pageSize) },
    });
    if (requestBlocked(res)) {
      failStreak += 1;
      noteHarvest(`${res.status} ${res.json?.status_msg || res.text || "blocked"}`);
      emitCaptcha("refresh");
      sendReadProgress(folderName, "，验证码");
      await waitWhilePaused();
      if (refreshStop) return countProgress();
      await sleep(Math.min(5000, 900 * failStreak));
      page -= 1;
      continue;
    }
    if (!jsonOk(res.json)) {
      failStreak += 1;
      noteHarvest(`${res.status} ${res.json?.status_code ?? ""} ${res.json?.status_msg || res.text || ""}`);
      sendReadProgress(folderName, `，重试 ${failStreak}`);
      if (failStreak >= 8) break;
      await sleep(Math.min(5000, 700 * failStreak));
      page -= 1;
      continue;
    }
    failStreak = 0;
    const before = countProgress();
    const batch = collectAwemes(res.json);
    ingestPayload(url, res.json);
    const grew = countProgress() > before;
    if (!batch.length || !grew) {
      emptyStreak += 1;
      sendReadProgress(folderName, grew ? "" : "，接口没有新作品");
      if (emptyStreak >= 2) break;
      const nextTry = nextCursor(res.json, cursor);
      cursor =
        nextTry.cursor != null && String(nextTry.cursor) !== String(cursor)
          ? nextTry.cursor
          : Number(cursor) + pageSize;
      readingCursor = cursor;
      await sleep(400);
      continue;
    }
    emptyStreak = 0;
    const next = nextCursor(res.json, cursor);
    if (next.cursor != null && String(next.cursor) !== String(cursor)) cursor = next.cursor;
    else cursor = Number(cursor) + Math.max(batch.length, pageSize);
    readingCursor = cursor;
    await sleep(400);
  }
  rankCapturedByCollectTime(folderId);
  return countProgress();
}

async function continueFolderInPage(win, { folderId, folderName, max, started }) {
  const id = String(readingCollectsId || folderIdByName(folderName) || "");
  readingInside = true;
  refreshReading = true;
  sendReadProgress(folderName, "，点进夹卡片");
  const entered = await openNamedFolder(win, folderName, { skipNav: true });
  readingInside = true;
  if (entered !== "in") {
    sendReadProgress(folderName, "，没点进夹，再点一次");
    await openNamedFolder(win, folderName, { skipNav: true });
  }
  const folder = ensureFolder(folderName, id);
  let cursor = readingCursor || countProgress();
  let empty = 0;
  for (let page = 0; page < 3; page += 1) {
    await waitWhilePaused();
    if (refreshStop || !win || win.isDestroyed()) break;
    const before = countProgress();
    if (before >= max || (readingFolderTotal && before >= readingFolderTotal)) break;
    sendReadProgress(folderName, "，页面接口续翻");
    const query = { collects_id: id, cursor: String(cursor), count: "10" };
    let res = await hookedRequest(win, {
      method: "GET",
      path: "https://www.douyin.com/aweme/v1/web/collects/video/list/",
      query,
    });
    if (!jsonOk(res.json) || !collectAwemes(res.json).length) {
      res = await signedRequest(win, {
        method: "GET",
        path: "https://www.douyin.com/aweme/v1/web/collects/video/list/",
        query,
      });
    }
    ingestPayload(
      `https://www.douyin.com/aweme/v1/web/collects/video/list/?collects_id=${id}&cursor=${cursor}`,
      res.json,
    );
    const grew = countProgress() > before;
    const next = nextCursor(res.json, cursor);
    if (next.cursor != null && String(next.cursor) !== String(cursor)) cursor = next.cursor;
    else cursor = Number(cursor) + 10;
    readingCursor = cursor;
    if (!grew) {
      empty += 1;
      if (empty >= 2) break;
    } else empty = 0;
    await sleep(300);
  }
  if (readingFolderTotal && countProgress() >= readingFolderTotal) return countProgress();
  sendReadProgress(folderName, "，夹里滚动");
  return harvestByIntercept(win, { folderId, folderName, max, started, folder });
}

async function harvestByIntercept(win, { folderId, folderName, max, started, folder }) {
  refreshReading = true;
  readingInside = true;
  const target = progressTotal() || max;
  const remain = Math.max(0, (readingFolderTotal || max) - countProgress());
  const deadline = Date.now() + Math.min(20 * 60 * 1000, 120000 + remain * 500);
  const folderRef = folder || ensureFolder(folderName, readingCollectsId);
  sendReadProgress(folderName, "，夹里滚动");
  await drainPageFeeds(win);
  let got = countProgress();
  if (got < max) await waitForNewItems(got, 8000, folderName);
  got = countProgress();
  if (got >= max || (readingFolderTotal && got >= readingFolderTotal)) return got;
  let idle = 0;
  while (win && !win.isDestroyed() && !refreshStop) {
    while (refreshPaused && !refreshStop) await sleep(400);
    if (refreshStop || !win || win.isDestroyed() || Date.now() > deadline) break;
    got = countProgress();
    sendReadProgress(folderName, "，夹里滚动");
    if (got >= max || (readingFolderTotal && got >= readingFolderTotal)) break;
    const before = got;
    const skipBefore = skippedIds.size;
    await drainPageFeeds(win);
    try {
      const cards = await win.webContents.executeJavaScript(GRID_CARDS_SCRIPT);
      for (const card of cards || []) ingestPooledOrCard(card, folderRef);
    } catch {
      /* ignore */
    }
    await wheelBurst(win);
    await drainPageFeeds(win);
    const grew = await waitForNewItems(before, 3500, folderName);
    await drainPageFeeds(win);
    got = countProgress();
    if (got >= max || (readingFolderTotal && got >= readingFolderTotal)) break;
    if (grew || skippedIds.size > skipBefore || got > before) idle = 0;
    else idle += 1;
    const needMore = readingFolderTotal && got < readingFolderTotal;
    if (!needMore && !readingHasMore && idle >= 6) break;
    if (idle >= (needMore ? 40 : 20)) break;
  }
  return countProgress();
}

async function openNamedFolder(win, folderName, { skipNav = false } = {}) {
  sendReadProgress(folderName, skipNav ? "，点进夹" : "，打开收藏夹");
  if (!skipNav) {
    await win.webContents.executeJavaScript(OPEN_FAVORITE_SCRIPT);
    await sleep(2500);
    await win.webContents.executeJavaScript(CLICK_FOLDER_TAB_SCRIPT);
    await sleep(2500);
  }
  sendReadProgress(folderName, "，点进夹");
  await sleep(400);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (refreshStop || !win || win.isDestroyed()) return "none";
    let inside = { ok: false };
    try {
      inside = await win.webContents.executeJavaScript(folderInsideScript(folderName));
    } catch {
      inside = { ok: false };
    }
    if (inside?.ok) return "in";
    let clicked = "none";
    try {
      clicked = await win.webContents.executeJavaScript(clickFolderCardScript(folderName));
    } catch {
      clicked = "none";
    }
    if (clicked === "none") {
      try {
        const mcp = await win.webContents.executeJavaScript(mcpClickExactNameScript(folderName));
        if (mcp?.how && mcp.how !== "none") {
          clicked = "mcp";
          if (mcp.x) mouseClick(win, mcp.x, mcp.y);
        }
      } catch {
        /* ignore */
      }
    }
    if (clicked === "none") {
      try {
        clicked = await win.webContents.executeJavaScript(clickFolderSideScript(folderName));
      } catch {
        clicked = "none";
      }
    }
    sendReadProgress(folderName, clicked && clicked !== "none" ? `，${String(clicked).slice(0, 24)}` : "，找卡片");
    let loc = { how: "none", x: 0, y: 0 };
    try {
      loc = await win.webContents.executeJavaScript(locateFolderCardScript(folderName));
    } catch {
      loc = { how: "none", x: 0, y: 0 };
    }
    if (loc?.how && loc.how !== "none" && loc.x) mouseClick(win, loc.x, loc.y);
    await sleep(1400);
  }
  return "none";
}

async function scrollUntilCap(win, { folderId, folderName, max, started }) {
  harvestIdOrder = [];
  readingHasMore = true;
  seenThisRead = new Set();
  readingCollectsId = folderName === "收藏" ? "" : folderIdByName(folderName);
  readingInside = folderName === "收藏";
  refreshReading = true;
  lastHarvestMethod = "";
  lastHarvestCount = 0;
  netTrace = [];
  readingFolderTotal = 0;
  readingCursor = 0;
  const ctx = { folderId, folderName, max, started, label: "" };
  if (folderName !== "收藏") {
    sendReadProgress(folderName);
    await waitPageReady(win, folderName);
    let added = await harvestVia(win, { ...ctx, label: "接口" }, signedRequest);
    const total = readingFolderTotal || 0;
    if (added > 0 && total && added < total && !refreshStop && win && !win.isDestroyed()) {
      sendReadProgress(folderName, "，接口停了接着翻");
      added = await continueFolderInPage(win, { folderId, folderName, max, started });
    }
    lastHarvestCount = added;
    lastHarvestMethod = added
      ? total && added < total
        ? `读到${added}/${total}条，未读完`
        : total
          ? `读完${added}条`
          : `读到${added}条`
      : lastHarvestError
        ? `接口没过(${lastHarvestError})`
        : "接口没过";
    rankCapturedByCollectTime(folderId);
    send("cangxia:progress", {
      active: true,
      current: added,
      total: Math.max(total || added, 1),
      message: lastHarvestMethod,
    });
    return;
  }
  const steps = [
    ["页面fetch", () => harvestVia(win, ctx, signedRequest)],
    ["拦页面", () => harvestMcp(win, ctx)],
  ];
  const tried = [];
  const addedSince = (before) => {
    let n = 0;
    for (const [id, work] of captured) {
      if (before.has(id)) continue;
      if (folderName === "收藏") n += 1;
      else if (work.folderId === folderId || work.folderId === readingCollectsId) n += 1;
      else {
        const f = folders.find((x) => x.name === folderName);
        if (f && work.folderId === f.id) n += 1;
      }
    }
    return n;
  };
  try {
    await waitPageReady(win, folderName);
    for (let i = 0; i < steps.length; i += 1) {
      const [label, run] = steps[i];
      if (refreshStop || !win || win.isDestroyed()) {
        lastHarvestMethod = tried.length ? `${tried.join(" → ")}，中途停止` : "中途停止";
        return;
      }
      ctx.label = label;
      send("cangxia:progress", {
        active: true,
        current: countProgress(folderId, folderName, started),
        total: max,
        message: tried.length
          ? `${tried.join(" → ")} → 正在用 ${label} 读「${folderName}」`
          : `正在用 ${label} 读「${folderName}」`,
      });
      lastHarvestError = "";
      const before = new Set(captured.keys());
      await run();
      const added = addedSince(before);
      const got = countProgress(folderId, folderName, started);
      if (added > 0) {
        tried.push(`${label} 读到${added}条`);
        lastHarvestMethod = tried.join(" → ");
        lastHarvestCount = got;
        send("cangxia:progress", {
          active: true,
          current: Math.min(got, max),
          total: max,
          message: lastHarvestMethod,
        });
        if (got >= max || refreshStop) return;
        const next = steps[i + 1];
        if (!next) return;
        send("cangxia:progress", {
          active: true,
          current: Math.min(got, max),
          total: max,
          message: `${lastHarvestMethod} → 不够 ${max}，接着${next[0]}`,
        });
        await sleep(600);
        continue;
      }
      tried.push(lastHarvestError ? `${label} 没过(${lastHarvestError})` : `${label} 没过`);
      lastHarvestMethod = tried.join(" → ");
      const next = steps[i + 1];
      if (!next) break;
      send("cangxia:progress", {
        active: true,
        current: 0,
        total: max,
        message: `${lastHarvestMethod} → 改试 ${next[0]}`,
      });
      await sleep(1400);
    }
    lastHarvestMethod = `${tried.join(" → ")}，都没读到`;
    lastHarvestCount = 0;
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: max,
      message: lastHarvestMethod,
    });
  } catch (err) {
    lastHarvestMethod = `${tried.join(" → ")}${tried.length ? " → " : ""}出错：${String(err?.message || err)}`.slice(0, 120);
    lastHarvestCount = 0;
    send("cangxia:progress", {
      active: true,
      current: 0,
      total: max,
      message: lastHarvestMethod,
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

function openDouyinWindow(path = "https://www.douyin.com/", { assistQr = false, forRefresh = false, deferLoad = false } = {}) {
  const width = forRefresh ? 1320 : assistQr ? 560 : 1100;
  if (douyinWindow && !douyinWindow.isDestroyed()) {
    if (assistQr) douyinWindow.hide();
    else {
      douyinWindow.setSize(width, 820);
      douyinWindow.show();
      douyinWindow.focus();
    }
    if (!deferLoad) void douyinWindow.loadURL(path, { userAgent: CHROME_UA });
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
      void douyinWindow.webContents.executeJavaScript(HOOK_PAGE_FEEDS_SCRIPT).catch(() => {});
      void douyinWindow.webContents.executeJavaScript(installFolderWatchScript(folders.map((f) => f.name))).catch(() => {});
    }
  });
  if (!deferLoad) void douyinWindow.loadURL(path, { userAgent: CHROME_UA });
  douyinWindow.webContents.on("render-process-gone", (_e, details) => {
    noteHarvest(`页面崩溃 ${details?.reason || ""}`);
  });
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

ipcMain.handle("cangxia:paths", async () => {
  const listFile = settings.rootPath ? join(settings.rootPath, ".cangxia", "works.json") : "";
  return {
    userData: app.getPath("userData"),
    appName: app.getName(),
    listFile,
  };
});

ipcMain.handle("cangxia:save-list", async (_e, payload = {}) => {
  const root = String(settings.rootPath || "").trim();
  if (!root) return { ok: false, error: "no-root" };
  const dir = join(root, ".cangxia");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "works.json");
  await writeFile(
    file,
    JSON.stringify(
      {
        works: payload.works || [],
        folders: payload.folders || [],
        hiddenCollectIds: payload.hiddenCollectIds || [],
        chosenFolderIds: payload.chosenFolderIds || [],
      },
      null,
      2,
    ),
    "utf8",
  );
  return { ok: true, path: file };
});

ipcMain.handle("cangxia:open-list-file", async () => {
  const file = settings.rootPath ? join(settings.rootPath, ".cangxia", "works.json") : "";
  if (!file) return { ok: false };
  await shell.showItemInFolder(file);
  return { ok: true };
});

ipcMain.handle("cangxia:file-status", async (_e, ids = []) => {
  const root = String(settings.rootPath || "").trim();
  if (!root) return { present: [] };
  const index = await readIndex(root);
  const recs = new Map((index.records || []).map((r) => [String(r.id), r]));
  const present = [];
  for (const raw of ids) {
    const id = String(raw || "");
    if (!id) continue;
    const dir = recs.get(id)?.dir;
    if (dir && (await exists(dir))) present.push(id);
  }
  return { present };
});

ipcMain.handle("cangxia:refresh", async (_e, opts = {}) => {
  captured.clear();
  seenThisRead.clear();
  awemePool.clear();
  harvestIdOrder = [];
  const folderName = String(opts.folderName || "收藏").trim() || "收藏";
  const fullFolder = Boolean(opts.fullFolder) && folderName !== "收藏";
  knownSkip = fullFolder ? new Set() : new Set((opts.knownIds || []).map((id) => String(id)));
  skippedIds = new Set();
  refreshStop = false;
  refreshPaused = false;
  const max = fullFolder ? 50000 : Math.max(1, Number(opts.max) || Number(settings.maxPerRefresh) || 20);
  const startUrl = folderName === "收藏" ? FAVORITE_ALL_URL : FAVORITE_FOLDER_LIST_URL;
  refreshReading = true;
  readingFolderName = folderName;
  readingPattern = folderName === "收藏" ? "listcollection" : "collects/video/list";
  readingInside = folderName === "收藏";
  feedBuffer = [];
  const win = openDouyinWindow(startUrl, { forRefresh: true, deferLoad: true });
  openProgressWindow();
  send("cangxia:progress", {
    active: true,
    current: 0,
    total: fullFolder ? 0 : max,
    message: fullFolder ? `全部读取「${folderName}」进清单` : `已开始监听「${folderName}」，本次新增 ${max} 条`,
  });
  void (async () => {
    let failed = "";
    try {
      await Promise.race([attachNetwork(win), sleep(1500)]);
      if (win && !win.isDestroyed()) {
        await loadAndWait(win, startUrl);
      }
      const folder = ensureFolder(folderName);
      readingFolderId = folder.id;
      readingMax = max;
      readingStarted = 0;
      readingOrder =
        folderName === "收藏"
          ? Math.max(0, Number(opts.startAllIndex) || 0)
          : 0;
      readingOrderStart = readingOrder;
      harvestIdOrder = [];
      seenThisRead.clear();
      seenZeroCursor = folderName === "收藏";
      refreshReading = true;
      await scrollUntilCap(win, {
        folderId: folder.id,
        folderName,
        max,
        started: readingStarted,
      });
    } catch (err) {
      failed = String(err?.message || err);
      noteHarvest(failed);
      lastHarvestMethod = `页面出错：${failed}`.slice(0, 120);
      send("cangxia:progress", {
        active: true,
        current: countProgress(),
        total: progressTotal(),
        message: lastHarvestMethod,
      });
      await sleep(5000);
    } finally {
      await completeRefresh();
      if (!failed && win && !win.isDestroyed()) win.close();
    }
  })();
  return { ok: true, waiting: true };
});

ipcMain.handle("cangxia:list-folders", async () => {
  refreshStop = false;
  refreshPaused = false;
  const win = openDouyinWindow(FAVORITE_FOLDER_LIST_URL, { forRefresh: true });
  void attachNetwork(win);
  openProgressWindow();
  send("cangxia:progress", {
    active: true,
    current: 0,
    total: 1,
    message: "正在读取自建收藏夹名单，还不导入",
  });
  void (async () => {
    try {
      folders = folders.filter((f) => f.isDefault);
      refreshReading = true;
      readingFolderName = "";
      await waitPageReady(win, "雷电将军");
      await harvestFolderNames(win);
      const list = folders
        .filter((f) => !f.isDefault)
        .map((f) => ({ id: f.id, name: f.name }));
      send("cangxia:folder-pick", { folders: list });
      lastHarvestMethod = list.length ? `读到 ${list.length} 个收藏夹，请勾选` : "没读到自建收藏夹";
      lastHarvestCount = list.length;
    } finally {
      refreshReading = false;
      closeProgressWindow();
      send("cangxia:progress", { active: false, current: 0, total: 0, message: "" });
      if (win && !win.isDestroyed()) win.close();
    }
  })();
  return { ok: true, waiting: true };
});

ipcMain.handle("cangxia:move-works", async (_e, payload = {}) => {
  const rootPath = settings.rootPath;
  if (!rootPath) return { ok: false, error: "未选择下载根目录" };
  const items = Array.isArray(payload.works) ? payload.works : [];
  for (const item of items) {
    try {
      await relocateWorkFolder(rootPath, item);
    } catch {
      /* keep going */
    }
  }
  return { ok: true };
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
        urls: img.urls || [img.url],
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
  attachCdnReferer(session.defaultSession);
  attachCdnReferer(douyinSession());
  app.on("web-contents-created", (_e, contents) => hardenContents(contents));
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
