import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { KindFilter, Work, WorkVideo } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function folderTitle(title: string, workId: string) {
  const cleaned = title.replace(/[\\/:*?"<>|#]/g, "").replace(/\s+/g, " ").trim();
  const clipped = cleaned.slice(0, 40);
  return `${clipped}_${workId}`;
}

export function workVideos(work: Work): WorkVideo[] {
  if (work.videos?.length) return work.videos;
  if (work.videoUrl) return [{ id: `${work.id}_v`, url: work.videoUrl }];
  return [];
}

export function matchesKind(work: Work, kind: KindFilter) {
  if (kind === "all") return true;
  if (kind === "album") return work.kind === "album" || work.kind === "mixed";
  return work.kind === "video" || work.kind === "mixed";
}

export function compareCollectTime(a: Work, b: Work) {
  const ak = a.collectTimeKnown ? 0 : 1;
  const bk = b.collectTimeKnown ? 0 : 1;
  if (ak !== bk) return ak - bk;
  if (!ak) return (b.collectedAt || 0) - (a.collectedAt || 0);
  return (a.listIndex ?? 1e12) - (b.listIndex ?? 1e12);
}

export function videoStatusOf(work: Work) {
  if (work.videoStatus) return work.videoStatus;
  if (workVideos(work).length) return "pending";
  return "none";
}

export function workIsComplete(work: Work) {
  if (work.status === "stale") return true;
  if (work.status !== "downloaded") return false;
  if (work.kind === "video" || work.kind === "mixed") {
    return videoStatusOf(work) === "saved";
  }
  return true;
}

export function workNeedsDownload(work: Work) {
  if (work.status === "stale") return false;
  return !workIsComplete(work);
}

export function kindChip(work: Work) {
  if (work.kind === "mixed") return "图+视频";
  if (work.kind === "video") return workVideos(work).length > 1 ? `视频×${workVideos(work).length}` : "视频";
  return work.images.length > 1 ? `图×${work.images.length}` : "图";
}

export type MediaSlide =
  | { type: "image"; url: string; key: string }
  | { type: "video"; url: string; key: string };

export function workSlides(work: Work): MediaSlide[] {
  const images = work.images.map((img, i) => ({
    type: "image" as const,
    url: img.url,
    key: img.id || `img-${i}`,
  }));
  const videos =
    videoStatusOf(work) === "saved"
      ? workVideos(work).map((clip, i) => ({
          type: "video" as const,
          url: clip.url,
          key: clip.id || `vid-${i}`,
        }))
      : [];
  return [...images, ...videos];
}

export function applyDeletedWorks(works: Work[], ids: string[]): Work[] {
  const drop = new Set(ids);
  const next: Work[] = [];
  for (const w of works) {
    if (!drop.has(w.id)) {
      next.push(w);
      continue;
    }
    if (w.status === "stale") continue;
    next.push({
      ...w,
      status: "new",
      videoStatus: workVideos(w).length ? "pending" : "none",
    });
  }
  return next;
}
