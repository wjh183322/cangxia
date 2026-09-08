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
    try { json = JSON.parse(text); } catch {}
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
      id: String(raw.collects_id || raw.collection_id || raw.id || ""),
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
