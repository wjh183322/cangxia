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
import type { AppTab, DownloadJob, Folder, KindFilter, Settings, Work } from "./types";
import { applyDeletedWorks, matchesKind, videoStatusOf, workNeedsDownload } from "./utils";

interface AppState {
  loggedIn: boolean;
  folders: Folder[];
  works: Work[];
  tab: AppTab;
  folderId: string;
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
  login: () => Promise<void>;
  logout: () => Promise<void>;
  setTab: (tab: AppTab) => void;
  setFolder: (id: string) => void;
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
  askDelete: (ids: string[]) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
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
  finishRefresh: () => Promise<void>;
  applyRefreshResult: (folders: Folder[], works: Work[]) => void;
  startDownload: (ids: string[]) => void;
  resolveCaptcha: () => void;
  skipCaptchaBatch: () => void;
}

const defaultSettings: Settings = {
  rootPath: "D:\\藏匣",
  pushplusToken: "",
  wxpusherSpt: "",
  maxPerRefresh: 300,
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

export function listWorks(works: Work[], folderId: string, kind: KindFilter) {
  return works
    .filter((w) => inFolder(w, folderId) && matchesKind(w, kind))
    .sort((a, b) => b.collectedAt - a.collectedAt);
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      loggedIn: false,
      folders: liveDesktop() ? emptyFolders() : FOLDERS,
      works: liveDesktop() ? [] : WORKS,
      tab: "collect",
      folderId: "default",
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

      login: async () => {
        const api = desktop();
        if (api) {
          const res = await api.login();
          if (res.ok && res.account) {
            const cleaned = stripDemoState(get());
            set({
              loggedIn: true,
              account: res.account,
              works: cleaned.works,
              folders: cleaned.folders,
              folderId: cleaned.folderId,
              dlTasks: cleaned.dlTasks,
            });
          }
          return;
        }
        set({ loggedIn: true, account: DEMO_USER });
      },
      logout: async () => {
        const api = desktop();
        if (api) await api.logout();
        set({
          loggedIn: false,
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
        const api = desktop();
        if (api) {
          await api.setSettings(get().settings);
          set({
            job: {
              active: true,
              current: 0,
              total: get().settings.maxPerRefresh || 300,
              message: `每个收藏夹最多 ${get().settings.maxPerRefresh || 300} 条，会逐个夹读取`,
            },
            syncingBrowser: true,
          });
          await api.refresh();
          return;
        }
        set({ job: { active: true, current: 0, total: 1, message: "正在同步收藏清单…" } });
        await wait(900);
        const { works, settings } = get();
        if (works.some((w) => w.id === PENDING_REFRESH_WORK.id)) {
          const wechat = Boolean(settings.pushplusToken || settings.wxpusherSpt);
          set({
            job: { active: false, current: 0, total: 0, message: "" },
            captchaOpen: true,
            captchaReason: "refresh",
            toastWechat: wechat,
          });
          return;
        }
        set({
          works: [PENDING_REFRESH_WORK, ...works],
          job: { active: false, current: 0, total: 0, message: "" },
        });
      },

      finishRefresh: async () => {
        const api = desktop();
        if (!api) return;
        await api.stopRefresh();
      },
      applyRefreshResult: (folders, works) => {
        const existing = liveDesktop() ? get().works.filter((w) => !isDemoWork(w)) : get().works;
        set({
          folders: folders.length ? folders : get().folders,
          works: mergeIncoming(existing, works),
          syncingBrowser: false,
          job: { active: false, current: 0, total: 0, message: "" },
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
        kind: s.kind,
        tab: s.tab,
        dlTasks: s.dlTasks,
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
        }
      },
    },
  ),
);

async function wait(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function mergeIncoming(existing: Work[], incoming: Work[]) {
  const byId = new Map(existing.map((w) => [w.id, w]));
  for (const w of incoming) {
    const prev = byId.get(w.id);
    if (!prev) {
      byId.set(w.id, w);
      continue;
    }
    byId.set(w.id, {
      ...w,
      userTags: prev.userTags,
      status: prev.status === "downloaded" || prev.status === "stale" ? prev.status : w.status,
      videoStatus: videoStatusOf(prev) === "saved" ? "saved" : w.videoStatus ?? videoStatusOf(prev),
      alsoInFolderIds: [...new Set([...(prev.alsoInFolderIds || []), ...w.alsoInFolderIds])],
    });
  }
  return [...byId.values()];
}
