export function parseDouyinJson(text) {
  const src = String(text || "").trim();
  if (!src) return null;
  const quoted = src.replace(/([:\[,])\s*(\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
  try {
    return JSON.parse(quoted);
  } catch {
    try {
      return JSON.parse(src);
    } catch {
      return null;
    }
  }
}

export function sameCollectsId(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < 15 || y.length < 15) return false;
  return x.slice(0, 15) === y.slice(0, 15);
}

export function requestCursor(url, post = "") {
  const s = `${url}\n${post}`;
  const m = s.match(/[?&](?:cursor|max_cursor)=(\d+)/i) || s.match(/["']?(?:cursor|max_cursor)["']?\s*[:=]\s*["']?(\d+)/i);
  return m ? String(m[1]) : "";
}

export function isZeroCursor(url, post = "") {
  const c = requestCursor(url, post);
  return !c || c === "0";
}

export function commonQuery(extra = {}) {
  return {
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    publish_video_strategy_type: "2",
    pc_client_type: "1",
    pc_libra_divert: "Windows",
    version_code: "170400",
    version_name: "17.4.0",
    cookie_enabled: "true",
    screen_width: "1920",
    screen_height: "1080",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Chrome",
    browser_version: "131.0.0.0",
    browser_online: "true",
    engine_name: "Blink",
    engine_version: "131.0.0.0",
    os_name: "Windows",
    os_version: "10",
    cpu_core_num: "8",
    device_memory: "8",
    platform: "PC",
    downlink: "10",
    effective_type: "4g",
    round_trip_time: "50",
    ...extra,
  };
}

export const PAGE_TOKENS_SCRIPT = `(() => {
  const cookie = document.cookie || "";
  const pick = (n) => {
    const hit = cookie.split(";").map((x) => x.trim()).find((x) => x.startsWith(n + "="));
    return hit ? decodeURIComponent(hit.slice(n.length + 1)) : "";
  };
  let webid = pick("s_v_web_id");
  try {
    const raw = localStorage.getItem("webId") || "";
    if (raw && !webid) webid = String(JSON.parse(raw) || raw);
  } catch {}
  const fp = pick("s_v_web_id");
  const uifid = String(window._secsdk_uifid || pick("UIFID") || pick("UIFID_TEMP") || "");
  return {
    uifid,
    webid: String(webid || ""),
    verifyFp: fp,
    fp,
    msToken: pick("msToken"),
  };
})()`;

export const HOOK_PAGE_FEEDS_SCRIPT = `(() => {
  if (window.__cxFetchHook) return "already";
  window.__cxFetchHook = true;
  window.__cxFeeds = [];
  const push = (url, text) => {
    const u = String(url || "");
    if (!/aweme\/v1\/web|collect|favorite|listcollection/i.test(u)) return;
    window.__cxFeeds.push({ url: u, text: String(text || "").slice(0, 800000) });
    if (window.__cxFeeds.length > 30) window.__cxFeeds.shift();
  };
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const res = await origFetch(...args);
    try {
      const url = String((args[0] && args[0].url) || args[0] || "");
      const clone = res.clone();
      push(url, await clone.text());
    } catch {}
    return res;
  };
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__cxUrl = url;
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try { push(this.__cxUrl, this.responseText); } catch {}
    });
    return send.apply(this, args);
  };
  return "hooked";
})()`;

export const DRAIN_PAGE_FEEDS_SCRIPT = `(() => {
  const out = window.__cxFeeds || [];
  window.__cxFeeds = [];
  return out.map((x) => ({ url: String(x.url || ""), text: String(x.text || "") }));
})()`;

export const LIST_COLLECT_URLS_SCRIPT = `(() => {
  try {
    return performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /collect/i.test(n)).slice(-8);
  } catch {
    return [];
  }
})()`;

export function waitBdmsScript() {
  return `(() => new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (window.bdms || Date.now() - t0 > 12000) {
        resolve({ bdms: Boolean(window.bdms), ms: Date.now() - t0 });
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  }))()`;
}

export function signUrlScript(method, url) {
  return `(() => {
    const full = ${JSON.stringify(url)};
    window.a_bogus = "";
    try {
      const xhr = new XMLHttpRequest();
      xhr.bdmsInvokeList = [
        { args: [${JSON.stringify(method)}, full, true], func: function () {} },
        { args: ["Accept", "application/json, text/plain, */*"], func: function () {} },
        { args: ["bd-ticket-guard-web-version", 2], func: function () {} },
        { args: ["bd-ticket-guard-version", 2], func: function () {} },
        { args: ["bd-ticket-guard-iteration-version", 1], func: function () {} },
      ];
      xhr.invokeList = [
        { name: "addEventListener", args: ["load", null] },
        { name: "addEventListener", args: ["error", null] },
      ];
      xhr.send(null);
    } catch (e) {}
    return window.a_bogus || "";
  })()`;
}

export const NUDGE_MOUSE_SCRIPT = `(() => {
  for (const type of ["mousemove", "mousedown", "mouseup", "click"]) {
    document.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 420, clientY: 280, view: window }));
  }
  return true;
})()`;

export function hookedXhrScript({ method = "GET", url, body = null }) {
  return `(() => new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.open(${JSON.stringify(method)}, ${JSON.stringify(url)}, true);
    xhr.setRequestHeader("Accept", "application/json, text/plain, */*");
    ${method === "POST" ? 'xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");' : ""}
    xhr.timeout = 18000;
    xhr.onload = () => {
      let json = null;
      try { json = JSON.parse(String(xhr.responseText || "").replace(/([:\\[,])\\s*(\\d{16,})(?=\\s*[,\\}\\]])/g, '$1"$2"')); } catch { try { json = JSON.parse(xhr.responseText); } catch {} }
      resolve({ status: xhr.status, json, text: String(xhr.responseText || "").slice(0, 220) });
    };
    xhr.onerror = () => resolve({ status: 0, json: null, text: "xhr-error" });
    xhr.ontimeout = () => resolve({ status: 0, json: null, text: "timeout" });
    xhr.send(${body == null ? "null" : JSON.stringify(String(body))});
  }))()`;
}

export function pageFetchScript({ method = "GET", url, body = null }) {
  return `(() => fetch(${JSON.stringify(url)}, {
    method: ${JSON.stringify(method)},
    credentials: "include",
    headers: {
      Accept: "application/json, text/plain, */*"${method === "POST" ? ',\n      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"' : ""}
    }${body == null ? "" : `,\n    body: ${JSON.stringify(String(body))}`}
  }).then(async (r) => {
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(String(text || "").replace(/([:\\[,])\\s*(\\d{16,})(?=\\s*[,\\}\\]])/g, '$1"$2"')); } catch { try { json = JSON.parse(text); } catch {} }
    return { status: r.status, json, text: String(text || "").slice(0, 220) };
  }).catch((e) => ({ status: 0, json: null, text: String(e) })))()`;
}

export function parseCollectsList(json) {
  if (!json || typeof json !== "object") return [];
  const data = json.data && typeof json.data === "object" ? json.data : json;
  const list = data.collects_list || data.list || json.collects_list || [];
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => ({
      id: String(raw.collects_id_str || raw.collects_id || raw.collection_id || raw.id || ""),
      name: String(raw.collects_name || raw.name || raw.title || "").trim(),
      count: Number(raw.total_number || raw.count || 0),
    }))
    .filter((x) => x.id && x.name);
}

export function nextCursor(json, prev) {
  if (!json || typeof json !== "object") return { cursor: prev, hasMore: false };
  const data = json.data && typeof json.data === "object" && !Array.isArray(json.data) ? json.data : json;
  const cursor = data.cursor ?? json.cursor ?? prev;
  const hasMore = Boolean(Number(data.has_more ?? json.has_more ?? 0));
  return { cursor, hasMore };
}
