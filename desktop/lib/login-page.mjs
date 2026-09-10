export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36";

export const APP_SCHEMES = [
  "bytedance",
  "snssdk",
  "snssdk1128",
  "snssdk2329",
  "aweme",
  "douyin",
  "douyinlite",
];

export function isHttpUrl(url) {
  return /^https?:/i.test(url || "") || url === "about:blank";
}

export const LOGIN_PAGE_SCRIPT = `(() => {
  if (window.__cangxiaLogin) return "already";
  window.__cangxiaLogin = true;

  const bad = (u) => typeof u === "string" && /^(bytedance|snssdk|aweme|douyinlite|douyin):/i.test(u);
  const open = window.open.bind(window);
  window.open = (url, ...rest) => (bad(url) ? null : open(url, ...rest));
  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest && e.target.closest("a");
    const href = a && (a.getAttribute("href") || a.href || "");
    if (bad(href)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  const textOf = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, "");
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 6 && r.height > 6 && r.top < innerHeight && r.bottom > 0;
  };
  const hasQr = () =>
    Boolean(
      document.querySelector(
        "img[src*='qrcode'], img[src*='qr'], canvas, [class*='qrcode' i], [class*='qr-code' i], [class*='qrCode']",
      ),
    );

  function pickExact(label, headerOnly) {
    const nodes = document.querySelectorAll("button, a, span, div, p, li");
    for (const el of nodes) {
      if (!vis(el) || textOf(el) !== label || el.childElementCount > 3) continue;
      const r = el.getBoundingClientRect();
      if (headerOnly && (r.top > 96 || r.right < innerWidth * 0.55)) continue;
      return el;
    }
    return null;
  }

  function tick() {
    if (hasQr()) return "has-qr";
    const qrTab = pickExact("扫码登录") || pickExact("二维码登录");
    if (qrTab) {
      qrTab.click();
      return "qr-tab";
    }
    const login = pickExact("登录", true) || pickExact("登录");
    if (login) {
      login.click();
      return "login";
    }
    return "none";
  }

  tick();
  const obs = new MutationObserver(() => tick());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  const timer = setInterval(tick, 900);
  setTimeout(() => {
    obs.disconnect();
    clearInterval(timer);
  }, 50000);
  return "hooked";
})()`;

export const EXTRACT_QR_SCRIPT = `(() => {
  function nearScan(el) {
    let p = el;
    for (let i = 0; i < 10 && p; i += 1) {
      const t = (p.innerText || "") + " " + (p.className || "");
      if (/扫码登录|二维码登录|打开.{0,6}抖音APP|扫一扫/.test(t) || /qrcode|qr-code|qrCode/i.test(t)) return true;
      p = p.parentElement;
    }
    return false;
  }

  function looksNamed(el) {
    const blob = ((el.src || "") + " " + (el.className || "") + " " + (el.alt || "") + " " + (el.id || "")).toLowerCase();
    return /qrcode|qr-code|qrcode_|\\/qr\\/|passport.{0,40}qr/.test(blob);
  }

  function mostlyMono(canvas) {
    try {
      const ctx = canvas.getContext("2d");
      const { data, width, height } = ctx.getImageData(0, 0, Math.min(width, 240), Math.min(height, 240));
      let colorful = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 32) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 80) continue;
        n += 1;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 48) colorful += 1;
      }
      return n > 40 && colorful / n < 0.18;
    } catch {
      return false;
    }
  }

  function toSrc(el, doc) {
    if (el.tagName === "IMG") {
      const src = el.src || "";
      if (src.startsWith("data:") || src.startsWith("blob:") || /qrcode|\\/qr/i.test(src)) return src;
      try {
        const c = doc.createElement("canvas");
        c.width = el.naturalWidth || 240;
        c.height = el.naturalHeight || 240;
        c.getContext("2d").drawImage(el, 0, 0);
        if (!mostlyMono(c)) return null;
        return c.toDataURL("image/png");
      } catch {
        return src.startsWith("http") ? src : null;
      }
    }
    if (el.tagName === "CANVAS") {
      if (!mostlyMono(el)) return null;
      try {
        return el.toDataURL("image/png");
      } catch {
        return null;
      }
    }
    return null;
  }

  function grab(doc) {
    if (!doc) return null;
    const nodes = [...doc.querySelectorAll("img, canvas")];
    const ranked = nodes.filter((el) => {
      const w = el.naturalWidth || el.width || 0;
      const h = el.naturalHeight || el.height || 0;
      if (w < 100 || h < 100) return false;
      return looksNamed(el) || nearScan(el);
    });
    for (const el of ranked) {
      const src = toSrc(el, doc);
      if (src) return src;
    }
    return null;
  }

  let data = grab(document);
  if (data) return data;
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      data = grab(frame.contentDocument);
      if (data) return data;
    } catch {
      /* cross origin */
    }
  }
  return null;
})()`;

