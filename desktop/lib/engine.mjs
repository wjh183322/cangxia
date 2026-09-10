import { mkdir, copyFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { net } from "electron";
import { exists, readIndex, writeIndex, writeWorkMeta, workDir } from "./layout.mjs";
import { mp4HasAudio, removePartial, sniffFile, transferToFile } from "./transfer.mjs";
import { albumUrlsFromShareHtml } from "./share-origin.mjs";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

let controller = null;
let abortReason = null;

function fetchText(url, session) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session, redirect: "follow" });
    req.setHeader("User-Agent", MOBILE_UA);
    req.setHeader("Referer", "https://www.douyin.com/");
    req.setHeader("Accept", "text/html,application/xhtml+xml");
    let body = "";
    req.on("response", (res) => {
      res.on("data", (chunk) => {
        body += Buffer.from(chunk).toString("utf8");
      });
      res.on("end", () => resolve(body));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

async function resolveAlbumImages(awemeId, session) {
  const id = String(awemeId || "");
  if (!id) return [];
  const pages = [`https://www.iesdouyin.com/share/note/${id}/`, `https://www.iesdouyin.com/share/video/${id}/`];
  for (const url of pages) {
    try {
      const html = await fetchText(url, session);
      const urls = albumUrlsFromShareHtml(html);
      if (urls.length) return urls;
    } catch {
      /* next */
    }
  }
  return [];
}

export function abortDownload(reason) {
  abortReason = reason || "pause";
  controller?.abort();
}

export async function runWork({ work, folderName, files, rootPath, session, send }) {
  abortReason = null;
  controller = new AbortController();
  const dir = workDir(rootPath, folderName, work.title, work.id);
  await mkdir(dir, { recursive: true });

  if ((work.kind === "album" || work.kind === "mixed") && (files || []).some((f) => f.type === "image")) {
    const originals = await resolveAlbumImages(work.id, session);
    if (originals.length) {
      let n = 0;
      for (const file of files) {
        if (file.type !== "image") continue;
        const u = originals[n++];
        if (!u) continue;
        file.url = u;
        file.urls = [u, ...(file.urls || [])];
        file.reget = true;
      }
    }
  }

  let tickAt = Date.now();
  let lastReceived = 0;
  let speed = 0;
  const results = new Map((files || []).map((f) => [f.key, f.status || "waiting"]));

  for (const file of files || []) {
    if (controller.signal.aborted) break;
    if (file.status === "done" || results.get(file.key) === "done") continue;
    if (!file.url && !(file.urls || []).length) {
      results.set(file.key, "failed");
      send("cangxia:dl", { type: "file-fail", workId: work.id, fileKey: file.key });
      continue;
    }
    const dest = join(dir, file.name);
    if (await exists(dest)) {
      if (file.reget) {
        await removePartial(dest);
      } else {
        try {
          const st = await stat(dest);
          const kind = await sniffFile(dest);
          const videoOk = file.type !== "video" || kind === "mp4" || kind === "webm";
          const imageOk = file.type !== "image" || (kind !== "empty" && kind !== "html");
          const audioOk = file.type !== "video" || (await mp4HasAudio(dest));
          if (st.size > 32 && videoOk && imageOk && audioOk) {
            results.set(file.key, "done");
            send("cangxia:dl", { type: "file-done", workId: work.id, fileKey: file.key, received: st.size, total: st.size });
            continue;
          }
        } catch {
          /* rewrite */
        }
        await removePartial(dest);
      }
    }
    const candidates = [...new Set([file.url, ...(file.urls || [])].filter(Boolean))];
    if (!candidates.length) {
      results.set(file.key, "failed");
      send("cangxia:dl", { type: "file-fail", workId: work.id, fileKey: file.key });
      continue;
    }
    let saved = false;
    for (const url of candidates) {
      if (controller.signal.aborted) break;
      lastReceived = 0;
      tickAt = Date.now();
      try {
        await transferToFile({
          url,
          dest,
          session,
          signal: controller.signal,
          onProgress: (received, total) => {
            const now = Date.now();
            const dt = now - tickAt;
            if (dt >= 300) {
              speed = ((received - lastReceived) / dt) * 1000;
              lastReceived = received;
              tickAt = now;
            }
            send("cangxia:dl", {
              type: "progress",
              workId: work.id,
              fileKey: file.key,
              received,
              total,
              speed: Math.max(0, speed),
            });
          },
        });
        const kind = await sniffFile(dest);
        if (file.type === "video" && kind !== "mp4" && kind !== "webm") {
          throw new Error(`not-video:${kind}`);
        }
        if (file.type === "video" && !(await mp4HasAudio(dest))) {
          throw new Error("no-audio");
        }
        if (file.type === "image" && (kind === "empty" || kind === "html")) {
          throw new Error(`not-image:${kind}`);
        }
        saved = true;
        results.set(file.key, "done");
        send("cangxia:dl", { type: "file-done", workId: work.id, fileKey: file.key });
        break;
      } catch {
        await removePartial(dest);
        if (controller.signal.aborted) {
          send("cangxia:dl", { type: "work-paused", workId: work.id });
          return { paused: abortReason !== "cancel", aborted: true, reason: abortReason };
        }
      }
    }
    if (!saved) {
      results.set(file.key, "failed");
      send("cangxia:dl", { type: "file-fail", workId: work.id, fileKey: file.key });
    }
  }

  if (controller.signal.aborted) {
    send("cangxia:dl", { type: "work-paused", workId: work.id });
    return { paused: abortReason !== "cancel", aborted: true, reason: abortReason };
  }

  const listed = files || [];
  const images = listed.filter((f) => f.type === "image");
  const videos = listed.filter((f) => f.type === "video");
  const imagesDone = images.length === 0 || images.every((f) => results.get(f.key) === "done");
  const videosDone = videos.length > 0 && videos.every((f) => results.get(f.key) === "done");
  const anyDone = [...results.values()].some((v) => v === "done");
  const status = imagesDone || anyDone ? "downloaded" : "no-origin";
  const videoStatus = videos.length === 0 ? "none" : videosDone ? "saved" : "missing";

  const firstImage = images[0];
  const coverDest = join(dir, "cover.jpg");
  if (firstImage && !(await exists(coverDest))) {
    const src = join(dir, firstImage.name);
    if (await exists(src)) {
      try {
        await copyFile(src, coverDest);
      } catch {
        /* ignore */
      }
    }
  }
  await writeWorkMeta(dir, { ...work, status }, folderName, videoStatus);

  const index = await readIndex(rootPath);
  const records = [...(index.records || [])];
  const rec = { id: work.id, dir, status, videoStatus, at: new Date().toISOString() };
  const idx = records.findIndex((r) => r.id === work.id);
  if (idx >= 0) records[idx] = rec;
  else records.push(rec);
  await writeIndex(rootPath, records);

  send("cangxia:dl", { type: "work-done", workId: work.id, status, videoStatus });
  send("cangxia:work-status", { id: work.id, status, videoStatus });
  return { ok: true };
}
