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
  refresh: () => Promise<{ ok: boolean; waiting?: boolean }>;
  stopRefresh: () => Promise<{ ok: boolean }>;
  resumeRefresh: () => Promise<{ ok: boolean }>;
  download: (payload: { works: Work[]; folderNames: Record<string, string> }) => Promise<{ ok: boolean; error?: string }>;
  notifyCaptcha: () => Promise<{ ok: boolean }>;
  onProgress: (cb: (job: { active: boolean; current: number; total: number; message: string }) => void) => () => void;
  onCaptcha: (cb: (data: { reason: string }) => void) => () => void;
  onWorkStatus: (cb: (data: { id: string; status: Work["status"]; videoStatus?: Work["videoStatus"] }) => void) => () => void;
  onSyncCount: (cb: (data: { works: number; folders: number }) => void) => () => void;
  onRefreshDone: (cb: (data: { folders: Folder[]; works: Work[] }) => void) => () => void;
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
