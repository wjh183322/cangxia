import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEMO_USER, FOLDERS, PENDING_REFRESH_WORK, WORKS } from "./demo-data";
import { desktop } from "./desktop";
import type { AppTab, DownloadJob, Folder, KindFilter, Settings, Work } from "./types";
import { matchesKind, videoStatusOf, workNeedsDownload, workVideos } from "./utils";

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
      folders: FOLDERS,
      works: WORKS,
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
      toastWechat: false,
      account: { nickname: "", douyinId: "" },
      syncingBrowser: false,
      syncCount: { works: 0, folders: 0 },

      login: async () => {
        const api = desktop();
        if (api) {
          const res = await api.login();
          if (res.ok && res.account) set({ loggedIn: true, account: res.account });
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
        }),
      setFolder: (folderId) => set({ folderId, selectedIds: [] }),
      setKind: (kind) => set({ kind, selectedIds: [], browseMediaIndex: 0 }),
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
        set({ browseArmed: !get().browseArmed });
      },
      openBrowse: (id) =>
        set({
          browseArmed: false,
          browseWorkId: id,
          browseMediaIndex: 0,
          libraryWorkId: null,
          viewerIndex: null,
        }),
      closeBrowse: () => set({ browseWorkId: null, browseMediaIndex: 0, browseArmed: false }),
      setBrowseMediaIndex: (index) => set({ browseMediaIndex: Math.max(0, index) }),

      refresh: async () => {
        const api = desktop();
        if (api) {
          await api.setSettings(get().settings);
          set({
            job: {
              active: true,
              current: 0,
              total: get().settings.maxPerRefresh || 300,
              message: `正在读取收藏，最多 ${get().settings.maxPerRefresh || 300} 条，可随时停止`,
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
        set({
          folders: folders.length ? folders : get().folders,
          works: mergeIncoming(get().works, works),
          syncingBrowser: false,
          job: { active: false, current: 0, total: 0, message: "" },
        });
      },

      startDownload: (ids) => {
        const unique = [...new Set(ids)];
        if (unique.length === 0) return;
        const api = desktop();
        if (api) {
          const state = get();
          const works = unique
            .map((id) => state.works.find((w) => w.id === id))
            .filter((w): w is Work => Boolean(w));
          const folderNames = Object.fromEntries(state.folders.map((f) => [f.id, f.name]));
          void api.setSettings(state.settings);
          void api.download({ works, folderNames });
          return;
        }
        const wechat = Boolean(get().settings.pushplusToken || get().settings.wxpusherSpt);
        if (unique.length >= 3) {
          set({
            captchaOpen: true,
            captchaReason: "download",
            pendingDownloadIds: unique,
            toastWechat: wechat,
          });
          return;
        }
        void runDownload(unique);
      },

      resolveCaptcha: () => {
        const { captchaReason, pendingDownloadIds } = get();
        set({ captchaOpen: false, captchaReason: null, toastWechat: false });
        const api = desktop();
        if (api) {
          if (captchaReason === "download") {
            const ids = pendingDownloadIds;
            set({ pendingDownloadIds: [] });
            get().startDownload(ids);
          }
          if (captchaReason === "refresh") void api.resumeRefresh();
          return;
        }
        if (captchaReason === "download") {
          const ids = pendingDownloadIds;
          set({ pendingDownloadIds: [] });
          void runDownload(ids);
        }
        if (captchaReason === "refresh") {
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
        if (api && syncing) void api.stopRefresh();
      },
    }),
    {
      name: "cangxia-v5",
      partialize: (s) => ({
        loggedIn: s.loggedIn,
        folders: s.folders,
        works: s.works,
        settings: s.settings,
        account: s.account,
        folderId: s.folderId,
        kind: s.kind,
        tab: s.tab,
      }),
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

async function runDownload(ids: string[]) {
  const queue = ids.filter((id) => {
    const w = useApp.getState().works.find((x) => x.id === id);
    return w && workNeedsDownload(w);
  });
  useApp.setState({
    job: { active: true, current: 0, total: queue.length, message: "准备下载无水印原文件…" },
  });
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const work = useApp.getState().works.find((w) => w.id === id);
    const isVideo = Boolean(work && workVideos(work).length);
    useApp.setState({
      job: {
        active: true,
        current: i + 1,
        total: queue.length,
        message: isVideo ? `正在保存图片和原视频 ${work?.title ?? id}` : `正在保存 ${work?.title ?? id}`,
      },
    });
    await wait(isVideo ? 720 : 520);
    useApp.setState((s) => ({
      works: s.works.map((w) => {
        if (w.id !== id) return w;
        if (w.kind === "video") {
          const gotVideo = videoStatusOf(w) !== "missing";
          return {
            ...w,
            status: "downloaded" as const,
            videoStatus: gotVideo ? ("saved" as const) : ("missing" as const),
          };
        }
        return { ...w, status: "downloaded" as const };
      }),
    }));
  }
  useApp.setState({
    job: { active: false, current: 0, total: 0, message: "" },
    selectedIds: [],
  });
}