export const OPEN_FAVORITE_SCRIPT = `(() => {
  const textOf = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, "");
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && r.top > 36 && r.top < 620 && r.bottom > 0;
  };
  const nodes = [...document.querySelectorAll("span, div, a, button, p, li")];
  const fav = nodes.find((el) => vis(el) && el.childElementCount <= 5 && textOf(el) === "收藏");
  if (!fav) return "none";
  (fav.closest("a, button, [role='tab']") || fav).click();
  return "clicked";
})()`;

export const FAVORITE_ALL_URL = "https://www.douyin.com/user/self?from_tab_name=main&showTab=favorite";
export const FAVORITE_FOLDER_LIST_URL =
  "https://www.douyin.com/user/self?from_tab_name=main&showTab=favorite_collection&showSubTab=favorite_folder";

export const CLICK_FOLDER_TAB_SCRIPT = `(() => {
  const textOf = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, "");
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && r.width < 220 && r.height < 64;
  };
  const nodes = [...document.querySelectorAll("span, div, a, button, p, li, [role='tab']")];
  const video = nodes.find((el) => vis(el) && textOf(el) === "视频" && el.childElementCount <= 4);
  const vr = video ? video.getBoundingClientRect() : null;
  const hits = nodes.filter((el) => {
    if (!vis(el) || textOf(el) !== "收藏夹" || el.childElementCount > 6) return false;
    const r = el.getBoundingClientRect();
    if (vr && Math.abs(r.top - vr.top) < 44) return true;
    if (!vr && r.top > 140 && r.top < 520 && r.left < 760) return true;
    return false;
  });
  hits.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  if (hits[0]) {
    (hits[0].closest("a, button, [role='tab']") || hits[0]).click();
    return "clicked-text";
  }
  const byId = document.querySelector("#semiTabfavorite_collection") || document.querySelector("[id*='favorite_collection']");
  if (byId) {
    byId.click();
    return "clicked-id";
  }
  return "none";
})()`;

export const FOLDER_LIST_READY_SCRIPT = `(() => {
  const textOf = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, "");
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight;
  };
  const hasNew = [...document.querySelectorAll("span, div, button, a, p")].some((el) => vis(el) && textOf(el).includes("新建收藏夹"));
  const cards = [...document.querySelectorAll("div, section, a, li")].filter((el) => {
    const t = textOf(el);
    return vis(el) && /共\\d+作品/.test(t) && t.length < 48;
  });
  return Boolean(hasNew && cards.length >= 1);
})()`;

