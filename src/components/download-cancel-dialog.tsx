import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";

export function DownloadCancelDialog() {
  const ids = useApp((s) => s.dlCancelIds);
  const tasks = useApp((s) => s.dlTasks);
  const confirm = useApp((s) => s.confirmCancelDl);
  const cancel = useApp((s) => s.cancelCancelDl);

  const selected = ids.map((id) => tasks.find((t) => t.workId === id)).filter((t) => Boolean(t));

  useEffect(() => {
    if (!ids.length) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids.length, cancel]);

  if (!ids.length) return null;

  const titles = selected.map((t) => t!.title);
  const shown = titles.slice(0, 8);
  const extra = titles.length - shown.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        <p className="text-xs font-medium text-danger">取消并删除本机文件</p>
        <h2 className="mt-2 text-lg font-semibold">
          {selected.length <= 1 ? selected[0]?.title || "取消任务" : `取消 ${selected.length} 个未完成任务`}
        </h2>
        {selected.length > 1 && (
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {shown.join("、")}
            {extra > 0 ? ` 等 ${extra} 个` : ""}
          </p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-muted">
          将删除这些作品的整个本机文件夹（图、视频和记录）。不能从回收站找回。抖音收藏不会动。本地里会消失，读取清单里同一条改回「新」。
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" variant="danger" onClick={() => void confirm()}>
            取消任务并删除
          </Button>
          <Button className="flex-1" variant="secondary" onClick={cancel}>
            返回
          </Button>
        </div>
      </div>
    </div>
  );
}
