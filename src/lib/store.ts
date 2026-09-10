import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEMO_USER, FOLDERS, PENDING_REFRESH_WORK, WORKS, isDemoWork } from "./demo-data";
import { desktop } from "./desktop";
import {
  cancelNeedsConfirm,
  enqueueTasks,
  hydrateTasks,
  pauseDownloading,
  pauseTask,
  resumePaused,
  resumeTask,
  taskFromWork,
  type DlTask,
} from "./download";
import { abortDesktop, kickDownload } from "./download-pump";
import type { AppTab, DownloadJob, Folder, FolderPickItem, KindFilter, Settings, Work } from "./types";
import { applyDeletedWorks, compareCollectTime, matchesKind, videoStatusOf, workNeedsDownload } from "./utils";

interface AppState {
  loggedIn: boolean;
  folders: Folder[];
  works: Work[];
  tab: AppTab;
  folderId: string;
  libraryFolderId: string;
  kind: KindFilter;
  selectedIds: string[];
  rangeFrom: string;
  rangeTo: string;
  settings: Settings;
  job: DownloadJob;
  captchaOpen: boolean;
  captchaReason: "refresh" | "download" | null;
  pendingDownloadIds: string[];
  settingsOpen: boolean;
  libraryWorkId: string | null;
  viewerIndex: number | null;
  filterAuthor: string;
  filterDouyin: string;
  filterTag: string;
  filterUserTag: string;
  filterReturnWorkId: string | null;
  browseArmed: boolean;
  browseWorkId: string | null;
  browseMediaIndex: number;
  tidyArmed: boolean;
  tidyIds: string[];
  deleteIds: string[];
  deleteError: string;
  dlOpen: boolean;
  dlTasks: DlTask[];
  dlPauseAll: boolean;
  dlSpeed: number;
  dlCancelIds: string[];
  dlExpandedId: string | null;
  toastWechat: boolean;
  account: { nickname: string; douyinId: string };
  syncingBrowser: boolean;
  syncCount: { works: number; folders: number };
  hiddenCollectIds: string[];
  deletedFolderIds: string[];
  pendingFolderDeleteId: string | null;
  pendingFolderPick: FolderPickItem[] | null;
  folderPickChecked: string[];
  chosenFolderIds: string[];
  loginGate: boolean;
  pendingReadAfterLogin: boolean;
  pendingListFoldersAfterLogin: boolean;
  lastRead: { method: string; folder: string; count: number } | null;
  readModeOpen: boolean;
  readModeError: string;
  readModeCount: string;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  openLoginGate: () => void;
  skipLoginGate: () => void;
  setTab: (tab: AppTab) => void;
  setFolder: (id: string) => void;
  setLibraryFolder: (id: string) => void;
  setKind: (kind: KindFilter) => void;
  toggleSelect: (id: string) => void;
  clearSelect: () => void;
  setRange: (from: string, to: string) => void;
  patchSettings: (partial: Partial<Settings>) => void;
  setSettingsOpen: (open: boolean) => void;
  openLibraryWork: (id: string | null) => void;
  setViewerIndex: (index: number | null) => void;
  setFilters: (
    f: Partial<Pick<AppState, "filterAuthor" | "filterDouyin" | "filterTag" | "filterUserTag">>,
  ) => void;
  addUserTag: (workId: string, tag: string) => void;
  applyTagFilter: (kind: "topic" | "user", tag: string, fromWorkId: string) => void;
  clearLibraryFilters: () => void;
  armBrowse: () => void;
  openBrowse: (id: string) => void;
  closeBrowse: () => void;
  setBrowseMediaIndex: (index: number) => void;
  armTidy: () => void;
  toggleTidy: (id: string) => void;
  setTidyIds: (ids: string[]) => void;
  askDelete: (ids: string[]) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
  syncDownloadedFromDisk: () => Promise<void>;
  setDlOpen: (open: boolean) => void;
  pauseDlTask: (id: string) => void;
  resumeDlTask: (id: string) => void;
  pauseAllDl: () => void;
  resumeAllDl: () => void;
  askCancelDl: (ids: string[]) => void;
  cancelDlSoft: (ids: string[]) => void;
  confirmCancelDl: () => Promise<void>;
  cancelCancelDl: () => void;
  retryDlTask: (id: string) => void;
  clearDlDone: () => void;
  setDlExpanded: (id: string | null) => void;
  openWorkFolder: (workId: string) => void;
  refresh: () => Promise<void>;
  confirmReadMode: (mode: "all" | "limit") => void;
  cancelReadMode: () => void;
  setReadModeCount: (value: string) => void;
  listFolders: () => Promise<void>;
  finishRefresh: () => Promise<void>;
  applyRefreshResult: (folders: Folder[], works: Work[], extra?: { folder?: string }) => void;
  openFolderPick: (folders: FolderPickItem[]) => void;
  toggleFolderPick: (id: string) => void;
  setFolderPickAll: (on: boolean) => void;
  confirmFolderPick: () => void;
  cancelFolderPick: () => void;
  dismissLastRead: () => void;
  startDownload: (ids: string[]) => void;
  hideFromCollect: (ids: string[]) => void;
  hideFolderFromCollect: (folderId: string) => void;
  askDeleteFolder: (folderId: string) => void;
  cancelDeleteFolder: () => void;
  confirmDeleteFolder: () => void;
  resolveCaptcha: () => void;
  skipCaptchaBatch: () => void;
}

