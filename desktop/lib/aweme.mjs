function stripWm(url) {
  return String(url || "")
    .replace(/playwm/g, "play")
    .replace(/watermark=1/g, "watermark=0");
}

function isVideoUrl(url) {
  const u = String(url || "").toLowerCase();
  if (!/^https?:\/\//.test(u)) return false;
  if (/\.(jpg|jpeg|png|webp|gif|heic|bmp)(\?|$)/i.test(u)) return false;
  if (/\.m3u8(\?|$)/i.test(u)) return false;
  return true;
}

function pickUrl(urlList, kind = "any") {
  if (!Array.isArray(urlList) || urlList.length === 0) return "";
  const urls = urlList.filter((u) => typeof u === "string" && u && (kind !== "video" || isVideoUrl(u)));
  if (!urls.length) return "";
  const clean = urls.find((u) => !/watermark|playwm/i.test(u));
  return stripWm(clean || urls[0]);
}

function isPlayableRate(rate) {
  if (!rate || typeof rate !== "object") return false;
  if (rate.is_h265 === 1 || rate.is_h265 === true || rate.is_bytevc1 === 1 || rate.is_bytevc1 === true) return false;
  const tag = `${rate.gear_name || ""} ${rate.codec_type || ""} ${rate.format || ""}`;
  if (/h265|hevc|bytevc1/i.test(tag)) return false;
  return true;
}

function playUri(video) {
  const uri = video.play_addr?.uri || video.play_addr_h264?.uri || video.download_addr?.uri || video.vid || "";
  return String(uri);
}

function videoCandidates(video) {
  if (!video || typeof video !== "object") return [];
  const urls = [];
  const push = (u) => {
    const v = stripWm(u);
    if (v && isVideoUrl(v) && !urls.includes(v)) urls.push(v);
  };
  const uri = playUri(video);
  if (uri && !/^https?:/i.test(uri)) {
    const q = encodeURIComponent(uri);
    push(`https://www.iesdouyin.com/aweme/v1/play/?video_id=${q}&ratio=1080p&line=0&watermark=0`);
    push(`https://aweme.snssdk.com/aweme/v1/play/?video_id=${q}&ratio=1080p&line=0`);
  }
  const rates = Array.isArray(video.bit_rate) ? [...video.bit_rate] : [];
  const playable = rates.filter(isPlayableRate);
  const pool = (playable.length ? playable : rates).sort(
    (a, b) =>
      (Number(b.bit_rate) || Number(b.data_size) || 0) - (Number(a.bit_rate) || Number(a.data_size) || 0),
  );
  for (const rate of pool) {
    for (const u of rate?.download_addr?.url_list || []) push(u);
  }
  for (const u of video.download_addr?.url_list || []) push(u);
  for (const rate of pool) {
    for (const u of rate?.play_addr?.url_list || rate?.play_addr_h264?.url_list || []) push(u);
  }
  for (const u of video.play_addr_h264?.url_list || []) push(u);
  for (const u of video.play_addr?.url_list || []) push(u);
  return urls;
}

function videoUrl(video) {
  return videoCandidates(video)[0] || "";
}

function looksWatermarked(url) {
  return /watermark|playwm|owner_watermark|tplv-dy-download|from=download/i.test(String(url || ""));
}

function unwatermarkImageUrl(url) {
  const u = String(url || "").replace(/watermark=1/g, "watermark=0");
  if (!u) return "";
  if (/x-signature=|x-expires=/i.test(u)) return u;
  return u.replace(/~tplv-[^/?#]+/gi, "~noop");
}

function pushImageUrls(out, list) {
  if (!Array.isArray(list)) return;
  for (const raw of list) {
    if (typeof raw !== "string" || !raw || !/^https?:/i.test(raw)) continue;
    const original = raw.replace(/watermark=1/g, "watermark=0");
    if (!looksWatermarked(original) && !out.includes(original)) out.push(original);
  }
  for (const raw of list) {
    if (typeof raw !== "string" || !raw) continue;
    const u = unwatermarkImageUrl(raw);
    if (u && !out.includes(u) && !looksWatermarked(u)) out.push(u);
  }
}

function imageCandidates(img) {
  if (!img || typeof img !== "object") return [];
  const out = [];
  // download_url_list 是 App 保存图，会带「抖音号」水印，放到最后
  for (const list of [
    img.origin_url?.url_list,
    img.origin_large?.url_list,
    img.largest?.url_list,
    img.display_image?.url_list,
    img.url_list,
  ]) {
    pushImageUrls(out, list);
  }
  pushImageUrls(out, img.download_url_list);
  pushImageUrls(out, img.display_image?.download_url_list);
  return out;
}

function imageUrl(img) {
  return imageCandidates(img)[0] || "";
}

function albumPosts(aweme) {
  const base =
    (Array.isArray(aweme.images) && aweme.images.length && aweme.images) ||
    aweme.image_post_info?.images ||
    [];
  const gears = [...(aweme.img_bitrate || []), ...(aweme.image_post_info?.img_bitrate || [])];
  let best = [];
  let score = -1;
  for (const g of gears) {
    const imgs = g?.images || [];
    if (!imgs.length) continue;
    const px = imgs.reduce((s, i) => s + (Number(i.width) || 0) * (Number(i.height) || 0), 0);
    if (px > score || (px === score && imgs.length > best.length)) {
      score = px;
      best = imgs;
    }
  }
  if (best.length >= base.length && best.length) return best;
  return base;
}

function coverUrl(video) {
  if (!video || typeof video !== "object") return "";
  return (
    pickUrl(video.origin_cover?.url_list) ||
    pickUrl(video.big_thumb?.url_list) ||
    pickUrl(video.cover?.url_list) ||
    pickUrl(video.dynamic_cover?.url_list) ||
    pickUrl(video.ai_cover?.url_list) ||
    ""
  );
}

function hashtagsFrom(aweme) {
  const extra = Array.isArray(aweme.text_extra) ? aweme.text_extra : [];
  const fromExtra = extra.map((x) => x.hashtag_name || x.hashtagName).filter(Boolean);
  if (fromExtra.length) return [...new Set(fromExtra)];
  const desc = String(aweme.desc || aweme.caption || "");
  return [...new Set((desc.match(/#([^\s#]+)/g) || []).map((s) => s.slice(1)))];
}

function mediaFrom(aweme) {
  const id = aweme.aweme_id || aweme.id || "";
  const posts = albumPosts(aweme);
  const isNote = posts.length > 0 || [2, 68, 107, 151].includes(Number(aweme.aweme_type));
  const images = [];
  const videos = [];
  for (const [i, img] of posts.entries()) {
    const stills = imageCandidates(img);
    if (stills.length) images.push({ id: `${id}_${i}`, url: stills[0], urls: stills });
    const clips = videoCandidates(img.video);
    const live = clips[0] || pickUrl(img.clip?.url_list || [], "video");
    if (live) videos.push({ id: `${id}_v${i}`, url: live, urls: clips.length ? clips : [live] });
  }
  if (!isNote) {
    const cover = coverUrl(aweme.video);
    const clips = videoCandidates(aweme.video);
    if (cover) images.push({ id: `${id}_still`, url: cover, urls: [cover] });
    if (clips.length) videos.push({ id: `${id}_v`, url: clips[0], urls: clips });
  } else {
    const cover = coverUrl(aweme.video);
    if (cover && images[0]) {
      images[0].urls = [...new Set([images[0].url, cover, ...(images[0].urls || [])].filter(Boolean))];
    } else if (cover && !images.length) {
      images.push({ id: `${id}_still`, url: cover, urls: [cover] });
    }
  }
  let kind = "album";
  if (isNote) {
    if (images.length && videos.length) kind = "mixed";
    else if (videos.length) kind = "video";
  } else if (videos.length) {
    kind = "video";
  }
  return { kind, images, videos };
}

export function mapAweme(aweme, folder) {
  const id = String(aweme.aweme_id || aweme.id || "");
  const { kind, images, videos } = mediaFrom(aweme);
  const author = aweme.author || {};
  const stillsOk = images.length > 0;
  let videoStatus = "none";
  if (videos.length) videoStatus = videos.every((v) => v.url) ? "pending" : "missing";
  let status = "new";
  if (!stillsOk && kind === "album") status = "no-origin";
  if ((kind === "video" || kind === "mixed") && !stillsOk && !videos.length) status = "no-origin";
  return {
    id,
    title: String(aweme.desc || aweme.preview_title || "未命名").split(/[#\n]/)[0].trim() || "未命名",
    authorName: author.nickname || "未知作者",
    douyinId: author.unique_id || author.short_id || "",
    caption: aweme.desc || "",
    hashtags: hashtagsFrom(aweme),
    userTags: [],
    folderId: folder.id,
    alsoInFolderIds: [],
    kind,
    status,
    videoStatus,
    videoUrl: videos[0]?.url,
    videos,
    collectedAt: (Number(aweme._collect_time || aweme.collects_time || aweme.collect_time) || 0) * 1000 || Date.now(),
    images,
    coverUrl: images[0]?.url || coverUrl(aweme.video) || "",
  };
}

export function unwrapAweme(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.collects_name && !raw.aweme_id && !raw.aweme_info && !raw.aweme) return null;
  const inner = raw.aweme_info || raw.aweme || raw.aweme_detail || raw;
  const id = String(inner.aweme_id || inner.id || raw.aweme_id || "");
  if (!id) return null;
  inner.collects_id = inner.collects_id || raw.collects_id || raw.collection_id || "";
  inner._collect_time = Number(raw.collects_time || raw.collect_time || inner.collects_time || inner.collect_time || 0);
  return inner;
}

export function collectAwemes(payload) {
  if (!payload || typeof payload !== "object") return [];
  const data = payload.data || payload;
  const lists = [data.aweme_list, data.list, data.items, data.item_list, payload.aweme_list, payload.item_list];
  for (const list of lists) {
    if (!Array.isArray(list) || !list.length) continue;
    const awemes = list.map(unwrapAweme).filter(Boolean);
    if (awemes.length) return awemes;
  }
  return [];
}

export function mapFolder(raw, index) {
  const id = String(raw.collects_id_str || raw.collects_id || raw.collection_id || raw.id || `folder_${index}`);
  const name = raw.collects_name || raw.name || raw.title || (index === 0 ? "收藏" : `收藏夹${index}`);
  return { id, name, isDefault: Boolean(raw.is_default) || name === "收藏" };
}

export function isCollectFeedUrl(url) {
  const u = String(url || "");
  if (/tab\/feed|recommend|hot\/search|follow\/feed|comment\/list|aweme\/detail|user\/post/i.test(u)) return false;
  if (/collects\/list\/?(?:\?|$)/i.test(u) && !/video\/list/i.test(u)) return false;
  return /listcollection|collects\/|favorite|\/web\/collect|aweme\/list/i.test(u);
}

export function isFolderListUrl(url) {
  const u = String(url || "");
  return /collects\/list/i.test(u) && !/video\/list|aweme\/list|item\/list/i.test(u);
}

export function mergeWorks(existing, incoming) {
  const byId = new Map(existing.map((w) => [w.id, w]));
  return incoming.map((w) => {
    const prev = byId.get(w.id);
    if (!prev) return w;
    return {
      ...w,
      userTags: prev.userTags || [],
      status: prev.status === "downloaded" || prev.status === "stale" ? prev.status : w.status,
      videoStatus: prev.videoStatus === "saved" ? "saved" : w.videoStatus,
      alsoInFolderIds: [...new Set([...(prev.alsoInFolderIds || []), ...w.alsoInFolderIds])],
    };
  });
}
