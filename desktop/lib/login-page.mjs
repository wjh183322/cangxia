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
  function grab(doc) {
    if (!doc) return null;
    const imgs = [...doc.querySelectorAll("img")];
    const hit = imgs.find((img) => {
      const blob = ((img.src || "") + " " + (img.className || "") + " " + (img.alt || "")).toLowerCase();
      if (img.naturalWidth && img.naturalWidth < 80) return false;
      if (/qr|qrcode|二维码/.test(blob)) return true;
      return img.naturalWidth >= 140 && img.naturalWidth === img.naturalHeight && img.naturalWidth <= 480;
    });
    if (hit) {
      if (hit.src && (hit.src.startsWith("data:") || hit.src.startsWith("http") || hit.src.startsWith("blob:"))) {
        return hit.src;
      }
      try {
        const c = doc.createElement("canvas");
        c.width = hit.naturalWidth || 240;
        c.height = hit.naturalHeight || 240;
        c.getContext("2d").drawImage(hit, 0, 0);
        return c.toDataURL("image/png");
      } catch {
        /* tainted */
      }
    }
    const canvas = [...doc.querySelectorAll("canvas")].find((c) => c.width >= 80 && Math.abs(c.width - c.height) < 8);
    if (canvas) {
      try {
        return canvas.toDataURL("image/png");
      } catch {
        /* tainted */
      }
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
