import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";

export function FolderDeleteDialog() {
  const id = useApp((s) => s.pendingFolderDeleteId);
  const folders = useApp((s) => s.folders);
  const works = useApp((s) => s.works);
  const hiddenCollectIds = useApp((s) => s.hiddenCollectIds);
  const confirmDeleteFolder = useApp((s) => s.confirmDeleteFolder);
  const cancelDeleteFolder = useApp((s) => s.cancelDeleteFolder);

  const folder = folders.find((f) => f.id === id) || null;
  const count = id ? works.filter((w) => w.folderId === id).length : 0;

  useEffect(() => {
    if (!id) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancelDeleteFolder();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, cancelDeleteFolder]);

  if (!id || !folder) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        <p className="text-xs font-medium text-danger">从清单删除收藏夹</p>
        <h2 className="mt-2 text-lg font-semibold">删除「{folder.name}」</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          将从左侧去掉这个收藏夹，并移出其中 {count} 条。总收藏清单里同一条也会去掉。本地和硬盘文件不动。
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" variant="danger" onClick={() => confirmDeleteFolder()}>
            确认删除
          </Button>
          <Button className="flex-1" variant="secondary" onClick={() => cancelDeleteFolder()}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
