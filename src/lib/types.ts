export type WorkStatus = "new" | "downloaded" | "no-origin" | "stale";
export type VideoStatus = "none" | "pending" | "saved" | "missing";
export type MediaKind = "album" | "video" | "mixed";
export type KindFilter = "all" | "album" | "video";
export type AppTab = "collect" | "library";

export interface Folder {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface WorkImage {
  id: string;
  url: string;
}

export interface WorkVideo {
  id: string;
  url: string;
}

export interface Work {
  id: string;
  title: string;
  authorName: string;
  douyinId: string;
  caption: string;
  hashtags: string[];
  userTags: string[];
  folderId: string;
  alsoInFolderIds: string[];
  kind: MediaKind;
  status: WorkStatus;
  videoStatus: VideoStatus;
  videoUrl?: string;
  videos: WorkVideo[];
  collectedAt: number;
  listIndex?: number;
  allIndex?: number;
  images: WorkImage[];
  coverUrl: string;
}

export interface Settings {
  rootPath: string;
  pushplusToken: string;
  wxpusherSpt: string;
  maxPerRefresh: number;
}

export interface DownloadJob {
  active: boolean;
  current: number;
  total: number;
  message: string;
}
