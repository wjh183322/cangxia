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

export function dyApiScript({ method = "GET", path, query = {}, body = null }) {
  return `(() => new Promise((resolve) => {
    const qs = new URLSearchParams(${JSON.stringify(query)});
    const url = ${JSON.stringify(path)} + "?" + qs.toString();
    const xhr = new XMLHttpRequest();
    xhr.open(${JSON.stringify(method)}, url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json, text/plain, */*");
    ${method === "POST" ? 'xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");' : ""}
    const done = (status, text) => {
      let json = null;
      try { json = JSON.parse(text); } catch {}
      resolve({ status, json, text: String(text || "").slice(0, 240) });
    };
    xhr.onload = () => done(xhr.status, xhr.responseText);
    xhr.onerror = () => done(0, "error");
    xhr.ontimeout = () => done(0, "timeout");
    xhr.timeout = 18000;
    xhr.send(${body == null ? "null" : JSON.stringify(String(body))});
  }))()`;
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
