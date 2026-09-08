import type { Folder, Work } from "./types";

export interface DesktopAccount {
  nickname: string;
  douyinId: string;
}

export interface DesktopApi {
  available: true;
  login: () => Promise<{ ok: boolean; account?: DesktopAccount; error?: string }>;
  logout: () => Promise<{ ok: boolean }>;
  account: () => Promise<DesktopAccount | null>;
  pickRoot: () => Promise<{ ok: boolean; path?: string }>;
  setSettings: (s: {
    rootPath?: string;
    pushplusToken?: string;
    wxpusherSpt?: string;
    maxPerRefresh?: number;
  }) => Promise<{ ok: boolean }>;
  refresh: (opts?: {
    folderName?: string;
    knownIds?: string[];
    startAllIndex?: number;
    startListIndex?: number;
  }) => Promise<{ ok: boolean; waiting?: boolean }>;
  listFolders: () => Promise<{ ok: boolean; waiting?: boolean }>;
  moveWorks: (payload: { works: { id: string; title: string; fromName: string; toName: string }[] }) => Promise<{ ok: boolean; error?: string }>;
  stopRefresh: () => Promise<{ ok: boolean }>;
  resumeRefresh: () => Promise<{ ok: boolean }>;
  download: (payload: { works: Work[]; folderNames: Record<string, string> }) => Promise<{ ok: boolean; error?: string }>;
  deleteWorks: (payload: { works: { id: string; title: string; folderName: string }[] }) => Promise<{ ok: boolean; error?: string }>;
  dlRun: (payload: {
    work: Work;
    folderName: string;
    files: { key: string; name: string; type: "image" | "video"; url: string; status: string }[];
  }) => Promise<{ ok?: boolean; paused?: boolean; aborted?: boolean; reason?: string; error?: string }>;
  dlAbort: (reason: "pause" | "cancel" | "pause-all") => Promise<{ ok: boolean }>;
  openWorkFolder: (payload: { id: string; title: string; folderName: string }) => Promise<{ ok: boolean }>;
  notifyCaptcha: () => Promise<{ ok: boolean }>;
  captchaAck: () => Promise<{ ok: boolean }>;
  onProgress: (cb: (job: { active: boolean; current: number; total: number; message: string }) => void) => () => void;
  onCaptcha: (cb: (data: { reason: string }) => void) => () => void;
  onWorkStatus: (cb: (data: { id: string; status: Work["status"]; videoStatus?: Work["videoStatus"] }) => void) => () => void;
  onSyncCount: (cb: (data: { works: number; folders: number }) => void) => () => void;
  onRefreshDone: (cb: (data: {
    folders: Folder[];
    works: Work[];
    method?: string;
    folder?: string;
    harvested?: number;
  }) => void) => () => void;
  onFolderPick: (cb: (data: { folders: { id: string; name: string }[] }) => void) => () => void;
  onDl: (cb: (data: Record<string, unknown>) => void) => () => void;
}

declare global {
  interface Window {
    cangxia?: DesktopApi;
  }
}

export function desktop(): DesktopApi | null {
  if (typeof window === "undefined") return null;
  return window.cangxia ?? null;
}

export function isDesktop() {
  return desktop()?.available === true;
}
