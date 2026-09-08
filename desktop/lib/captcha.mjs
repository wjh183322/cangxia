export function looksLikeCaptcha(url) {
  if (!url || typeof url !== "string") return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (/\.(js|mjs|css|map|woff2?|ttf|png|jpe?g|gif|svg|webp|ico)(\?|$)/i.test(parsed.pathname)) return false;
  if (/secsdk|sec_sdk|slardar|mssdk|sdk-glue/i.test(url)) return false;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const captchaHost = /(^|\.)(verify|verification|captcha)\.[a-z0-9.-]+$/i.test(host);
  const captchaPath = /\/captcha\/|\/slide\/verify|\/puzzle\/|\/verify\/(get|captcha)/i.test(path);
  return captchaHost && captchaPath;
}

export const OPEN_QR_SCRIPT = `(() => {
  const text = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, "");
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  };
  const nodes = [...document.querySelectorAll("button, a, span, div, p, li")];
  if (document.querySelector("img[src*='qrcode'], img[src*='qr'], canvas")) return "has-qr";
  const qrTab = nodes.find((el) => visible(el) && (text(el) === "扫码登录" || text(el) === "二维码登录"));
  if (qrTab) {
    qrTab.click();
    return "qr-tab";
  }
  const login = nodes.find((el) => visible(el) && text(el) === "登录" && el.childElementCount <= 3);
  if (login) {
    login.click();
    return "login";
  }
  return "none";
})()`;
