import type { Work } from "./types";
import { workVideos } from "./utils";

export type DlFileStatus = "waiting" | "downloading" | "done" | "failed";
export type DlTaskStatus = "waiting" | "downloading" | "paused" | "done" | "partial" | "failed";

export interface DlFile {
  key: string;
  name: string;
  type: "image" | "video";
  url: string;
  status: DlFileStatus;
  received: number;
  total: number;
}

export interface DlTask {
  workId: string;
  title: string;
  authorName: string;
  coverUrl: string;
  folderId: string;
  kind: Work["kind"];
  status: DlTaskStatus;
  files: DlFile[];
  speed: number;
  hasLocalFiles: boolean;
}

export function taskFromWork(work: Work): DlTask {
  const images = work.images.map((img, i) => ({
    key: img.id || `img-${i}`,
    name: `图${i + 1}.jpg`,
    type: "image" as const,
    url: img.url,
    status: "waiting" as const,
    received: 0,
    total: 2_400_000,
  }));
  const videos = workVideos(work).map((clip, i) => ({
    key: clip.id || `vid-${i}`,
    name: `视频${i + 1}.mp4`,
    type: "video" as const,
    url: clip.url,
    status: "waiting" as const,
    received: 0,
    total: 18_000_000,
  }));
  if ((work.kind === "video" || work.kind === "mixed") && videos.length === 0) {
    videos.push({
      key: `${work.id}-missing-video`,
      name: "视频1.mp4",
      type: "video",
      url: "",
      status: "waiting",
      received: 0,
      total: 8_000_000,
    });
  }
  return {
    workId: work.id,
    title: work.title,
    authorName: work.authorName,
    coverUrl: work.coverUrl,
    folderId: work.folderId,
    kind: work.kind,
    status: "waiting",
    files: [...images, ...videos],
    speed: 0,
    hasLocalFiles: false,
  };
}

export function enqueueTasks(tasks: DlTask[], incoming: DlTask[]): DlTask[] {
  const ids = new Set(tasks.map((t) => t.workId));
  const next = [...tasks];
  for (const t of incoming) {
    if (ids.has(t.workId)) continue;
    ids.add(t.workId);
    next.push(t);
  }
  return next;
}

export function pickNextWorkId(tasks: DlTask[], pauseAll: boolean): string | null {
  if (pauseAll) return null;
  if (tasks.some((t) => t.status === "downloading")) return null;
  return tasks.find((t) => t.status === "waiting")?.workId ?? null;
}

function stopFile(file: DlFile): DlFile {
  if (file.status !== "downloading") return file;
  return { ...file, status: "waiting" };
}

export function pauseTask(tasks: DlTask[], id: string): DlTask[] {
  return tasks.map((t) => {
    if (t.workId !== id) return t;
    if (t.status !== "downloading" && t.status !== "waiting") return t;
    return { ...t, status: "paused", speed: 0, files: t.files.map(stopFile) };
  });
}

export function resumeTask(tasks: DlTask[], id: string): DlTask[] {
  const idx = tasks.findIndex((t) => t.workId === id);
  if (idx < 0) return tasks;
  const task = tasks[idx];
  if (task.status !== "paused" && task.status !== "partial" && task.status !== "failed") return tasks;
  const updated: DlTask = {
    ...task,
    status: "waiting",
    files: task.files.map((f) => (f.status === "failed" ? { ...f, status: "waiting", received: 0 } : f)),
  };
  const without = tasks.filter((t) => t.workId !== id);
  const downloadingIdx = without.findIndex((t) => t.status === "downloading");
  if (downloadingIdx >= 0) {
    return [...without.slice(0, downloadingIdx + 1), updated, ...without.slice(downloadingIdx + 1)];
  }
  const waitingIdx = without.findIndex((t) => t.status === "waiting");
  if (waitingIdx < 0) return [...without, updated];
  return [...without.slice(0, waitingIdx), updated, ...without.slice(waitingIdx)];
}

export function pauseDownloading(tasks: DlTask[]): DlTask[] {
  return tasks.map((t) =>
    t.status === "downloading"
      ? { ...t, status: "paused" as const, speed: 0, files: t.files.map(stopFile) }
      : t,
  );
}

export function resumePaused(tasks: DlTask[]): DlTask[] {
  return tasks.map((t) => (t.status === "paused" ? { ...t, status: "waiting" as const } : t));
}

export function markTaskFinished(task: DlTask): DlTask {
  const failed = task.files.some((f) => f.status === "failed");
  const done = task.files.some((f) => f.status === "done");
  if (failed && done) return { ...task, status: "partial", speed: 0 };
  if (failed) return { ...task, status: "failed", speed: 0 };
  return {
    ...task,
    status: "done",
    speed: 0,
    hasLocalFiles: true,
    files: task.files.map((f) => ({ ...f, status: "done" as const, received: f.total || f.received })),
  };
}

export function receivedOf(task: DlTask) {
  return task.files.reduce((n, f) => n + f.received, 0);
}

export function totalOf(task: DlTask) {
  return task.files.reduce((n, f) => n + (f.total || 0), 0);
}

export function formatBytes(n: number) {
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSpeed(n: number) {
  if (n <= 0) return "0 KB/s";
  return `${formatBytes(n)}/s`;
}

export function dlCounts(tasks: DlTask[]) {
  return { done: tasks.filter((t) => t.status === "done").length, total: tasks.length };
}

export function videoPendingCount(tasks: DlTask[]) {
  return tasks
    .filter((t) => t.status !== "done")
    .reduce((n, t) => n + t.files.filter((f) => f.type === "video" && f.status !== "done").length, 0);
}

export function cancelNeedsConfirm(task: DlTask) {
  if (task.status === "waiting" && !task.hasLocalFiles) return false;
  if (task.status === "done") return false;
  return task.status === "downloading" || task.hasLocalFiles || task.status === "partial" || task.status === "paused";
}

export function fileSummary(task: DlTask) {
  const images = task.files.filter((f) => f.type === "image").length;
  const videos = task.files.filter((f) => f.type === "video").length;
  const parts = [];
  if (images) parts.push(`图 ${images}`);
  if (videos) parts.push(`视频 ${videos}`);
  return parts.join(" · ") || "文件 0";
}

export function statusLabel(status: DlTaskStatus) {
  if (status === "downloading") return "下载中";
  if (status === "waiting") return "等待";
  if (status === "paused") return "已暂停";
  if (status === "done") return "已完成";
  if (status === "partial") return "部分失败";
  return "失败";
}

export function hydrateTasks(tasks: DlTask[]): DlTask[] {
  return tasks.map((t) => ({
    ...t,
    speed: 0,
    status: t.status === "downloading" ? "paused" : t.status,
    files: t.files.map((f) => ({
      ...f,
      status: f.status === "downloading" ? "waiting" : f.status,
    })),
  }));
}

export function applyWorkResult(work: Work, task: DlTask): Work {
  const imagesDone = task.files.filter((f) => f.type === "image").every((f) => f.status === "done");
  const videoFiles = task.files.filter((f) => f.type === "video");
  const videosDone = videoFiles.length === 0 || videoFiles.every((f) => f.status === "done");
  const videosFailed = videoFiles.some((f) => f.status === "failed");
  if (!imagesDone && videoFiles.length === 0) {
    return { ...work, status: "no-origin" };
  }
  return {
    ...work,
    status: imagesDone || task.files.some((f) => f.status === "done") ? "downloaded" : "no-origin",
    videoStatus: videosDone && videoFiles.length ? "saved" : videosFailed || videoFiles.length ? "missing" : "none",
  };
}
