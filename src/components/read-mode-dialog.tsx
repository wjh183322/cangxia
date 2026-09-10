import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";

export function ReadModeDialog() {
  const open = useApp((s) => s.readModeOpen);
  const error = useApp((s) => s.readModeError);
  const count = useApp((s) => s.readModeCount);
  const setCount = useApp((s) => s.setReadModeCount);
  const confirm = useApp((s) => s.confirmReadMode);
  const cancel = useApp((s) => s.cancelReadMode);
  const folderName = useApp((s) => s.folders.find((f) => f.id === s.folderId)?.name || "收藏");

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, cancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        <p className="text-xs font-medium text-muted">读取收藏</p>
        <h2 className="mt-2 text-lg font-semibold">怎么读「{folderName}」</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          总收藏只支持限定数量。自建夹只支持全部读取进清单，下载仍要勾选。
        </p>
        <label className="mt-4 block text-sm">
          限定数量
          <input
            className="mt-1 h-11 w-full rounded-md border border-line bg-raised px-3 text-sm"
            type="number"
            min={1}
            max={5000}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        {error ? <p className="mt-3 text-sm text-warn">{error}</p> : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={() => confirm("all")}>
            全部读取
          </Button>
          <Button className="flex-1" variant="secondary" onClick={() => confirm("limit")}>
            限定数量读取
          </Button>
          <Button className="flex-1" variant="ghost" onClick={() => cancel()}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
