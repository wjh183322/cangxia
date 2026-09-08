import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";

export function FolderPickDialog() {
  const list = useApp((s) => s.pendingFolderPick);
  const checked = useApp((s) => s.folderPickChecked);
  const toggle = useApp((s) => s.toggleFolderPick);
  const setAll = useApp((s) => s.setFolderPickAll);
  const confirm = useApp((s) => s.confirmFolderPick);
  const cancel = useApp((s) => s.cancelFolderPick);

  useEffect(() => {
    if (!list) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, cancel]);

  if (!list) return null;
  const allOn = list.length > 0 && checked.length === list.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
      <div className="flex max-h-[min(80dvh,640px)] w-full max-w-md flex-col rounded-xl border border-line bg-surface p-6">
        <p className="text-xs font-medium text-muted">读取收藏夹</p>
        <h2 className="mt-2 text-lg font-semibold">选择要显示的收藏夹</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          没勾的夹不会出现在左侧。作品仍按总收藏读取；等你以后读这个夹，再归进对应文件夹。
        </p>
        {list.length === 0 ? (
          <p className="mt-4 text-sm text-muted">没有读到自建收藏夹。</p>
        ) : (
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-md border border-line">
            {list.map((f) => {
              const on = checked.includes(f.id);
              return (
                <label
                  key={f.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-line px-3 last:border-b-0 hover:bg-raised/60"
                >
                  <input type="checkbox" className="size-4 accent-fg" checked={on} onChange={() => toggle(f.id)} />
                  <span className="truncate text-sm">{f.name}</span>
                </label>
              );
            })}
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" variant="secondary" onClick={() => setAll(!allOn)} disabled={!list.length}>
            {allOn ? "取消全选" : "全选"}
          </Button>
          <Button className="flex-1" onClick={() => confirm()} disabled={!list.length && checked.length === 0}>
            确定（{checked.length}）
          </Button>
          <Button className="flex-1" variant="ghost" onClick={() => cancel()}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
