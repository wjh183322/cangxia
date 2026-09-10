import { KindTabs, kindHint } from "@/components/kind-tabs";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { listWorks, useApp } from "@/lib/store";
import { folderTitle, kindChip } from "@/lib/utils";
import { useEffect, useState } from "react";

export function CollectView() {
  const works = useApp((s) => s.works);
  const folders = useApp((s) => s.folders);
  const folderId = useApp((s) => s.folderId);
  const kind = useApp((s) => s.kind);
  const setKind = useApp((s) => s.setKind);
  const selectedIds = useApp((s) => s.selectedIds);
  const toggleSelect = useApp((s) => s.toggleSelect);
  const rangeFrom = useApp((s) => s.rangeFrom);
  const rangeTo = useApp((s) => s.rangeTo);
  const setRange = useApp((s) => s.setRange);
  const startDownload = useApp((s) => s.startDownload);
  const hiddenCollectIds = useApp((s) => s.hiddenCollectIds);
  const hideFromCollect = useApp((s) => s.hideFromCollect);
  const hideFolderFromCollect = useApp((s) => s.hideFolderFromCollect);
  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => {
    if (!confirmAll) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirmAll(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmAll]);

  const list = listWorks(works, folderId, kind, hiddenCollectIds);
  const folderName = folders.find((f) => f.id === folderId)?.name || "收藏";
  const folderCount = works.filter(
    (w) => !hiddenCollectIds.includes(w.id) && (w.folderId === folderId || w.alsoInFolderIds.includes(folderId)),
  ).length;

  function downloadRange() {
    const from = Math.max(1, Number(rangeFrom) || 1);
    const to = Math.max(from, Number(rangeTo) || from);
    const ids = list.slice(from - 1, to).map((w) => w.id);
    startDownload(ids);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <KindTabs value={kind} onChange={setKind} />
        <p className="text-xs text-muted">{kindHint(kind, "collect")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          从第
          <input
            className="h-11 w-16 rounded-md border border-line bg-raised px-2 text-sm text-fg"
            value={rangeFrom}
            onChange={(e) => setRange(e.target.value, rangeTo)}
            inputMode="numeric"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          到第
          <input
            className="h-11 w-16 rounded-md border border-line bg-raised px-2 text-sm text-fg"
            value={rangeTo}
            onChange={(e) => setRange(rangeFrom, e.target.value)}
            inputMode="numeric"
          />
        </label>
        <Button size="sm" variant="secondary" onClick={downloadRange}>
          按序号下载
        </Button>
        <Button size="sm" onClick={() => startDownload(selectedIds)} disabled={selectedIds.length === 0}>
          下载选中（{selectedIds.length}）
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => hideFromCollect(selectedIds)}
          disabled={selectedIds.length === 0}
        >
          移出清单（{selectedIds.length}）
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConfirmAll(true)} disabled={folderCount === 0}>
          全部移出当前夹
        </Button>
      </div>

      {confirmAll && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
            <p className="text-xs font-medium text-muted">移出清单</p>
            <h2 className="mt-2 text-lg font-semibold">全部移出「{folderName}」</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              从清单移出全部 {folderCount} 条。图库和硬盘文件不动，只是收藏页不再显示。
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1"
                onClick={() => {
                  hideFolderFromCollect(folderId);
                  setConfirmAll(false);
                }}
              >
                确认移出
              </Button>
              <Button className="flex-1" variant="secondary" onClick={() => setConfirmAll(false)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {list.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">这个列表是空的。先点「读取收藏夹」勾选要显示的夹，再点左侧夹，点「读取收藏」读作品。</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.map((work, index) => {
              const checked = selectedIds.includes(work.id);
              return (
                <li key={work.id}>
                  <button
                    type="button"
                    onClick={() => toggleSelect(work.id)}
                    className={`group w-full overflow-hidden rounded-lg border text-left transition-colors ${
                      checked ? "border-accent" : "border-line hover:border-muted"
                    }`}
                  >
                    <div className="relative aspect-portrait bg-raised">
                      <img
                        src={work.coverUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                      <span className="absolute left-2 top-2 rounded-sm bg-bg/80 px-1.5 py-0.5 text-[11px] tabular-nums text-fg">
                        {index + 1}
                      </span>
                      {!work.collectTimeKnown && (
                        <span className="absolute left-2 top-9 rounded-sm bg-bg/80 px-1.5 py-0.5 text-[11px] text-warn">
                          无收藏时间
                        </span>
                      )}
                      {kindChip(work) && (
                        <span
                          className={`absolute left-2 rounded-sm bg-bg/80 px-1.5 py-0.5 text-[11px] text-fg ${
                            work.collectTimeKnown ? "top-9" : "top-16"
                          }`}
                        >
                          {kindChip(work)}
                        </span>
                      )}
                      <span
                        className={`absolute right-2 top-2 size-5 rounded-xs border ${
                          checked ? "border-accent bg-accent" : "border-fg/70 bg-bg/40"
                        }`}
                      />
                    </div>
                    <div className="space-y-1 p-2.5">
                      <StatusBadge work={work} />
                      <p className="line-clamp-2 text-sm font-medium leading-snug">{work.title}</p>
                      <p className="truncate text-xs text-muted">
                        {work.authorName} · {work.douyinId}
                      </p>
                      <p className="truncate text-[11px] text-subtle">{folderTitle(work.title, work.id)}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
