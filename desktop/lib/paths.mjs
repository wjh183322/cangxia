import { join } from "node:path";

const ILLEGAL = /[\\/:*?"<>|#]/g;

export function folderTitle(title, workId) {
  const cleaned = String(title ?? "")
    .replace(ILLEGAL, "")
    .replace(/\s+/g, " ")
    .trim();
  const clipped = cleaned.slice(0, 40) || "未命名";
  return `${clipped}_${workId}`;
}

export function safeFolderName(name) {
  const cleaned = String(name ?? "")
    .replace(ILLEGAL, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 60) || "收藏";
}

export function workDir(rootPath, collectionName, title, workId) {
  return join(rootPath, safeFolderName(collectionName), folderTitle(title, workId));
}
