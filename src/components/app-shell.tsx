import { RefreshCw, Settings, FolderClosed, X } from "lucide-react";
import { CaptchaDialog } from "@/components/captcha-dialog";
import { CollectView } from "@/components/collect-view";
import { FolderDeleteDialog } from "@/components/folder-delete-dialog";
import { FolderPickDialog } from "@/components/folder-pick-dialog";
import { ReadModeDialog } from "@/components/read-mode-dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { DownloadCancelDialog } from "@/components/download-cancel-dialog";
import { DownloadDrawer, DownloadMiniBar } from "@/components/download-drawer";
import { LibraryView } from "@/components/library-view";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Viewer } from "@/components/viewer";
import { isDesktop } from "@/lib/desktop";
import { libraryFoldersOf, libraryInFolder, useApp } from "@/lib/store";

export function AppShell() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const folders = useApp((s) => s.folders);
  const chosenFolderIds = useApp((s) => s.chosenFolderIds);
  const folderId = useApp((s) => s.folderId);
  const setFolder = useApp((s) => s.setFolder);
  const libraryFolderId = useApp((s) => s.libraryFolderId);
  const setLibraryFolder = useApp((s) => s.setLibraryFolder);
  const works = useApp((s) => s.works);
  const libraryWorks = useApp((s) => s.libraryWorks);
  const refresh = useApp((s) => s.refresh);
  const listFolders = useApp((s) => s.listFolders);
  const finishRefresh = useApp((s) => s.finishRefresh);
  const job = useApp((s) => s.job);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const logout = useApp((s) => s.logout);
  const openLoginGate = useApp((s) => s.openLoginGate);
  const askDeleteFolder = useApp((s) => s.askDeleteFolder);
  const loggedIn = useApp((s) => s.loggedIn);
  const account = useApp((s) => s.account);
  const syncingBrowser = useApp((s) => s.syncingBrowser);
  const syncCount = useApp((s) => s.syncCount);
  const lastRead = useApp((s) => s.lastRead);
  const dismissLastRead = useApp((s) => s.dismissLastRead);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="mr-2">
          <p className="text-sm font-semibold tracking-tight">藏匣</p>
          <p className="text-[11px] text-subtle">
            {loggedIn
              ? `${account.nickname || "已登录"}${account.douyinId ? ` · ${account.douyinId}` : ""}${isDesktop() ? " · 本机" : " · 预览"}`
              : isDesktop()
                ? "未登录 · 可看读取和本地"
                : "未登录 · 预览"}
          </p>
        </div>
        <div className="flex rounded-md bg-raised p-1">
          <button
            className={`h-9 rounded-sm px-3 text-sm ${tab === "collect" ? "bg-surface text-fg" : "text-muted"}`}
            onClick={() => setTab("collect")}
          >
            读取
          </button>
          <button
            className={`h-9 rounded-sm px-3 text-sm ${tab === "library" ? "bg-surface text-fg" : "text-muted"}`}
            onClick={() => setTab("library")}
          >
            本地
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {syncingBrowser && (
            <Button size="sm" onClick={() => void finishRefresh()}>
              停止（已读 {syncCount.works}）
            </Button>
          )}
          {tab === "collect" && (
            <>
              <Button size="sm" variant="secondary" onClick={() => void listFolders()} disabled={job.active && !syncingBrowser}>
                读取收藏夹
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void refresh()} disabled={job.active && !syncingBrowser}>
                <RefreshCw className={`size-4 ${job.active ? "animate-spin" : ""}`} />
                读取收藏
              </Button>
            </>
          )}
          <DownloadMiniBar />
          <Button size="icon" variant="ghost" onClick={() => setSettingsOpen(true)} aria-label="设置">
            <Settings className="size-4" />
          </Button>
          {loggedIn ? (
            <Button size="sm" variant="ghost" onClick={() => void logout()}>
              退出
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => openLoginGate()}>
              登录
            </Button>
          )}
        </div>
      </header>

      {(syncingBrowser || job.active) && (
        <div className="border-b border-line bg-surface px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-sm text-fg">
            <span>{job.message || "正在读取收藏"}</span>
            {job.total > 0 && job.total < 10000 && (
              <span className="shrink-0 tabular-nums text-muted">
                {job.current}/{job.total}
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full bg-fg/80 transition-[width]"
              style={{ width: `${job.total > 0 && job.total < 10000 ? Math.min(100, Math.round((job.current / job.total) * 100)) : job.active ? 8 : 0}%` }}
            />
          </div>
        </div>
      )}

      {!job.active && lastRead && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 text-sm">
          <span>
            {lastRead.count > 0
              ? `${lastRead.method}（「${lastRead.folder || "收藏"}」）`
              : lastRead.method}
          </span>
          <button type="button" className="shrink-0 text-muted hover:text-fg" onClick={() => dismissLastRead()} aria-label="关闭">
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {(tab === "collect" || tab === "library") && (
          <aside className="flex gap-2 overflow-x-auto border-b border-line p-3 md:w-52 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
            {(tab === "library" ? libraryFoldersOf(libraryWorks) : folders.filter((folder) => folder.isDefault || chosenFolderIds.includes(folder.id) || chosenFolderIds.includes(folder.name)))
              .map((folder) => {
              const count =
                tab === "library"
                  ? libraryWorks.filter(
                      (w) =>
                        (w.status === "downloaded" || w.status === "stale") &&
                        libraryInFolder(w, folder.id),
                    ).length
                  : works.filter((w) => w.folderId === folder.id).length;
              const active = tab === "library" ? libraryFolderId === folder.id : folderId === folder.id;
              return (
                <div
                  key={folder.id}
                  className={`flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm ${
                    active ? "bg-raised text-fg" : "text-muted hover:bg-raised/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => (tab === "library" ? setLibraryFolder(folder.id) : setFolder(folder.id))}
                    className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2 text-left"
                  >
                    <FolderClosed className="size-4 shrink-0" />
                    <span className="truncate">{folder.name}</span>
                    <span className="ml-auto tabular-nums text-xs text-subtle">{count}</span>
                  </button>
                  {tab === "collect" && !folder.isDefault && (
                    <button
                      type="button"
                      className="flex size-8 shrink-0 items-center justify-center rounded-sm text-subtle hover:bg-surface hover:text-fg"
                      aria-label={`删除${folder.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        askDeleteFolder(folder.id);
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </aside>
        )}
        {tab === "collect" ? <CollectView /> : <LibraryView />}
      </div>

      <CaptchaDialog />
      <SettingsDialog />
      <Viewer />
      <DeleteConfirmDialog />
      <FolderDeleteDialog />
      <FolderPickDialog />
      <ReadModeDialog />
      <DownloadCancelDialog />
      <DownloadDrawer />
    </div>
  );
}
