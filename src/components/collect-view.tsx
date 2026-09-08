import { KindTabs, kindHint } from "@/components/kind-tabs";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { listWorks, useApp } from "@/lib/store";
import { folderTitle, kindChip, workIsComplete } from "@/lib/utils";

export function CollectView() {
  const works = useApp((s) => s.works);
  const folderId = useApp((s) => s.folderId);
  const kind = useApp((s) => s.kind);
  const setKind = useApp((s) => s.setKind);
  const selectedIds = useApp((s) => s.selectedIds);
  const toggleSelect = useApp((s) => s.toggleSelect);
  const rangeFrom = useApp((s) => s.rangeFrom);
  const rangeTo = useApp((s) => s.rangeTo);
  const setRange = useApp((s) => s.setRange);
  const startDownload = useApp((s) => s.startDownload);

  const list = listWorks(works, folderId, kind);

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
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {list.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">这个列表是空的。点右上角刷新同步收藏。</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.map((work, index) => {
              const checked = selectedIds.includes(work.id);
              const locked = workIsComplete(work);
              return (
                <li key={work.id}>
                  <button
                    type="button"
                    onClick={() => !locked && toggleSelect(work.id)}
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
                      {kindChip(work) && (
                        <span className="absolute left-2 top-9 rounded-sm bg-bg/80 px-1.5 py-0.5 text-[11px] text-fg">
                          {kindChip(work)}
                        </span>
                      )}
                      {!locked && (
                        <span
                          className={`absolute right-2 top-2 size-5 rounded-xs border ${
                            checked ? "border-accent bg-accent" : "border-fg/70 bg-bg/40"
                          }`}
                        />
                      )}
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