const defaultSettings: Settings = {
  rootPath: "D:\\藏匣",
  pushplusToken: "",
  wxpusherSpt: "",
  maxPerRefresh: 20,
};

function emptyFolders(): Folder[] {
  return [{ id: "default", name: "收藏", isDefault: true }];
}

function liveDesktop() {
  return typeof window !== "undefined" && Boolean(window.cangxia);
}

function stripDemoState<T extends { works?: Work[]; folders?: Folder[]; folderId?: string; dlTasks?: DlTask[] }>(state: T) {
  const works = (state.works || []).filter((w) => !isDemoWork(w));
  const keep = new Set(works.map((w) => w.folderId));
  for (const w of works) for (const id of w.alsoInFolderIds || []) keep.add(id);
  let folders = (state.folders || []).filter((f) => f.isDefault || keep.has(f.id));
  if (!folders.some((f) => f.isDefault)) folders = [...emptyFolders(), ...folders];
  if (!folders.length) folders = emptyFolders();
  const folderId = folders.some((f) => f.id === state.folderId) ? state.folderId : folders[0].id;
  const dlTasks = (state.dlTasks || []).filter((t) => !isDemoWork({ id: t.workId, coverUrl: t.coverUrl }));
  return { ...state, works, folders, folderId, dlTasks };
}

function inFolder(work: Work, folderId: string) {
  return work.folderId === folderId || work.alsoInFolderIds.includes(folderId);
}

export { inFolder };

