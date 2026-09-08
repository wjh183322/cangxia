import { useMemo, useState } from "react";
import { BrowseOverlay } from "@/components/browse-overlay";
import { KindTabs, kindHint } from "@/components/kind-tabs";
import { StatusBadge } from "@/components/status-badge";
import { TagPickerDialog } from "@/components/tag-picker-dialog";
import { VideoPlayer } from "@/components/video-player";
import { Button } from "@/components/ui/button";
import { isDesktop } from "@/lib/desktop";
import { inFolder, useApp } from "@/lib/store";
import type { Work } from "@/lib/types";
import { folderTitle, kindChip, matchesKind, videoStatusOf, workVideos } from "@/lib/utils";

function tagOptions(works: Work[], key: "hashtags" | "userTags") {
  const counts = new Map<string, number>();
  for (const work of works) {
    for (const tag of work[key]) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"));
}

export function LibraryView() {
  const works = useApp((s) => s.works);
  const kind = useApp((s) => s.kind);
  const setKind = useApp((s) => s.setKind);
  const libraryWorkId = useApp((s) => s.libraryWorkId);
  const openLibraryWork = useApp((s) => s.openLibraryWork);
  const filterAuthor = useApp((s) => s.filterAuthor);
  const filterDouyin = useApp((s) => s.filterDouyin);
  const filterTag = useApp((s) => s.filterTag);
  const filterUserTag = useApp((s) => s.filterUserTag);
  const setFilters = useApp((s) => s.setFilters);
  const folders = useApp((s) => s.folders);
  const libraryFolderId = useApp((s) => s.libraryFolderId);
  const setViewerIndex = useApp((s) => s.setViewerIndex);
  const addUserTag = useApp((s) => s.addUserTag);
  const applyTagFilter = useApp((s) => s.applyTagFilter);
  const clearLibraryFilters = useApp((s) => s.clearLibraryFilters);
  const browseArmed = useApp((s) => s.browseArmed);
  const browseWorkId = useApp((s) => s.browseWorkId);
  const armBrowse = useApp((s) => s.armBrowse);
  const openBrowse = useApp((s) => s.openBrowse);
  const tidyArmed = useApp((s) => s.tidyArmed);
  const tidyIds = useApp((s) => s.tidyIds);
  const armTidy = useApp((s) => s.armTidy);
  const toggleTidy = useApp((s) => s.toggleTidy);
  const setTidyIds = useApp((s) => s.setTidyIds);
  const askDelete = useApp((s) => s.askDelete);
  const job = useApp((s) => s.job);
  const dlBusy = useApp((s) => s.dlTasks.some((t) => t.status === "downloading"));
  const busy = job.active || dlBusy;
  const [draftTag, setDraftTag] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<"topic" | "user">("topic");

  const downloaded = works.filter((w) => {
    if (!(w.status === "downloaded" || w.status === "stale")) return false;
    if (!matchesKind(w, kind)) return false;
    if (libraryFolderId && libraryFolderId !== "all" && !inFolder(w, libraryFolderId)) return false;
    return true;
  });
  const topicOptions = useMemo(() => tagOptions(downloaded, "hashtags"), [downloaded]);
  const userTagOptions = useMemo(() => tagOptions(downloaded, "userTags"), [downloaded]);

  const filtered = useMemo(() => {
    const rank = (w: Work) =>
      libraryFolderId === "default" || libraryFolderId === "all" ? (w.allIndex ?? 1e12) : (w.listIndex ?? 1e12);
    return downloaded
      .filter((w) => !filterAuthor || w.authorName.includes(filterAuthor))
      .filter((w) => !filterDouyin || w.douyinId.includes(filterDouyin))
      .filter((w) => !filterTag || w.hashtags.includes(filterTag))
      .filter((w) => !filterUserTag || w.userTags.includes(filterUserTag))
      .sort((a, b) => rank(a) - rank(b) || b.collectedAt - a.collectedAt);
  }, [downloaded, filterAuthor, filterDouyin, filterTag, filterUserTag, libraryFolderId]);

  const work = downloaded.find((w) => w.id === libraryWorkId) ?? null;
  const folderName = folders.find((f) => f.id === work?.folderId)?.name;

  function applyTopic(tag: string) {
    if (!work) return;
    applyTagFilter("topic", tag, work.id);
  }

  function applyUserTag(tag: string) {
    if (!work) return;
    applyTagFilter("user", tag, work.id);
  }

  if (work) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => openLibraryWork(null)}>
            返回封面墙
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{work.title}</p>
            <p className="truncate text-xs text-muted">
              {work.authorName} · {work.douyinId} · {folderName}
              {workVideos(work).length
                ? videoStatusOf(work) === "saved"
                  ? ` · 视频${workVideos(work).length}段`
                  : " · 无原视频"
                : ""}
            </p>
          </div>
          <StatusBadge work={work} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <input
            value={draftTag}
            onChange={(e) => setDraftTag(e.target.value)}
            placeholder="自己打标签"
            className="h-11 min-w-40 flex-1 rounded-md border border-line bg-raised px-3 text-sm"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              addUserTag(work.id, draftTag);
              setDraftTag("");
            }}
          >
            添加
          </Button>
          <Button size="sm" variant="secondary" onClick={() => openBrowse(work.id)}>
            浏览
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => askDelete([work.id])}
          >
            删除
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.alert(
                `本机路径（演示）\n${useApp.getState().settings.rootPath}\\${folderName}\\${folderTitle(work.title, work.id)}`,
              );
            }}
          >
            打开所在文件夹
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <p className="mb-3 text-xs leading-relaxed text-muted">{work.caption}</p>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {work.hashtags.map((t) => (
              <button
                key={t}
                type="button"
                className="h-9 rounded-full bg-raised px-3 text-xs text-muted hover:bg-line hover:text-fg"
                onClick={() => applyTopic(t)}
              >
                #{t}
              </button>
            ))}
            {work.userTags.map((t) => (
              <button
                key={t}
                type="button"
                className="h-9 rounded-full bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
                onClick={() => applyUserTag(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {work.images.map((img, i) => (
              <li key={img.id}>
                <button
                  type="button"
                  className="aspect-portrait w-full overflow-hidden rounded-md border border-line"
                  onClick={() => setViewerIndex(i)}
                >
                  <img src={img.url} alt="" className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
          {workVideos(work).length > 0 && (
            <div className="mt-4 space-y-3">
              {videoStatusOf(work) === "saved"
                ? workVideos(work).map((clip, i) => (
                    <div key={clip.id} className="overflow-hidden rounded-lg border border-line">
                      <p className="border-b border-line px-3 py-2 text-xs text-muted">
                        视频{i + 1}.mp4
                      </p>
                      <VideoPlayer src={clip.url} poster={work.images[i]?.url || work.coverUrl} />
                    </div>
                  ))
                : (
                  <p className="rounded-lg border border-line px-4 py-10 text-center text-sm text-muted">
                    原视频未保存，无法播放
                  </p>
                )}
              <p className="text-xs text-subtle">
                {isDesktop()
                  ? "无水印原视频 · 内置播放，带原声。图和视频都在同一作品文件夹。"
                  : "预览片段没有音轨所以无声。本机下载的原视频会带原声。图和多段视频都下进同一文件夹。"}
              </p>
            </div>
          )}
          <p className="mt-3 text-xs text-subtle">点话题或自打标签可筛选同类作品。点图片进入单图浏览。</p>
        </div>
      </div>
    );
  }

  const hasFilters = Boolean(filterAuthor || filterDouyin || filterTag || filterUserTag);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <KindTabs value={kind} onChange={setKind} />
        <Button size="sm" variant={browseArmed ? "primary" : "secondary"} onClick={() => armBrowse()}>
          {browseArmed ? "点一条开始 · 再点取消" : "浏览"}
        </Button>
        <Button
          size="sm"
          variant={tidyArmed ? "primary" : "secondary"}
          disabled={busy}
          onClick={() => armTidy()}
        >
          {tidyArmed ? "退出整理" : "整理"}
        </Button>
        {tidyArmed && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || filtered.length === 0}
              onClick={() => {
                const ids = filtered.map((w) => w.id);
                const allOn = ids.length > 0 && ids.every((id) => tidyIds.includes(id));
                setTidyIds(allOn ? [] : ids);
              }}
            >
              {filtered.length > 0 && filtered.every((w) => tidyIds.includes(w.id))
                ? "取消全选"
                : `全选（${filtered.length}）`}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy || tidyIds.length === 0}
              onClick={() => askDelete(tidyIds)}
            >
              删除选中（{tidyIds.length}）
            </Button>
          </>
        )}
        <p className="text-xs text-muted">
          {tidyArmed
            ? "可全选当前列表，再点删除选中。再点整理取消。"
            : browseArmed
              ? "点一条封面，从这条开始上下浏览。封面墙不会先打开作品。"
              : kindHint(kind, "library")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 border-b border-line p-4 sm:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">
          作者名
          <input
            className="h-11 rounded-md border border-line bg-raised px-3 text-sm text-fg"
            placeholder="搜索作者"
            value={filterAuthor}
            onChange={(e) => setFilters({ filterAuthor: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">
          抖音号
          <input
            className="h-11 rounded-md border border-line bg-raised px-3 text-sm text-fg"
            placeholder="搜索抖音号"
            value={filterDouyin}
            onChange={(e) => setFilters({ filterDouyin: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted sm:col-span-1">
          话题
          <div className="flex gap-1">
            <select
              className="h-11 min-w-0 flex-1 rounded-md border border-line bg-raised px-3 text-sm text-fg"
              value={filterTag}
              onChange={(e) => setFilters({ filterTag: e.target.value })}
            >
              <option value="">全部话题</option>
              {topicOptions.map(([tag, count]) => (
                <option key={tag} value={tag}>
                  #{tag}（{count}）
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-11 shrink-0 px-3"
              onClick={() => {
                setPickerTab("topic");
                setPickerOpen(true);
              }}
            >
              挑选
            </Button>
          </div>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">
          自打标签
          <div className="flex gap-1">
            <select
              className="h-11 min-w-0 flex-1 rounded-md border border-line bg-raised px-3 text-sm text-fg"
              value={filterUserTag}
              onChange={(e) => setFilters({ filterUserTag: e.target.value })}
            >
              <option value="">全部自打标签</option>
              {userTagOptions.length === 0 && <option disabled>还没有自打标签</option>}
              {userTagOptions.map(([tag, count]) => (
                <option key={tag} value={tag}>
                  {tag}（{count}）
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-11 shrink-0 px-3"
              onClick={() => {
                setPickerTab("user");
                setPickerOpen(true);
              }}
            >
              挑选
            </Button>
          </div>
        </label>
      </div>
      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          {filterTag && (
            <span className="rounded-full bg-raised px-2 py-1 text-xs text-muted">话题 #{filterTag}</span>
          )}
          {filterUserTag && (
            <span className="rounded-full bg-accent/10 px-2 py-1 text-xs text-accent">{filterUserTag}</span>
          )}
          <Button size="sm" variant="ghost" onClick={clearLibraryFilters}>
            清除筛选
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">
            {kind === "video"
              ? "还没有已下载的视频，或筛选无结果。"
              : kind === "album"
                ? "还没有已下载的图集，或筛选无结果。"
                : "还没有已下载的作品，或筛选无结果。"}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((w) => {
              const checked = tidyIds.includes(w.id);
              return (
              <li key={w.id}>
                <button
                  type="button"
                  className={`w-full overflow-hidden rounded-lg border text-left hover:border-muted ${
                    tidyArmed && checked ? "border-accent" : browseArmed || tidyArmed ? "border-accent/60" : "border-line"
                  }`}
                  onClick={() => {
                    if (tidyArmed) toggleTidy(w.id);
                    else if (browseArmed) openBrowse(w.id);
                    else openLibraryWork(w.id);
                  }}
                >
                  <div className="relative aspect-portrait bg-raised">
                    <img src={w.coverUrl} alt="" className="size-full object-cover" />
                    {kindChip(w) && (
                      <span className="absolute left-2 top-2 rounded-sm bg-bg/80 px-1.5 py-0.5 text-[11px] text-fg">
                        {kindChip(w)}
                      </span>
                    )}
                    {tidyArmed && (
                      <span
                        className={`absolute right-2 top-2 size-5 rounded-xs border ${
                          checked ? "border-accent bg-accent" : "border-fg/70 bg-bg/40"
                        }`}
                      />
                    )}
                  </div>
                  <div className="space-y-1 p-2.5">
                    <StatusBadge work={w} />
                    <p className="line-clamp-2 text-sm font-medium leading-snug">{w.title}</p>
                    <p className="truncate text-xs text-muted">
                      {w.authorName} · {w.douyinId}
                    </p>
                  </div>
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>
      {browseWorkId && <BrowseOverlay works={filtered} />}
      <TagPickerDialog
        open={pickerOpen}
        initialTab={pickerTab}
        topics={topicOptions}
        userTags={userTagOptions}
        selectedTopic={filterTag}
        selectedUserTag={filterUserTag}
        onClose={() => setPickerOpen(false)}
        onPickTopic={(tag) => {
          setFilters({ filterTag: tag });
          setPickerOpen(false);
        }}
        onPickUserTag={(tag) => {
          setFilters({ filterUserTag: tag });
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
