function pickUrl(urlList) {
  if (!Array.isArray(urlList) || urlList.length === 0) return "";
  const clean = urlList.find((u) => typeof u === "string" && !u.includes("watermark"));
  return clean || urlList[urlList.length - 1] || urlList[0] || "";
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
  const posts = aweme.images || aweme.image_post_info?.images || [];
  const images = [];
  const videos = [];
  for (const [i, img] of posts.entries()) {
    const clip = pickUrl(
      img.video?.play_addr_h264?.url_list ||
        img.video?.play_addr?.url_list ||
        img.clip?.url_list ||
        [],
    );
    if (clip) videos.push({ id: `${id}_v${i}`, url: clip });
    const still = pickUrl(img.url_list || img.display_image?.url_list || []);
    if (still) images.push({ id: `${id}_${i}`, url: still });
  }
  const cover = pickUrl(
    aweme.video?.origin_cover?.url_list || aweme.video?.cover?.url_list || aweme.video?.dynamic_cover?.url_list || [],
  );
  const mainVideo = pickUrl(
    aweme.video?.play_addr_h264?.url_list ||
      aweme.video?.play_addr?.url_list ||
      aweme.video?.download_addr?.url_list ||
      [],
  );
  if (mainVideo && !videos.some((v) => v.url === mainVideo)) {
    videos.unshift({ id: `${id}_v`, url: mainVideo });
  }
  if (!images.length && cover) images.push({ id: `${id}_still`, url: cover });
  let kind = "album";
  const postHasStills = posts.length > 0 && images.length > 0;
  if (postHasStills && videos.length) kind = "mixed";
  else if (videos.length) kind = "video";
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
    listIndex: 0,
    images,
    coverUrl: images[0]?.url || "",
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
  const lists = [data.aweme_list, data.list, data.items, payload.aweme_list];
  for (const list of lists) {
    if (!Array.isArray(list) || !list.length) continue;
    const awemes = list.map(unwrapAweme).filter(Boolean);
    if (awemes.length) return awemes;
  }
  return [];
}

export function mapFolder(raw, index) {
  const id = String(raw.collects_id || raw.collection_id || raw.id || `folder_${index}`);
  const name = raw.collects_name || raw.name || raw.title || (index === 0 ? "收藏" : `收藏夹${index}`);
  return { id, name, isDefault: Boolean(raw.is_default) || name === "收藏" };
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