export function listWorks(works: Work[], folderId: string, kind: KindFilter, hiddenIds: string[] = []) {
  const hidden = new Set(hiddenIds);
  const isDefault = folderId === "default" || folderId === "all";
  return works
    .filter((w) => !hidden.has(w.id) && inFolder(w, folderId) && matchesKind(w, kind))
    .sort((a, b) => {
      if (isDefault) return (a.allIndex ?? 1e12) - (b.allIndex ?? 1e12) || b.collectedAt - a.collectedAt;
      return compareCollectTime(a, b);
    });
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      loggedIn: false,
      folders: liveDesktop() ? emptyFolders() : FOLDERS,
      works: liveDesktop() ? [] : WORKS,
      tab: "collect",
      folderId: "default",
      libraryFolderId: "default",
      kind: "album",
      selectedIds: [],
      rangeFrom: "1",
      rangeTo: "20",
      settings: defaultSettings,
      job: { active: false, current: 0, total: 0, message: "" },
      captchaOpen: false,
      captchaReason: null,
      pendingDownloadIds: [],
      settingsOpen: false,
      libraryWorkId: null,
      viewerIndex: null,
      filterAuthor: "",
      filterDouyin: "",
      filterTag: "",
      filterUserTag: "",
      filterReturnWorkId: null,
      browseArmed: false,
      browseWorkId: null,
      browseMediaIndex: 0,
      tidyArmed: false,
      tidyIds: [],
      deleteIds: [],
      deleteError: "",
      dlOpen: false,
      dlTasks: [],
      dlPauseAll: false,
      dlSpeed: 0,
      dlCancelIds: [],
      dlExpandedId: null,
      toastWechat: false,
      account: { nickname: "", douyinId: "" },
      syncingBrowser: false,
      syncCount: { works: 0, folders: 0 },
      hiddenCollectIds: [],
      deletedFolderIds: [],
      pendingFolderDeleteId: null,
      pendingFolderPick: null,
      folderPickChecked: [],
      chosenFolderIds: liveDesktop() ? [] : FOLDERS.filter((f) => !f.isDefault).map((f) => f.id),
      loginGate: false,
      pendingReadAfterLogin: false,
      pendingListFoldersAfterLogin: false,
      lastRead: null,
      readModeOpen: false,
      readModeError: "",
      readModeCount: String(20),

      login: async () => {
        const api = desktop();
        if (api) {
          const res = await api.login();
          if (res.ok && res.account) {
            const cleaned = stripDemoState(get());
            const readNext = get().pendingReadAfterLogin;
            const listNext = get().pendingListFoldersAfterLogin;
            set({
              loggedIn: true,
              loginGate: false,
              pendingReadAfterLogin: false,
              pendingListFoldersAfterLogin: false,
              account: res.account,
              works: cleaned.works,
              folders: cleaned.folders,
              folderId: cleaned.folderId,
              dlTasks: cleaned.dlTasks,
            });
            if (listNext) void get().listFolders();
            else if (readNext) void get().refresh();
          }
          return;
        }
        const readNext = get().pendingReadAfterLogin;
        const listNext = get().pendingListFoldersAfterLogin;
        set({ loggedIn: true, loginGate: false, pendingReadAfterLogin: false, pendingListFoldersAfterLogin: false, account: DEMO_USER });
        if (listNext) void get().listFolders();
        else if (readNext) void get().refresh();
      },
      logout: async () => {
        const api = desktop();
        if (api) await api.logout();
        set({
          loggedIn: false,
          loginGate: true,
          pendingReadAfterLogin: false,
          pendingListFoldersAfterLogin: false,
          selectedIds: [],
          libraryWorkId: null,
          viewerIndex: null,
          filterReturnWorkId: null,
          browseArmed: false,
          browseWorkId: null,
          browseMediaIndex: 0,
          tidyArmed: false,
          tidyIds: [],
          deleteIds: [],
          deleteError: "",
          dlOpen: false,
          dlExpandedId: null,
          syncingBrowser: false,
          account: { nickname: "", douyinId: "" },
        });
      },
      openLoginGate: () => set({ loginGate: true, pendingReadAfterLogin: false, pendingListFoldersAfterLogin: false }),
      skipLoginGate: () => set({ loginGate: false, pendingReadAfterLogin: false, pendingListFoldersAfterLogin: false }),
      setTab: (tab) =>
        set({
          tab,
          selectedIds: [],
          libraryWorkId: null,
          viewerIndex: null,
          filterReturnWorkId: null,
          browseArmed: false,
          browseWorkId: null,
          tidyArmed: false,
          tidyIds: [],
          deleteIds: [],
        }),
      setFolder: (folderId) => set({ folderId, selectedIds: [] }),
      setLibraryFolder: (libraryFolderId) => set({ libraryFolderId: libraryFolderId === "all" ? "default" : libraryFolderId, tidyIds: [] }),
      setKind: (kind) => set({ kind, selectedIds: [], browseMediaIndex: 0, tidyIds: [] }),
      toggleSelect: (id) =>
        set((s) => ({
          selectedIds: s.selectedIds.includes(id)
            ? s.selectedIds.filter((x) => x !== id)
            : [...s.selectedIds, id],
        })),
      clearSelect: () => set({ selectedIds: [] }),
      setRange: (rangeFrom, rangeTo) => set({ rangeFrom, rangeTo }),
      patchSettings: (partial) => {
        set((s) => ({ settings: { ...s.settings, ...partial } }));
        const api = desktop();
        if (api) void api.setSettings({ ...useApp.getState().settings, ...partial });
      },
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      openLibraryWork: (libraryWorkId) => set({ libraryWorkId, viewerIndex: null }),
      setViewerIndex: (viewerIndex) => set({ viewerIndex }),
      setFilters: (f) => set(f),
      addUserTag: (workId, tag) => {
        const t = tag.trim();
        if (!t) return;
        set((s) => ({
          works: s.works.map((w) =>
            w.id === workId && !w.userTags.includes(t) ? { ...w, userTags: [...w.userTags, t] } : w,
          ),
        }));
      },
      applyTagFilter: (kind, tag, fromWorkId) =>
        set({
          filterAuthor: "",
          filterDouyin: "",
          filterTag: kind === "topic" ? tag : "",
          filterUserTag: kind === "user" ? tag : "",
          filterReturnWorkId: fromWorkId,
          libraryWorkId: null,
          viewerIndex: null,
        }),
      clearLibraryFilters: () => {
        const returnId = get().filterReturnWorkId;
        set({
          filterAuthor: "",
          filterDouyin: "",
          filterTag: "",
          filterUserTag: "",
          filterReturnWorkId: null,
          libraryWorkId: returnId,
          viewerIndex: null,
        });
      },
      armBrowse: () => {
        if (get().browseWorkId) {
          set({ browseWorkId: null, browseMediaIndex: 0, browseArmed: false });
          return;
        }
        set({ browseArmed: !get().browseArmed, tidyArmed: false, tidyIds: [] });
      },
      openBrowse: (id) =>
        set({
          browseArmed: false,
          browseWorkId: id,
          browseMediaIndex: 0,
          libraryWorkId: null,
          viewerIndex: null,
          tidyArmed: false,
          tidyIds: [],
        }),
      closeBrowse: () => set({ browseWorkId: null, browseMediaIndex: 0, browseArmed: false }),
      setBrowseMediaIndex: (index) => set({ browseMediaIndex: Math.max(0, index) }),
      armTidy: () => {
        if (get().job.active) return;
        if (get().tidyArmed) {
          set({ tidyArmed: false, tidyIds: [] });
          return;
        }
        set({
          tidyArmed: true,
          tidyIds: [],
          browseArmed: false,
          browseWorkId: null,
        });
      },
      toggleTidy: (id) =>
        set((s) => ({
          tidyIds: s.tidyIds.includes(id) ? s.tidyIds.filter((x) => x !== id) : [...s.tidyIds, id],
        })),
      setTidyIds: (ids) => set({ tidyIds: [...new Set(ids.filter(Boolean))] }),
      askDelete: (ids) => {
        const unique = [...new Set(ids.filter(Boolean))];
        if (!unique.length || get().job.active) return;
        set({ deleteIds: unique, deleteError: "" });
      },
      cancelDelete: () => set({ deleteIds: [], deleteError: "" }),
      confirmDelete: async () => {
        const ids = get().deleteIds;
        if (!ids.length || get().job.active) return;
        const state = get();
        const api = desktop();
        if (api) {
          const folderNames = Object.fromEntries(state.folders.map((f) => [f.id, f.name]));
          const items = ids
            .map((id) => state.works.find((w) => w.id === id))
            .filter((w): w is Work => Boolean(w))
            .map((w) => ({
              id: w.id,
              title: w.title,
              folderName: folderNames[w.folderId] || "收藏",
            }));
          const res = await api.deleteWorks({ works: items });
          if (!res.ok) {
            set({ deleteError: res.error || "删除失败" });
            return;
          }
        }
        set((s) => ({
          works: applyDeletedWorks(s.works, ids),
          deleteIds: [],
          deleteError: "",
          tidyArmed: false,
          tidyIds: [],
          libraryWorkId: s.libraryWorkId && ids.includes(s.libraryWorkId) ? null : s.libraryWorkId,
          viewerIndex: s.libraryWorkId && ids.includes(s.libraryWorkId) ? null : s.viewerIndex,
          browseWorkId: s.browseWorkId && ids.includes(s.browseWorkId) ? null : s.browseWorkId,
          filterReturnWorkId:
            s.filterReturnWorkId && ids.includes(s.filterReturnWorkId) ? null : s.filterReturnWorkId,
        }));
        void get().syncDownloadedFromDisk();
      },

      setDlOpen: (dlOpen) => set({ dlOpen }),
      setDlExpanded: (dlExpandedId) => set({ dlExpandedId }),
      pauseDlTask: (id) => {
        const current = get().dlTasks.find((t) => t.workId === id);
        if (current?.status === "downloading") abortDesktop("pause");
        set((s) => ({ dlTasks: pauseTask(s.dlTasks, id), dlSpeed: 0 }));
        kickDownload();
      },
      resumeDlTask: (id) => {
        set((s) => ({ dlTasks: resumeTask(s.dlTasks, id), dlPauseAll: false }));
        kickDownload();
      },
      pauseAllDl: () => {
        abortDesktop("pause-all");
        set((s) => ({ dlPauseAll: true, dlTasks: pauseDownloading(s.dlTasks), dlSpeed: 0 }));
      },
      resumeAllDl: () => {
        set((s) => ({ dlPauseAll: false, dlTasks: resumePaused(s.dlTasks) }));
        kickDownload();
      },
      cancelDlSoft: (ids) => {
        const drop = new Set(ids);
        set((s) => ({
          dlTasks: s.dlTasks.filter((t) => !drop.has(t.workId)),
          dlExpandedId: s.dlExpandedId && drop.has(s.dlExpandedId) ? null : s.dlExpandedId,
        }));
      },
      askCancelDl: (ids) => {
        const state = get();
        const unique = [...new Set(ids)];
        if (unique.some((id) => state.dlTasks.find((t) => t.workId === id)?.status === "downloading")) {
          abortDesktop("cancel");
        }
        const hard = unique.filter((id) => {
          const t = state.dlTasks.find((x) => x.workId === id);
          return t && cancelNeedsConfirm(t);
        });
        const soft = unique.filter((id) => !hard.includes(id));
        if (soft.length) {
          const drop = new Set(soft);
          set((s) => ({ dlTasks: s.dlTasks.filter((t) => !drop.has(t.workId)) }));
        }
        if (hard.length) set({ dlCancelIds: hard });
      },
      cancelCancelDl: () => set({ dlCancelIds: [] }),
      confirmCancelDl: async () => {
        const ids = get().dlCancelIds;
        if (!ids.length) return;
        abortDesktop("cancel");
        const state = get();
        const api = desktop();
        if (api) {
          const folderNames = Object.fromEntries(state.folders.map((f) => [f.id, f.name]));
          const items = ids
            .map((id) => state.works.find((w) => w.id === id))
            .filter((w): w is Work => Boolean(w))
            .map((w) => ({ id: w.id, title: w.title, folderName: folderNames[w.folderId] || "收藏" }));
          const res = await api.deleteWorks({ works: items });
          if (!res.ok) return;
        }
        const drop = new Set(ids);
        set((s) => ({
          works: applyDeletedWorks(s.works, ids),
          dlTasks: s.dlTasks.filter((t) => !drop.has(t.workId)),
          dlCancelIds: [],
          dlExpandedId: s.dlExpandedId && drop.has(s.dlExpandedId) ? null : s.dlExpandedId,
          libraryWorkId: s.libraryWorkId && ids.includes(s.libraryWorkId) ? null : s.libraryWorkId,
        }));
      },
      retryDlTask: (id) => {
        set((s) => ({
          dlPauseAll: false,
          dlTasks: resumeTask(s.dlTasks, id),
        }));
        kickDownload();
      },
      clearDlDone: () => set((s) => ({ dlTasks: s.dlTasks.filter((t) => t.status !== "done") })),
      openWorkFolder: (workId) => {
        const state = get();
        const work = state.works.find((w) => w.id === workId);
        const task = state.dlTasks.find((t) => t.workId === workId);
        const folderName = state.folders.find((f) => f.id === (work?.folderId || task?.folderId))?.name || "收藏";
        const title = work?.title || task?.title || "";
        const api = desktop();
        if (api) {
          void api.openWorkFolder({ id: workId, title, folderName });
          return;
        }
        window.alert(`本机路径（演示）\n${state.settings.rootPath}\\${folderName}\\${title}_${workId}`);
      },

      refresh: async () => {
        if (!get().loggedIn) {
          set({ loginGate: true, pendingReadAfterLogin: true });
          return;
        }
        set({
          readModeOpen: true,
          readModeError: "",
          readModeCount: String(Math.max(1, get().settings.maxPerRefresh || 20)),
        });
      },
      setReadModeCount: (value) => set({ readModeCount: value, readModeError: "" }),
      cancelReadMode: () => set({ readModeOpen: false, readModeError: "" }),
      confirmReadMode: (mode) => {
        const folder = get().folders.find((f) => f.id === get().folderId);
        const isDefault = !folder || folder.isDefault || folder.name === "收藏";
        if (isDefault && mode === "all") {
          set({ readModeError: "该收藏夹目前不支持全部读取功能" });
          return;
        }
        if (!isDefault && mode === "limit") {
          set({ readModeError: "该收藏夹目前不支持限定数量读取功能" });
          return;
        }
        const count = Math.max(1, Number(get().readModeCount) || get().settings.maxPerRefresh || 20);
        if (isDefault && count !== get().settings.maxPerRefresh) {
          get().patchSettings({ maxPerRefresh: count });
        }
        set({ readModeOpen: false, readModeError: "" });
        void runRefresh({ fullFolder: !isDefault, max: isDefault ? count : 50000 });
      },

      listFolders: async () => {
        if (!get().loggedIn) {
          set({ loginGate: true, pendingListFoldersAfterLogin: true });
          return;
        }
        const api = desktop();
        if (api) {
          await api.setSettings(get().settings);
          set({
            job: { active: true, current: 0, total: 1, message: "正在读取收藏夹名单…" },
            syncingBrowser: true,
          });
          await api.listFolders();
          return;
        }
        const demo = [
          ...get().folders.filter((f) => !f.isDefault).map((f) => ({ id: f.id, name: f.name })),
          { id: "folder_new_demo", name: "新收藏夹示例" },
        ];
        get().openFolderPick(demo);
      },

      finishRefresh: async () => {
        const api = desktop();
        if (!api) return;
        await api.stopRefresh();
      },
      applyRefreshResult: (folders, works, extra) => {
        const existing = liveDesktop() ? get().works.filter((w) => !isDemoWork(w)) : get().works;
        const seen = new Set(works.map((w) => w.id));
        const incomingIds = new Set((folders || []).map((f) => f.id));
        const seenFolders = new Set(works.flatMap((w) => [w.folderId, ...(w.alsoInFolderIds || [])]));
        const deletedFolderIds = get().deletedFolderIds.filter((id) => !incomingIds.has(id) && !seenFolders.has(id));
        const prev = get().folders;
        const byId = new Map(prev.map((f) => [f.id, f]));
        for (const f of folders || []) {
          byId.set(f.id, f);
          const old = [...byId.values()].find((x) => x.name === f.name && x.id !== f.id && String(x.id).startsWith("folder_"));
          if (old) byId.delete(old.id);
        }
        let nextFolders = [...byId.values()].filter((f) => !deletedFolderIds.includes(f.id));
        if (!nextFolders.some((f) => f.isDefault)) nextFolders = [...emptyFolders(), ...nextFolders];
        if (!nextFolders.length) nextFolders = emptyFolders();
        let chosen = [...new Set([
          ...(get().chosenFolderIds || []),
          ...prev.filter((f) => !f.isDefault).map((f) => f.id),
          ...prev.filter((f) => !f.isDefault).map((f) => f.name),
        ])];
        for (const f of folders || []) {
          if (!f.isDefault) chosen = [...new Set([...chosen, f.id, f.name])];
        }
        const folderId = nextFolders.some((f) => f.id === get().folderId) ? get().folderId : nextFolders[0].id;
        const merged = rankFolderIfNeeded(mergeIncoming(existing, works), extra?.folder, nextFolders);
        const toMove = merged.flatMap((w) => {
          const last = existing.find((p) => p.id === w.id);
          if (!last) return [];
          const wasDefault = !last.folderId || last.folderId === "default";
          if (!wasDefault || !w.folderId || w.folderId === "default") return [];
          if (w.status !== "downloaded" && w.status !== "stale") return [];
          const toName = nextFolders.find((f) => f.id === w.folderId)?.name;
          if (!toName || toName === "收藏") return [];
          return [{ id: w.id, title: w.title, fromName: "收藏", toName }];
        });
        if (toMove.length) {
          const api = desktop();
          if (api?.moveWorks) void api.moveWorks({ works: toMove });
        }
        set({
          folders: nextFolders,
          folderId,
          chosenFolderIds: chosen,
          works: merged,
          hiddenCollectIds: get().hiddenCollectIds.filter((id) => !seen.has(id)),
          deletedFolderIds,
          syncingBrowser: false,
          job: { active: false, current: 0, total: 0, message: "" },
        });
        void get().syncDownloadedFromDisk();
      },
      syncDownloadedFromDisk: async () => {
        const api = desktop();
        if (!api?.fileStatus) return;
        const ids = get()
          .works.filter((w) => w.status === "downloaded" || w.status === "stale")
          .map((w) => w.id);
        if (!ids.length) return;
        const res = await api.fileStatus(ids);
        const have = new Set(res.present || []);
        set((s) => ({
          works: s.works.map((w) => {
            if ((w.status === "downloaded" || w.status === "stale") && !have.has(w.id)) {
              return { ...w, status: "new" as const, videoStatus: w.videos?.length ? "pending" : "none" };
            }
            return w;
          }),
        }));
      },
      openFolderPick: (list) => {
        const chosen = new Set(get().chosenFolderIds || []);
        const visible = get().folders.filter(
          (f) => !f.isDefault && (chosen.has(f.id) || chosen.has(f.name)),
        );
        const skipName = new Set(visible.map((f) => f.name));
        const skipId = new Set(visible.map((f) => f.id));
        const pending = (list || []).filter((f) => !skipName.has(f.name) && !skipId.has(f.id));
        set({
          pendingFolderPick: pending,
          folderPickChecked: [],
          syncingBrowser: false,
          job: { active: false, current: 0, total: 0, message: "" },
        });
      },
      toggleFolderPick: (id) => {
        set((s) => ({
          folderPickChecked: s.folderPickChecked.includes(id)
            ? s.folderPickChecked.filter((x) => x !== id)
            : [...s.folderPickChecked, id],
        }));
      },
      setFolderPickAll: (on) => {
        const list = get().pendingFolderPick || [];
        set({ folderPickChecked: on ? list.map((f) => f.id) : [] });
      },
      confirmFolderPick: () => {
        const list = get().pendingFolderPick || [];
        const checked = new Set(get().folderPickChecked);
        const selected = list.filter((f) => checked.has(f.id));
        let folders = get().folders;
        for (const f of selected) {
          if (!folders.some((x) => x.id === f.id || x.name === f.name)) {
            folders = [...folders, { id: f.id, name: f.name, isDefault: false }];
          }
        }
        const added = selected.map((f) => folders.find((x) => x.id === f.id || x.name === f.name)?.id || f.id);
        const chosenFolderIds = [...new Set([...(get().chosenFolderIds || []), ...added])];
        const folderId = folders.some((f) => f.id === get().folderId && (f.isDefault || chosenFolderIds.includes(f.id)))
          ? get().folderId
          : "default";
        const libraryFolderId =
          get().libraryFolderId === "all" || get().libraryFolderId === "default" || chosenFolderIds.includes(get().libraryFolderId)
            ? get().libraryFolderId === "all"
              ? "default"
              : get().libraryFolderId
            : "default";
        set({
          folders,
          chosenFolderIds,
          folderId,
          libraryFolderId,
          pendingFolderPick: null,
          folderPickChecked: [],
        });
      },
      cancelFolderPick: () => set({ pendingFolderPick: null, folderPickChecked: [] }),
      dismissLastRead: () => set({ lastRead: null }),

      hideFromCollect: (ids) => {
        const unique = [...new Set(ids.filter(Boolean))];
        if (!unique.length) return;
        set((s) => ({
          hiddenCollectIds: [...new Set([...s.hiddenCollectIds, ...unique])],
          selectedIds: s.selectedIds.filter((id) => !unique.includes(id)),
        }));
      },
      hideFolderFromCollect: (folderId) => {
        const ids = get()
          .works.filter((w) => inFolder(w, folderId))
          .map((w) => w.id);
        get().hideFromCollect(ids);
      },
      askDeleteFolder: (folderId) => set({ pendingFolderDeleteId: folderId }),
      cancelDeleteFolder: () => set({ pendingFolderDeleteId: null }),
      confirmDeleteFolder: () => {
        const id = get().pendingFolderDeleteId;
        if (!id) return;
        const hideIds: string[] = [];
        const works = get().works.map((w) => {
          if (!inFolder(w, id)) return w;
          const others = [w.folderId, ...(w.alsoInFolderIds || [])].filter((x) => x !== id);
          if (!others.length) {
            hideIds.push(w.id);
            return w;
          }
          return { ...w, folderId: others[0], alsoInFolderIds: others.slice(1) };
        });
        let folders = get().folders.filter((f) => f.id !== id);
        if (!folders.length) folders = emptyFolders();
        const folderId = get().folderId === id ? folders[0].id : get().folderId;
        set({
          works,
          folders,
          folderId,
          libraryFolderId: get().libraryFolderId === id ? "default" : get().libraryFolderId,
          hiddenCollectIds: [...new Set([...get().hiddenCollectIds, ...hideIds])],
          deletedFolderIds: [...new Set([...get().deletedFolderIds, id])],
          chosenFolderIds: get().chosenFolderIds.filter((x) => x !== id),
          pendingFolderDeleteId: null,
          selectedIds: get().selectedIds.filter((x) => !hideIds.includes(x)),
        });
      },

      startDownload: (ids) => {
        const unique = [...new Set(ids)];
        if (unique.length === 0) return;
        const state = get();
        const incoming = unique
          .map((id) => state.works.find((w) => w.id === id))
          .filter((w): w is Work => Boolean(w))
          .filter((w) => workNeedsDownload(w))
          .map(taskFromWork);
        if (!incoming.length) return;
        const next = enqueueTasks(state.dlTasks, incoming);
        const added = next.length - state.dlTasks.length;
        const api = desktop();
        set({
          dlTasks: next,
          dlOpen: true,
          selectedIds: [],
        });
        if (api) {
          void api.setSettings(state.settings);
          kickDownload();
          return;
        }
        const wechat = Boolean(state.settings.pushplusToken || state.settings.wxpusherSpt);
        if (added >= 3 && !state.captchaOpen) {
          set({
            captchaOpen: true,
            captchaReason: "download",
            toastWechat: wechat,
            dlPauseAll: true,
          });
          return;
        }
        kickDownload();
      },

      resolveCaptcha: () => {
        const { captchaReason } = get();
        set({ captchaOpen: false, captchaReason: null, toastWechat: false });
        const api = desktop();
        if (api) void api.captchaAck();
        if (captchaReason === "download") {
          set({ dlPauseAll: false, pendingDownloadIds: [] });
          kickDownload();
          return;
        }
        if (api && captchaReason === "refresh") void api.resumeRefresh();
        if (!api && captchaReason === "refresh") {
          const { works } = get();
          if (!works.some((w) => w.id === PENDING_REFRESH_WORK.id)) {
            set({ works: [PENDING_REFRESH_WORK, ...works] });
          }
        }
      },

      skipCaptchaBatch: () => {
        const syncing = get().syncingBrowser;
        set({
          captchaOpen: false,
          captchaReason: null,
          pendingDownloadIds: [],
          toastWechat: false,
        });
        const api = desktop();
        if (api) void api.captchaAck();
        if (api && syncing) void api.stopRefresh();
      },
    }),
    {
      name: "cangxia-v6",
      partialize: (s) => ({
        loggedIn: s.loggedIn,
        folders: s.folders,
        works: s.works,
        settings: s.settings,
        account: s.account,
        folderId: s.folderId,
        libraryFolderId: s.libraryFolderId,
        kind: s.kind,
        tab: s.tab,
        dlTasks: s.dlTasks,
        hiddenCollectIds: s.hiddenCollectIds,
        deletedFolderIds: s.deletedFolderIds,
        chosenFolderIds: s.chosenFolderIds,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.dlTasks = hydrateTasks(state.dlTasks || []);
        state.dlPauseAll = false;
        state.dlSpeed = 0;
        state.dlOpen = false;
        if (liveDesktop()) {
          const cleaned = stripDemoState(state);
          state.works = cleaned.works;
          state.folders = cleaned.folders;
          state.folderId = cleaned.folderId;
          state.dlTasks = hydrateTasks(cleaned.dlTasks || []);
        } else if (!state.works?.length) {
          state.works = WORKS;
          state.folders = FOLDERS;
          state.chosenFolderIds = FOLDERS.filter((f) => !f.isDefault).map((f) => f.id);
          state.loggedIn = true;
          state.account = DEMO_USER;
        }
        state.hiddenCollectIds = state.hiddenCollectIds || [];
        state.deletedFolderIds = state.deletedFolderIds || [];
        if (!state.chosenFolderIds || !state.chosenFolderIds.length) {
          state.chosenFolderIds = (state.folders || []).filter((f) => !f.isDefault).map((f) => f.id);
        }
        state.pendingFolderPick = null;
        state.folderPickChecked = [];
        state.pendingFolderDeleteId = null;
        if (!state.libraryFolderId || state.libraryFolderId === "all") state.libraryFolderId = "default";
        state.loginGate = false;
        state.pendingReadAfterLogin = false;
      },
    },
  ),
);

