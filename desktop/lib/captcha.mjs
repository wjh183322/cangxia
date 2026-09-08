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
