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
    return r.width > 8 && r.height > 8 && r.top > 70 && r.top < 520;
  };
  const nodes = [...document.querySelectorAll("span, div, a, button, p, li")];
  if (nodes.some((el) => vis(el) && textOf(el) === "收藏夹")) return "already";
  const fav = nodes.find((el) => {
    if (!vis(el) || el.childElementCount > 5) return false;
    const t = textOf(el);
    return t === "收藏";
  });
  if (fav) {
    const target = fav.closest("a, button, [role='tab']") || fav;
    target.click();
    return "clicked";
  }
  return "none";
})()`;

export const SCROLL_FEED_SCRIPT = `(() => {
  const step = 380;
  const isScrollable = (el) => {
    const st = getComputedStyle(el);
    return (st.overflowY === "auto" || st.overflowY === "scroll" || st.overflowY === "overlay") && el.scrollHeight > el.clientHeight + 40;
  };
  const cards = [...document.querySelectorAll("a[href*='/video'], a[href*='/note'], a[href*='/aweme']")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 120 && r.width <= 520 && r.height >= 140 && r.height <= 640;
  });
  let box = null;
  if (cards[0]) {
    let el = cards[0].parentElement;
    while (el && el !== document.documentElement) {
      if (isScrollable(el) && el.clientHeight >= 280) {
        box = el;
        break;
      }
      el = el.parentElement;
    }
  }
  if (box) {
    const maxTop = box.scrollHeight - box.clientHeight;
    const next = Math.min(maxTop, box.scrollTop + step);
    if (next <= box.scrollTop + 2) return "end";
    box.scrollTop = next;
    return "row";
  }
  const cur = window.scrollY || document.documentElement.scrollTop;
  const maxTop = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  const next = Math.min(maxTop, cur + step);
  if (next <= cur + 2) return "end";
  window.scrollTo(0, next);
  return "row";
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
  const skip = /^(作品|推荐|喜欢|收藏|收藏夹|视频|音乐|合集|短剧|话题|特效|精选|关注|朋友|我的|直播|批量管理|新建收藏夹|观看历史|稍后再看|我的预约|我的收藏夹)$/;
  const parseCard = (raw) => {
    const t = String(raw || "");
    const m = t.match(/^(.{1,24}?)共\\d+作品/);
    if (!m) return "";
    return m[1].replace(/锁|🔒/g, "").trim();
  };
  const listCards = () => {
    const seen = new Map();
    for (const el of document.querySelectorAll("div, a, li, section")) {
      const r = el.getBoundingClientRect();
      if (r.width < 140 || r.height < 70) continue;
      const t = textOf(el);
      const m = t.match(/^(.{1,24}?)共(\\d+)作品/);
      if (!m) continue;
      const name = m[1].replace(/锁|🔒/g, "").trim();
      if (!name || skip.test(name)) continue;
      const prev = seen.get(name);
      if (!prev || t.length < prev.len) seen.set(name, { name, count: Number(m[2]), len: t.length });
    }
    return [...seen.values()].map(({ name, count }) => ({ name, count }));
  };
  if (!window.__cangxiaWatch) window.__cangxiaWatch = { view: "other", name: "", cards: [] };
  if (!window.__cangxiaWatchBound) {
    window.__cangxiaWatchBound = true;
    document.addEventListener("click", (e) => {
      let n = e.target;
      let best = "";
      let card = "";
      for (let i = 0; i < 14 && n; i += 1) {
        const raw = textOf(n);
        const fromCard = parseCard(raw);
        if (fromCard) card = fromCard;
        if (raw === "作品" || raw === "推荐" || raw === "喜欢" || raw === "观看历史" || raw === "稍后再看") {
          window.__cangxiaWatch = { view: "other", name: "", cards: listCards() };
          return;
        }
        if (raw === "收藏夹") {
          window.__cangxiaWatch = { view: "folder-grid", name: "", cards: listCards() };
          return;
        }
        if (raw === "收藏" && !card) best = best || "收藏";
        const t = raw.replace(/\\d{1,6}$/, "").trim();
        const knownHit = known.find((k) => k !== "收藏" && t && (t === k || t.startsWith(k)));
        if (knownHit) best = knownHit;
        n = n.parentElement;
      }
      if (card) {
        window.__cangxiaWatch = { view: "folder", name: card, cards: listCards() };
        return;
      }
      if (best && best !== "收藏") {
        window.__cangxiaWatch = { view: "folder", name: best, cards: listCards() };
        return;
      }
      if (best === "收藏") window.__cangxiaWatch = { view: "favorite", name: "收藏", cards: listCards() };
    }, true);
  }
  const cards = listCards();
  if (cards.length >= 2 && window.__cangxiaWatch.view !== "folder") {
    window.__cangxiaWatch = { view: "folder-grid", name: "", cards };
  }
  window.__cangxiaWatch.cards = cards;
  return window.__cangxiaWatch;
})()`;
}

export const INSTALL_FOLDER_WATCH_SCRIPT = installFolderWatchScript();


