export function extractRenderData(html) {
  const text = String(html || "");
  const render = text.match(/<script[^>]*id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i);
  if (render) {
    const raw = render[1].trim();
    for (const candidate of [safeDecode(raw), raw]) {
      try {
        const json = JSON.parse(candidate);
        if (json && typeof json === "object") return json;
      } catch {
        /* next */
      }
    }
  }
  const router = text.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (router) {
    try {
      return JSON.parse(router[1]);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function pickShareImageUrl(img) {
  if (!img || typeof img !== "object") return "";
  const lists = [img.url_list, img.urlList, img.origin_url?.url_list, img.display_image?.url_list];
  const clean = (u) => {
    const s = String(u || "");
    if (/x-signature=|x-expires=/i.test(s)) return s;
    return s.replace(/~tplv-[^/?#]+/gi, "~noop");
  };
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const jpeg = list.find(
      (u) => typeof u === "string" && /^https?:/i.test(u) && !/\.webp(\?|$)/i.test(u) && !/watermark|tplv-dy-download/i.test(u),
    );
    if (jpeg) return clean(jpeg);
    const any = list.find((u) => typeof u === "string" && /^https?:/i.test(u));
    if (any) return clean(any);
  }
  return "";
}

export function albumUrlsFromShareHtml(html) {
  const data = extractRenderData(html);
  if (!data) return [];
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const images = node.images;
    if (Array.isArray(images) && images.length && images.some((i) => i && (i.url_list || i.urlList))) {
      const urls = images.map(pickShareImageUrl).filter(Boolean);
      if (urls.length > found.length) {
        found.length = 0;
        found.push(...urls);
      }
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(data);
  return found;
}