async function wait(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function rankFolderIfNeeded(works: Work[], folderName: string | undefined, folders: Folder[]) {
  if (!folderName || folderName === "收藏") return works;
  const fid = folders.find((f) => f.name === folderName)?.id;
  if (!fid) return works;
  const mine = works.filter((w) => inFolder(w, fid)).sort(compareCollectTime);
  mine.forEach((w, i) => {
    w.listIndex = i;
  });
  const rest = works.filter((w) => !inFolder(w, fid));
  return [...rest, ...mine];
}

async function runRefresh(opts: { fullFolder: boolean; max: number }) {
  const get = () => useApp.getState();
  const api = desktop();
  if (api) {
    await api.setSettings(get().settings);
    const folderName = get().folders.find((f) => f.id === get().folderId)?.name || "收藏";
    const works = get().works;
    const folderId = get().folderId;
    const hidden = new Set(get().hiddenCollectIds || []);
    const visible = works.filter((w) => !hidden.has(w.id));
    const knownIds = opts.fullFolder
      ? []
      : folderName === "收藏"
        ? visible.filter((w) => w.allIndex != null).map((w) => w.id)
        : visible.filter((w) => inFolder(w, folderId)).map((w) => w.id);
    const startAllIndex = visible.reduce((m, w) => Math.max(m, w.allIndex ?? -1), -1) + 1;
    useApp.setState({
      job: {
        active: true,
        current: 0,
        total: opts.fullFolder ? 1 : opts.max,
        message: opts.fullFolder
          ? `「${folderName}」全部读取进清单，按收藏时间排序`
          : `「${folderName}」本次新增 ${opts.max} 条，已有的会跳过`,
      },
      syncingBrowser: true,
    });
    await api.refresh({
      folderName,
      knownIds,
      startAllIndex,
      startListIndex: 0,
      fullFolder: opts.fullFolder,
      max: opts.max,
    });
    return;
  }
  useApp.setState({ job: { active: true, current: 0, total: 1, message: "正在同步收藏清单…" } });
  await wait(900);
  const { works, settings } = get();
  if (works.some((w) => w.id === PENDING_REFRESH_WORK.id)) {
    const wechat = Boolean(settings.pushplusToken || settings.wxpusherSpt);
    useApp.setState({
      job: { active: false, current: 0, total: 0, message: "" },
      captchaOpen: true,
      captchaReason: "refresh",
      toastWechat: wechat,
    });
    return;
  }
  useApp.setState({
    works: [PENDING_REFRESH_WORK, ...works],
    job: { active: false, current: 0, total: 0, message: "" },
  });
}

function mergeIncoming(existing: Work[], incoming: Work[]) {
  const byId = new Map(existing.map((w) => [w.id, w]));
  for (const w of incoming) {
    const prev = byId.get(w.id);
    if (!prev) {
      byId.set(w.id, { ...w });
      continue;
    }
    const folderId = prev.folderId && prev.folderId !== "default" ? prev.folderId : w.folderId;
    byId.set(w.id, {
      ...w,
      folderId,
      userTags: prev.userTags,
      status: prev.status === "downloaded" || prev.status === "stale" ? prev.status : w.status,
      videoStatus: videoStatusOf(prev) === "saved" ? "saved" : w.videoStatus ?? videoStatusOf(prev),
      alsoInFolderIds: [...new Set([...(prev.alsoInFolderIds || []), ...(w.alsoInFolderIds || []), prev.folderId, w.folderId].filter((id) => id && id !== folderId))],
      collectTimeKnown: Boolean(w.collectTimeKnown || prev.collectTimeKnown),
      collectedAt: w.collectTimeKnown ? w.collectedAt : prev.collectTimeKnown ? prev.collectedAt : w.collectedAt,
      listIndex: w.listIndex != null && folderId !== "default" ? w.listIndex : prev.listIndex ?? w.listIndex,
      allIndex: w.allIndex != null ? w.allIndex : prev.allIndex,
    });
  }
  const ordered = incoming
    .filter((w) => w.allIndex != null)
    .sort((a, b) => (a.allIndex ?? 0) - (b.allIndex ?? 0));
  if (!ordered.length) return [...byId.values()];
  const seen = new Set(ordered.map((w) => w.id));
  const head = ordered.map((w) => byId.get(w.id)).filter(Boolean) as Work[];
  const rest = [...byId.values()].filter((w) => !seen.has(w.id));
  const collectRest = rest
    .filter((w) => w.allIndex != null)
    .sort((a, b) => (a.allIndex ?? 0) - (b.allIndex ?? 0));
  const other = rest.filter((w) => w.allIndex == null);
  return [
    ...head.map((w, i) => ({ ...w, allIndex: i })),
    ...collectRest.map((w, i) => ({ ...w, allIndex: head.length + i })),
    ...other,
  ];
}
