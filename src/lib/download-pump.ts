import {
  applyWorkResult,
  markTaskFinished,
  pickNextWorkId,
  receivedOf,
  type DlTask,
} from "./download";
import { desktop } from "./desktop";
import { useApp } from "./store";
import type { Work } from "./types";

let previewTimer: ReturnType<typeof setInterval> | null = null;
let desktopPumping = false;
let lastBytes = 0;
let lastSpeedAt = Date.now();

function patchTask(tasks: DlTask[], id: string, fn: (t: DlTask) => DlTask) {
  return tasks.map((t) => (t.workId === id ? fn(t) : t));
}

function folderNameOf(folderId: string) {
  return useApp.getState().folders.find((f) => f.id === folderId)?.name || "收藏";
}

function finishWork(task: DlTask) {
  const finished = markTaskFinished(task);
  useApp.setState((s) => ({
    dlTasks: s.dlTasks.map((t) => (t.workId === task.workId ? finished : t)),
    works: s.works.map((w) => (w.id === task.workId ? applyWorkResult(w, finished) : w)),
    selectedIds: s.selectedIds.filter((id) => id !== task.workId),
  }));
}

export function kickDownload() {
  if (desktop()) {
    void pumpDesktop();
    return;
  }
  ensurePreview();
}

function ensurePreview() {
  if (previewTimer) return;
  lastBytes = 0;
  lastSpeedAt = Date.now();
  previewTimer = setInterval(tickPreview, 100);
}

function stopPreviewIfIdle() {
  const s = useApp.getState();
  if (s.dlPauseAll || !s.dlTasks.some((t) => t.status === "waiting" || t.status === "downloading")) {
    if (previewTimer) clearInterval(previewTimer);
    previewTimer = null;
    useApp.setState({ dlSpeed: 0 });
  }
}

function tickPreview() {
  const s = useApp.getState();
  if (s.dlPauseAll) {
    if (s.dlTasks.some((t) => t.status === "downloading")) return;
    stopPreviewIfIdle();
    return;
  }
  let tasks = s.dlTasks;
  let current = tasks.find((t) => t.status === "downloading");
  if (!current) {
    const id = pickNextWorkId(tasks, false);
    if (!id) {
      stopPreviewIfIdle();
      return;
    }
    tasks = patchTask(tasks, id, (t) => ({
      ...t,
      status: "downloading",
      files: startNextFile(t.files),
    }));
    current = tasks.find((t) => t.workId === id)!;
    useApp.setState({ dlTasks: tasks });
  }

  const file = current.files.find((f) => f.status === "downloading");
  if (!file) {
    finishWork(current);
    return;
  }
  if (!file.url) {
    const failed: DlTask = {
      ...current,
      hasLocalFiles: current.files.some((f) => f.status === "done"),
      files: current.files.map((f) => (f.key === file.key ? { ...f, status: "failed", received: 0 } : f)),
    };
    const nextFiles = startNextFile(failed.files);
    const still = nextFiles.some((f) => f.status === "downloading");
    if (!still) {
      finishWork({ ...failed, files: nextFiles });
      return;
    }
    useApp.setState({
      dlTasks: patchTask(useApp.getState().dlTasks, current.workId, () => ({
        ...failed,
        files: nextFiles,
      })),
    });
    return;
  }

  const chunk = file.type === "video" ? 420_000 : 280_000;
  const received = Math.min(file.total, file.received + chunk);
  const files = current.files.map((f) =>
    f.key === file.key
      ? { ...f, received, status: (received >= f.total ? "done" : "downloading") as DlTask["files"][number]["status"] }
      : f,
  );
  let next: DlTask = { ...current, files, hasLocalFiles: true, speed: 0 };
  if (received >= file.total) {
    const continued = startNextFile(files);
    if (!continued.some((f) => f.status === "downloading")) {
      finishWork({ ...next, files: continued });
      return;
    }
    next = { ...next, files: continued };
  }
  const now = Date.now();
  const dt = Math.max(0.1, (now - lastSpeedAt) / 1000);
  const allReceived = tasks.reduce((n, t) => n + receivedOf(t.workId === next.workId ? next : t), 0);
  const speed = Math.max(0, (allReceived - lastBytes) / dt);
  lastBytes = allReceived;
  lastSpeedAt = now;
  next = { ...next, speed };
  useApp.setState({
    dlTasks: patchTask(useApp.getState().dlTasks, next.workId, () => next),
    dlSpeed: speed,
  });
}

