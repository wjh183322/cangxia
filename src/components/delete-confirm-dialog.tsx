import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";
import type { Work } from "@/lib/types";

export function DeleteConfirmDialog() {
  const ids = useApp((s) => s.deleteIds);
  const works = useApp((s) => s.works);
  const error = useApp((s) => s.deleteError);
  const confirmDelete = useApp((s) => s.confirmDelete);
  const cancelDelete = useApp((s) => s.cancelDelete);

  const selected = ids.map((id) => works.find((w) => w.id === id)).filter((w): w is Work => Boolean(w));
  const stale = selected.filter((w) => w.status === "stale");

  useEffect(() => {
    if (!ids.length) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancelDelete();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids.length, cancelDelete]);

  if (!ids.length) return null;

  const titles = selected.map((w) => w.title);
  const shown = titles.slice(0, 8);
  const extra = titles.length - shown.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        <p className="text-xs font-medium text-danger">删除本机备份</p>
        <h2 className="mt-2 text-lg font-semibold">
          {selected.length <= 1 ? selected[0]?.title || "删除作品" : `删除 ${selected.length} 个作品`}
        </h2>
        {selected.length > 1 && (
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {shown.join("、")}
            {extra > 0 ? ` 等 ${extra} 个` : ""}
          </p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-muted">
          将删除本机文件夹里的图、视频和记录。不能从回收站找回。抖音收藏不会动。
        </p>
        {stale.length > 0 && (
          <p className="mt-3 text-sm leading-relaxed text-warn">
            {stale.length === 1
              ? `「${stale[0].title}」已失效，删除后无法重新下载。`
              : `其中 ${stale.map((w) => `「${w.title}」`).join("、")} 已失效，删除后无法重新下载。`}
          </p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" variant="danger" onClick={() => void confirmDelete()}>
            删除
          </Button>
          <Button className="flex-1" variant="secondary" onClick={cancelDelete}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