export const LOCATE_FOLDER_TAB_SCRIPT = `(() => {
  const textOf = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, "");
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && r.width < 220 && r.height < 64;
  };
  const nodes = [...document.querySelectorAll("span, div, a, button, p, li, [role='tab']")];
  const video = nodes.find((el) => vis(el) && textOf(el) === "视频" && el.childElementCount <= 4);
  const vr = video ? video.getBoundingClientRect() : null;
  const hits = nodes.filter((el) => vis(el) && textOf(el) === "收藏夹" && el.childElementCount <= 6);
  const row = hits.find((el) => {
    const r = el.getBoundingClientRect();
    return vr ? Math.abs(r.top - vr.top) < 44 : r.top > 140 && r.top < 520;
  }) || hits[0];
  if (!row) return { x: 0, y: 0 };
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

export function normalizeFolderText(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[^\u4e00-\u9fff0-9a-zA-Z]/g, "");
}

export function isFolderCardText(text, name) {
  const t = normalizeFolderText(text);
  const n = normalizeFolderText(name);
  return Boolean(n) && t.includes(`${n}共`) && /共\d+作品/.test(t);
}

const FOLDER_TEXT_HELPER = `const norm = (s) => String(s || "").replace(/\\s+/g, "").replace(/[^\\u4e00-\\u9fff0-9a-zA-Z]/g, "");
    const textOf = (el) => norm(el.innerText || el.textContent || "");`;

export function validFolderName(name) {
  const n = String(name || "").trim();
  if (!n || n.length > 16) return false;
  if (/^\d+$/.test(n)) return false;
  if (
    /收藏夹|视频|音乐|合集|短剧|新建|添加视频|批量管理|返回|观看历史|稍后再看|我的预约|粉丝|关注|作品|获赞|推荐|精选|直播|抖音号|许可证|备案|京ICP|ICP备|信息网络|节目许可/.test(
      n,
    )
  ) {
    return false;
  }
  return true;
}

export function mcpClickExactNameScript(name) {
  return `(() => {
    const want = ${JSON.stringify(name)};
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight;
    };
    const textOf = (el) => (el.innerText || "").replace(/\\s+/g, " ").trim();
    const nodes = [...document.querySelectorAll("span, div, p, a, li")];
    for (const el of nodes) {
      if (!vis(el) || el.childElementCount > 8) continue;
      const t = textOf(el);
      if (t !== want) continue;
      const r = el.getBoundingClientRect();
      (el.closest("a, button, [role='button'], li") || el).click();
      return { how: "mcp", x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    return { how: "none", x: 0, y: 0 };
  })()`;
}

export function clickFolderSideScript(name) {
  return `(() => {
    const want = ${JSON.stringify(name)};
    ${FOLDER_TEXT_HELPER}
    const nw = norm(want);
    const hits = [];
    for (const el of document.querySelectorAll("div, a, li, span, p, button")) {
      const r = el.getBoundingClientRect();
      if (r.left > 520 || r.top < 70 || r.bottom > innerHeight - 4) continue;
      if (r.width < 48 || r.width > 520 || r.height < 20 || r.height > 110) continue;
      const t = textOf(el);
      if (!t || t.length > 28) continue;
      const rest = t.startsWith(nw) ? t.slice(nw.length) : "";
      if (t === nw || (rest && (/^\\d/.test(rest) || rest.startsWith("共")))) {
        hits.push({ el, t, len: t.length, x: Math.round(r.left + Math.min(36, r.width / 2)), y: Math.round(r.top + r.height / 2) });
      }
    }
    hits.sort((a, b) => a.len - b.len);
    if (!hits[0]) return "none";
    (hits[0].el.closest("a, button, li, [role='button']") || hits[0].el).click();
    return "side:" + hits[0].t.slice(0, 20);
  })()`;
}

export function clickOtherFolderScript(exceptName) {
  return `(() => {
    const skip = ${JSON.stringify(exceptName)};
    ${FOLDER_TEXT_HELPER}
    const hits = [];
    for (const el of document.querySelectorAll("div, a, li, span, p, button")) {
      const r = el.getBoundingClientRect();
      if (r.left > 520 || r.top < 70 || r.bottom > innerHeight - 4) continue;
      if (r.width < 48 || r.width > 520 || r.height < 20 || r.height > 110) continue;
      const t = textOf(el);
      if (!t || t.length > 28) continue;
      const name = norm(t).replace(/\\d+$/g, "").replace(/共.*$/, "").trim();
      if (!name || name === skip || name === "收藏" || name === "新建收藏夹" || name === "收藏夹") continue;
      hits.push({ el, name, y: r.top });
    }
    hits.sort((a, b) => a.y - b.y);
    if (!hits[0]) return "none";
    (hits[0].el.closest("a, button, li, [role='button']") || hits[0].el).click();
    return "other:" + hits[0].name;
  })()`;
}

export function clickFolderCardScript(name) {
  return `(() => {
    const want = ${JSON.stringify(name)};
    ${FOLDER_TEXT_HELPER}
    const nw = norm(want);
    const nodes = [...document.querySelectorAll("div, a, span, li, section")];
    const cards = nodes.filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 140 || r.height < 80 || r.width > 900 || r.height > 900) return false;
      if (r.bottom < 80 || r.top > innerHeight - 8) return false;
      const t = textOf(el);
      if (t.length > 120) return false;
      return t.includes(nw) && /共\\d+作品/.test(t);
    });
    cards.sort((a, b) => textOf(a).length - textOf(b).length);
    if (cards[0]) {
      const r = cards[0].getBoundingClientRect();
      (cards[0].closest("a, button, [role='button']") || cards[0]).click();
      return "card:" + textOf(cards[0]).slice(0, 24) + "@" + Math.round(r.left) + "," + Math.round(r.top);
    }
    const rows = nodes.filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 48 || r.height < 16 || r.height > 120) return false;
      const t = textOf(el);
      return t === nw || t.startsWith(nw);
    });
    rows.sort((a, b) => textOf(a).length - textOf(b).length);
    if (rows[0]) {
      (rows[0].closest("a, button, li, [role='button']") || rows[0]).click();
      return "row:" + textOf(rows[0]);
    }
    return "none";
  })()`;
}

export function locateFolderCardScript(name) {
  return `(() => {
    const want = ${JSON.stringify(name)};
    ${FOLDER_TEXT_HELPER}
    const nw = norm(want);
    const hits = [];
    for (const el of document.querySelectorAll("div, a, li, section")) {
      const r = el.getBoundingClientRect();
      if (r.width < 140 || r.height < 80 || r.width > 900 || r.height > 900) continue;
      if (r.bottom < 80 || r.top > innerHeight - 16) continue;
      const t = textOf(el);
      if (t.length > 120) continue;
      if (t.includes(nw) && /共\\d+作品/.test(t)) {
        hits.push({
          how: "card",
          x: Math.round(r.left + Math.min(90, r.width * 0.28)),
          y: Math.round(r.top + Math.min(70, r.height * 0.22)),
          len: t.length,
          area: r.width * r.height,
        });
      }
    }
    hits.sort((a, b) => a.len - b.len || a.area - b.area);
    if (hits[0]) return hits[0];
    for (const el of document.querySelectorAll("div, a, li, span")) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 18 || r.height > 96) continue;
      const t = textOf(el);
      if (t === nw || t.startsWith(nw + "共")) {
        return { how: "row", x: Math.round(r.left + Math.min(48, r.width / 2)), y: Math.round(r.top + r.height / 2), len: t.length };
      }
    }
    return { how: "none", x: 0, y: 0 };
  })()`;
}

export function folderInsideScript(name) {
  return `(() => {
    const want = ${JSON.stringify(name)};
    ${FOLDER_TEXT_HELPER}
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight;
    };
    const raw = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, "");
    const has = (label) =>
      [...document.querySelectorAll("span, div, button, a, p")].some((el) => raw(el) === label && vis(el));
    const hasBack = has("返回");
    const hasAdd = has("添加视频");
    const names = new Set();
    const nw = norm(want);
    for (const el of document.querySelectorAll("div, a, section")) {
      const t = textOf(el);
      if (t.length > 80) continue;
      const m = t.match(/^(.{1,16}?)共\\d+作品/);
      if (m && m[1] && !/收藏夹|视频|新建/.test(m[1])) names.add(m[1]);
    }
    const grid = names.size >= 3;
    return { hasBack, hasAdd, grid, ok: Boolean((hasBack || hasAdd) && !grid), want: nw };
  })()`;
}

export const LIST_VISIBLE_FOLDERS_SCRIPT = `(() => {
  const stripLock = (s) => String(s || "").replace(/[🔒锁★☆\\u2B50\\u2605\\u2606]/g, "");
  const textOf = (el) => stripLock((el.innerText || el.textContent || "").replace(/\\s+/g, ""));
  const junk = /收藏夹|视频|音乐|合集|短剧|新建|添加视频|批量管理|返回|观看历史|稍后再看|粉丝|关注|作品|获赞|推荐|精选|直播|抖音号|许可证|备案|京ICP|ICP备|信息网络|节目许可/;
  const seen = new Set();
  const names = [];
  const add = (name) => {
    const n = String(name || "").trim();
    if (!n || n.length > 16 || junk.test(n) || seen.has(n) || n === "收藏" || /^\\d+$/.test(n)) return;
    seen.add(n);
    names.push(n);
  };
  for (const el of document.querySelectorAll("div, a, li, section, span")) {
    const r = el.getBoundingClientRect();
    if (r.top < 120 || r.bottom > innerHeight - 48) continue;
    if (r.left < 160 || r.width < 80) continue;
    const t = textOf(el);
    if (t.length > 40) continue;
    const m = t.match(/^(.{1,16}?)共\\d+作品/);
    if (m) add(m[1]);
  }
  return names;
})()`;

export const WORK_GRID_POINT_SCRIPT = `(() => {
  const cards = [...document.querySelectorAll("a[href*='/video'], a[href*='/note'], a[href*='/aweme']")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 100 && r.height >= 120 && r.left > 180 && r.top < innerHeight - 36 && r.bottom > 140;
  });
  cards.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const last = cards[cards.length - 1];
  if (!last) return { x: Math.round(innerWidth * 0.58), y: Math.round(innerHeight * 0.72) };
  const r = last.getBoundingClientRect();
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(Math.min(innerHeight - 48, Math.max(180, r.top + r.height * 0.55))),
  };
})()`;

export const GRID_CARDS_SCRIPT = `(() => {
  const parse = (s) => {
    const t = String(s || "");
    const m = t.match(/\\/(video|note|aweme)\\/(\\d{5,})/) || t.match(/[?&](?:modal_id|aweme_id|item_id)=(\\d{5,})/);
    if (!m) return null;
    const id = m[2] || m[1];
    if (!id) return null;
    const kind = (m[1] === "video" || /\\/video\\//.test(t)) ? "video" : "album";
    return { id, kind };
  };
  const nodes = [...document.querySelectorAll("a[href*='/video'], a[href*='/note'], a[href*='/aweme'], a[href*='modal_id']")];
  const cards = nodes.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 72 && r.height >= 90 && r.left > 180 && r.bottom > 90 && r.top < innerHeight - 8;
  });
  cards.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    if (Math.abs(ra.top - rb.top) > 40) return ra.top - rb.top;
    return ra.left - rb.left;
  });
  const out = [];
  const seen = new Set();
  for (const a of cards) {
    const href = a.getAttribute("href") || a.href || "";
    const parsed = parse(href) || parse(a.getAttribute("data-e2e") || "") || parse(a.innerHTML);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    const img = a.querySelector("img");
    const lines = String(a.innerText || "")
      .split("\\n")
      .map((t) => t.trim())
      .filter((t) => t && !/^\\d+$/.test(t) && !/^\\d+\\.\\d+[万w]?$/.test(t));
    out.push({
      id: parsed.id,
      kind: parsed.kind,
      cover: img?.currentSrc || img?.src || "",
      title: lines[lines.length - 1] || "",
    });
  }
  return out;
})()`;

export const PAGE_COLLECTS_ID_SCRIPT = `(() => {
  const blob = [location.href];
  try {
    for (const e of performance.getEntriesByType("resource")) blob.push(e.name);
  } catch {}
  const text = blob.join("\\n");
  const all = [...text.matchAll(/collects_id=(\\d{4,})/g)].map((x) => x[1]);
  return all.length ? all[all.length - 1] : "";
})()`;

export const SCROLL_GRID_TOP_SCRIPT = `(() => {
  const isScrollable = (el) => {
    const st = getComputedStyle(el);
    return (st.overflowY === "auto" || st.overflowY === "scroll" || st.overflowY === "overlay") && el.scrollHeight > el.clientHeight + 40;
  };
  const cards = [...document.querySelectorAll("a[href*='/video'], a[href*='/note'], a[href*='/aweme']")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 120 && r.height >= 140;
  });
  let n = 0;
  if (cards[0]) {
    let el = cards[0].parentElement;
    while (el && el !== document.documentElement) {
      if (isScrollable(el)) {
        el.scrollTop = 0;
        n += 1;
      }
      el = el.parentElement;
    }
  }
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  return n;
})()`;

export const SCROLL_FEED_SCRIPT = `(() => {
  const cards = [...document.querySelectorAll("a[href*='/video'], a[href*='/note'], a[href*='/aweme']")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 100 && r.height >= 120 && r.left > 160 && r.bottom > 80 && r.top < innerHeight;
  });
  cards.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const last = cards[cards.length - 1];
  if (!last) return { cards: 0, how: "none" };
  last.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
  const r = last.getBoundingClientRect();
  last.dispatchEvent(new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 640,
    deltaMode: 0,
    clientX: r.left + r.width / 2,
    clientY: Math.min(innerHeight - 24, r.top + r.height / 2),
    view: window,
  }));
  return { cards: cards.length, how: "into" };
})()`;

export const LIST_SIDE_FOLDERS_SCRIPT = `(() => {
  const textOf = (el) => (el.innerText || "").replace(/\\s+/g, " ").trim();
  const skip = /新建收藏夹|^收藏夹$|^视频$|^音乐$|^合集$|^短剧$|^收藏$/;
  const names = [];
  for (const el of document.querySelectorAll("span, div, p, a")) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12 || r.top < 140 || r.left > 460) continue;
    if (el.childElementCount > 8) continue;
    const t = textOf(el);
    if (!t || skip.test(t) || t.length > 30) continue;
    const name = t.replace(/\\d{1,5}$/, "").trim();
    if (name.length >= 1) names.push(name);
  }
  return [...new Set(names)];
})()`;

export function clickSideFolderScript(name) {
  return `(() => {
    const want = ${JSON.stringify(name)};
    const textOf = (el) => (el.innerText || "").replace(/\\s+/g, "");
    const nodes = [...document.querySelectorAll("span, div, p, a, li")];
    const hit = nodes.find((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 12 || r.left > 480 || r.top < 120) return false;
      const t = textOf(el);
      return t === want || t.startsWith(want);
    });
    if (!hit) return "none";
    (hit.closest("a, button, li") || hit).click();
    return "clicked";
  })()`;
}

export function installFolderWatchScript(knownNames = []) {
  const known = JSON.stringify(["收藏", ...[...new Set(knownNames)].filter((n) => n && n !== "收藏")]);
  return `(() => {
  const known = ${known};
  const textOf = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, "");
  const skipName = /^(作品|推荐|喜欢|收藏|收藏夹|视频|音乐|合集|短剧|话题|特效|精选|关注|朋友|我的|直播|批量管理|新建收藏夹|观看历史|稍后再看|我的预约|我的收藏夹|添加视频|返回|搜索你收藏的作品)$/;
  const stripLock = (s) => String(s || "").replace(/[🔒锁★☆\\u2B50\\u2605\\u2606]/g, "");
  const junk = /收藏夹|视频|音乐|合集|短剧|新建|添加视频|批量管理|返回/;
  const validName = (name) => {
    if (!name || name.length > 16) return false;
    if (skipName.test(name) || junk.test(name)) return false;
    return true;
  };
  const parseCard = (raw) => {
    const t = stripLock(raw);
    if (t.length > 36) return "";
    const m = t.match(/^(.{1,16}?)共\\d+作品/);
    const name = m ? m[1].trim() : "";
    return validName(name) ? name : "";
  };
  const parseRow = (raw) => {
    const t = stripLock(raw);
    if (t.length > 28) return "";
    const m = t.match(/^(.{1,16}?)(\\d{1,5})$/);
    if (!m) return "";
    const name = m[1].trim();
    if (!validName(name) || /^\\d+$/.test(name)) return "";
    return name;
  };
  const lumOf = (el) => {
    const bg = getComputedStyle(el).backgroundColor || "";
    const m = bg.match(/[\\d.]+/g);
    if (!m) return null;
    const a = m.length === 4 ? Number(m[3]) : 1;
    if (a < 0.08) return null;
    return (Number(m[0]) + Number(m[1]) + Number(m[2])) * a;
  };
  const listCards = () => {
    const seen = new Map();
    for (const el of document.querySelectorAll("div, a, li, section")) {
      const r = el.getBoundingClientRect();
      if (r.width < 140 || r.height < 70) continue;
      const t = textOf(el);
      if (t.length > 36) continue;
      const m = t.match(/^(.{1,16}?)共(\\d+)作品/);
      if (!m) continue;
      const name = m[1].replace(/锁|🔒/g, "").trim();
      if (!validName(name)) continue;
      const prev = seen.get(name);
      if (!prev || t.length < prev.len) seen.set(name, { name, count: Number(m[2]), len: t.length });
    }
    return [...seen.values()].map(({ name, count }) => ({ name, count }));
  };
  const listSide = () => {
    const seen = new Map();
    for (const el of document.querySelectorAll("div, a, li, span, p, button")) {
      const r = el.getBoundingClientRect();
      if (r.left > 400 || r.top < 125 || r.bottom > innerHeight - 6) continue;
      if (r.width < 72 || r.width > 400 || r.height < 28 || r.height > 90) continue;
      const name = parseRow(textOf(el));
      if (!name) continue;
      const lum = lumOf(el);
      const selected = el.getAttribute("aria-selected") === "true" || /active|selected|current/i.test(el.className || "");
      const prev = seen.get(name);
      const len = textOf(el).length;
      if (!prev || len < prev.len) seen.set(name, { name, selected, lum, len });
      else {
        if (selected) prev.selected = true;
        if (prev.lum == null && lum != null) prev.lum = lum;
      }
    }
    return [...seen.values()];
  };
  const hasText = (label, maxTop) =>
    [...document.querySelectorAll("span, div, button, a, p")].some((el) => {
      if (textOf(el) !== label) return false;
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.top < (maxTop || innerHeight);
    });
  const pickSelected = (side) => {
    if (!side.length) return "";
    const marked = side.find((s) => s.selected);
    if (marked) return marked.name;
    const withLum = side.filter((s) => s.lum != null);
    if (withLum.length >= 2) {
      const lums = withLum.map((s) => s.lum).sort((a, b) => a - b);
      const med = lums[Math.floor(lums.length / 2)];
      let best = withLum[0];
      let bestDiff = 0;
      for (const s of withLum) {
        const d = Math.abs(s.lum - med);
        if (d > bestDiff) {
          bestDiff = d;
          best = s;
        }
      }
      if (bestDiff > 10) return best.name;
    }
    return "";
  };
  if (!window.__cangxiaWatch) window.__cangxiaWatch = { view: "other", name: "", cards: [] };
  if (!window.__cangxiaWatchBound) {
    window.__cangxiaWatchBound = true;
    document.addEventListener("click", (e) => {
      let n = e.target;
      let best = "";
      let card = "";
      let row = "";
      for (let i = 0; i < 18 && n; i += 1) {
        const raw = textOf(n);
        const fromCard = parseCard(raw);
        if (fromCard && (!card || fromCard.length < card.length)) card = fromCard;
        const fromRow = parseRow(raw);
        if (fromRow && (!row || fromRow.length < row.length)) row = fromRow;
        if (raw === "作品" || raw === "推荐" || raw === "喜欢" || raw === "观看历史" || raw === "稍后再看") {
          window.__cangxiaWatch = { view: "other", name: "", cards: listCards() };
          return;
        }
        if (raw === "收藏夹") {
          window.__cangxiaWatch = { view: "folder-list", name: "", cards: listCards() };
          return;
        }
        if (raw === "收藏" && !card && !row) best = best || "收藏";
        const t = stripLock(raw).replace(/\\d{1,6}$/, "").trim();
        const knownHit = known.find((k) => k !== "收藏" && t && (t === k || t.startsWith(k)));
        if (knownHit) best = knownHit;
        n = n.parentElement;
      }
      const name = [card, row, best].find((n) => n && n !== "收藏" && validName(n)) || "";
      if (name) {
        window.__cangxiaWatch = { view: "folder", name, cards: listCards() };
        return;
      }
      if (best === "收藏") window.__cangxiaWatch = { view: "favorite", name: "收藏", cards: listCards() };
    }, true);
  }
  const cards = listCards();
  const side = listSide();
  const hasPanel = hasText("新建收藏夹", 280);
  const hasBack = hasText("返回", 160);
  const selected = pickSelected(side);
  if (hasPanel || hasBack) {
    const clicked = window.__cangxiaWatch.view === "folder" ? window.__cangxiaWatch.name : "";
    const name = [selected, clicked].find((n) => n && validName(n)) || "";
    if (name) {
      window.__cangxiaWatch = { view: "folder", name, cards, side: side.map((s) => s.name) };
    } else {
      window.__cangxiaWatch = { view: "folder-list", name: "", cards, side: side.map((s) => s.name) };
    }
  } else if (cards.length >= 2 && window.__cangxiaWatch.view !== "folder") {
    window.__cangxiaWatch = { view: "folder-grid", name: "", cards };
  }
  window.__cangxiaWatch.cards = cards;
  return window.__cangxiaWatch;
})()`;
}

export const INSTALL_FOLDER_WATCH_SCRIPT = installFolderWatchScript();