function startNextFile(files: DlTask["files"]): DlTask["files"] {
  const next = files.find((f) => f.status === "waiting");
  if (!next) return files;
  return files.map((f) => (f.key === next.key ? { ...f, status: "downloading" as const } : f));
}

async function pumpDesktop() {
  if (desktopPumping) return;
  const api = desktop();
  if (!api) return;
  desktopPumping = true;
  try {
    while (true) {
      const s = useApp.getState();
      if (s.dlPauseAll) break;
      const id = pickNextWorkId(s.dlTasks, false);
      if (!id) break;
      const task = s.dlTasks.find((t) => t.workId === id);
      const work = s.works.find((w) => w.id === id);
      if (!task || !work) break;
      useApp.setState({
        dlTasks: patchTask(s.dlTasks, id, (t) => ({ ...t, status: "downloading" })),
      });
      const res = await api.dlRun({
        work,
        folderName: folderNameOf(task.folderId),
        files: task.files,
      });
      if (useApp.getState().dlPauseAll) break;
      if (res?.paused) continue;
      if (res?.aborted) continue;
    }
  } finally {
    desktopPumping = false;
  }
}

export function abortDesktop(reason: "pause" | "cancel" | "pause-all") {
  const api = desktop();
  if (api) void api.dlAbort(reason);
}

export function applyDesktopDlEvent(ev: {
  type: string;
  workId: string;
  fileKey?: string;
  received?: number;
  total?: number;
  speed?: number;
  work?: Work;
  status?: Work["status"];
  videoStatus?: Work["videoStatus"];
}) {
  const { workId } = ev;
  if (ev.type === "progress") {
    useApp.setState((s) => ({
      dlSpeed: ev.speed ?? s.dlSpeed,
      dlTasks: patchTask(s.dlTasks, workId, (t) => ({
        ...t,
        status: "downloading",
        speed: ev.speed ?? t.speed,
        hasLocalFiles: true,
        files: t.files.map((f) =>
          f.key === ev.fileKey
            ? {
                ...f,
                status: "downloading" as const,
                received: ev.received ?? f.received,
                total: ev.total || f.total,
              }
            : f.status === "downloading" && f.key !== ev.fileKey
              ? { ...f, status: "waiting" as const }
              : f,
        ),
      })),
    }));
    return;
  }
  if (ev.type === "file-done" || ev.type === "file-fail") {
    useApp.setState((s) => ({
      dlTasks: patchTask(s.dlTasks, workId, (t) => ({
        ...t,
        hasLocalFiles: true,
        files: t.files.map((f) =>
          f.key === ev.fileKey
            ? {
                ...f,
                status: ev.type === "file-done" ? "done" : "failed",
                received: ev.type === "file-done" ? f.total || f.received : f.received,
              }
            : f,
        ),
      })),
    }));
    return;
  }
  if (ev.type === "work-done") {
    const task = useApp.getState().dlTasks.find((t) => t.workId === workId);
    if (task) finishWork(task);
    return;
  }
  if (ev.type === "work-paused") {
    useApp.setState((s) => ({
      dlTasks: patchTask(s.dlTasks, workId, (t) => ({
        ...t,
        status: "paused",
        speed: 0,
        files: t.files.map((f) => (f.status === "downloading" ? { ...f, status: "waiting" as const } : f)),
      })),
      dlSpeed: 0,
    }));
  }
}
