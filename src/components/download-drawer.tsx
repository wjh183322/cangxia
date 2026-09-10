import { useState } from "react";
import { ChevronDown, FolderOpen, Pause, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dlCounts,
  fileSummary,
  formatBytes,
  formatSpeed,
  receivedOf,
  statusLabel,
  totalOf,
  videoPendingCount,
  type DlTask,
} from "@/lib/download";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export function DownloadDrawer() {
  const open = useApp((s) => s.dlOpen);
  const setOpen = useApp((s) => s.setDlOpen);
  const tasks = useApp((s) => s.dlTasks);
  const pauseAll = useApp((s) => s.dlPauseAll);
  const pauseAllDl = useApp((s) => s.pauseAllDl);
  const resumeAllDl = useApp((s) => s.resumeAllDl);
  const askCancelDl = useApp((s) => s.askCancelDl);
  const clearDlDone = useApp((s) => s.clearDlDone);
  const expanded = useApp((s) => s.dlExpandedId);
  const setExpanded = useApp((s) => s.setDlExpanded);
  const pauseDlTask = useApp((s) => s.pauseDlTask);
  const resumeDlTask = useApp((s) => s.resumeDlTask);
  const retryDlTask = useApp((s) => s.retryDlTask);
  const openWorkFolder = useApp((s) => s.openWorkFolder);
  const [tab, setTab] = useState<"active" | "done">("active");

  if (!open) return null;

  const active = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const pendingVideos = videoPendingCount(tasks);
  const list = tab === "active" ? active : done;

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-bg/50" onClick={() => setOpen(false)}>
      <aside
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-lg sm:w-[26rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <p className="text-sm font-semibold">下载管理</p>
            <p className="text-xs text-muted">
              {tasks.length === 0
                ? "队列是空的"
                : tab === "active"
                  ? `视频待下 ${pendingVideos} · ${active.length} 件`
                  : `${done.length} 件已完成`}
            </p>
          </div>
          <Button size="icon" variant="ghost" className="size-9" onClick={() => setOpen(false)} aria-label="关闭">
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex rounded-md bg-raised p-1">
            <button
              type="button"
              className={`h-9 rounded-sm px-3 text-sm ${tab === "active" ? "bg-surface text-fg" : "text-muted"}`}
              onClick={() => setTab("active")}
            >
              正在下载
              {active.length > 0 ? ` ${active.length}` : ""}
            </button>
            <button
              type="button"
              className={`h-9 rounded-sm px-3 text-sm ${tab === "done" ? "bg-surface text-fg" : "text-muted"}`}
              onClick={() => setTab("done")}
            >
              已下载
              {done.length > 0 ? ` ${done.length}` : ""}
            </button>
          </div>
          {tab === "active" ? (
            <>
              {pauseAll ? (
                <Button size="sm" variant="secondary" onClick={resumeAllDl} disabled={active.length === 0}>
                  全部继续
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={pauseAllDl} disabled={active.length === 0}>
                  全部暂停
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                disabled={active.length === 0}
                onClick={() => askCancelDl(active.map((t) => t.workId))}
              >
                全部取消
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={done.length === 0} onClick={clearDlDone}>
              清除已完成
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {list.length === 0 ? (
            <p className="px-1 py-10 text-center text-sm text-muted">
              {tasks.length === 0
                ? "在读取里勾选作品后点下载，任务会出现在这里。"
                : tab === "active"
                  ? "没有正在下的任务。"
                  : "还没有下完的任务。"}
            </p>
          ) : (
            <ul className="space-y-2">
              {list.map((task) => (
                <TaskRow
                  key={task.workId}
                  task={task}
                  expanded={expanded === task.workId}
                  onExpand={() => setExpanded(expanded === task.workId ? null : task.workId)}
                  onPause={() => pauseDlTask(task.workId)}
                  onResume={() => resumeDlTask(task.workId)}
                  onRetry={() => retryDlTask(task.workId)}
                  onCancel={() => askCancelDl([task.workId])}
                  onOpenFolder={() => openWorkFolder(task.workId)}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function TaskRow({
  task,
  expanded,
  onExpand,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onOpenFolder,
}: {
  task: DlTask;
  expanded: boolean;
  onExpand: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  onOpenFolder?: () => void;
}) {
  const rec = receivedOf(task);
  const tot = totalOf(task);
  const pct = tot > 0 ? Math.min(100, Math.round((rec / tot) * 100)) : task.status === "done" ? 100 : 0;
  return (
    <li className="rounded-lg border border-line bg-raised/60 p-2.5">
      <div className="flex gap-2">
        <img src={task.coverUrl} alt="" className="size-12 shrink-0 rounded-sm object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.title}</p>
          <p className="truncate text-[11px] text-muted">
            {task.authorName} · {fileSummary(task)} · {statusLabel(task.status)}
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-subtle">
            {formatBytes(rec)} / {formatBytes(tot)}
            {task.status === "downloading" ? ` · ${formatSpeed(task.speed)}` : ""}
            {` · ${pct}%`}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {task.status === "downloading" || task.status === "waiting" ? (
          <Button size="sm" variant="secondary" onClick={onPause}>
            <Pause className="size-3.5" />
            暂停
          </Button>
        ) : null}
        {task.status === "paused" ? (
          <Button size="sm" variant="secondary" onClick={onResume}>
            <Play className="size-3.5" />
            继续
          </Button>
        ) : null}
        {task.status === "partial" || task.status === "failed" ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RotateCcw className="size-3.5" />
            重试
          </Button>
        ) : null}
        {task.status === "done" ? (
          <Button size="sm" variant="secondary" onClick={onOpenFolder}>
            <FolderOpen className="size-3.5" />
            打开所在文件夹
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onExpand}>
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          文件
        </Button>
      </div>
      {expanded && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2">
          {task.files.map((file) => {
            const fp = file.total ? Math.round((file.received / file.total) * 100) : 0;
            return (
              <li key={file.key} className="flex items-center gap-2 text-[11px] text-muted">
                <span className="w-16 shrink-0 text-subtle">{file.type === "video" ? "视频" : "图"}</span>
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="tabular-nums text-subtle">
                  {file.status === "failed" ? "失败" : file.status === "done" ? "完成" : `${fp}%`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function DownloadMiniBar() {
  const tasks = useApp((s) => s.dlTasks);
  const speed = useApp((s) => s.dlSpeed);
  const open = useApp((s) => s.dlOpen);
  const setOpen = useApp((s) => s.setDlOpen);
  if (tasks.length === 0) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        下载
      </Button>
    );
  }
  const { done, total } = dlCounts(tasks);
  const busy = tasks.some((t) => t.status === "downloading");
  const failed = tasks.some((t) => t.status === "partial" || t.status === "failed");
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className="flex h-9 items-center gap-2 rounded-md border border-line bg-raised px-3 text-left text-xs text-muted hover:bg-surface"
    >
      <span className="font-medium text-fg">下载</span>
      <span className="tabular-nums">
        {done}/{total}
      </span>
      <span className="tabular-nums text-subtle">
        {busy ? formatSpeed(speed) : done === total ? "已完成" : failed ? "有失败" : "已暂停"}
      </span>
    </button>
  );
}
