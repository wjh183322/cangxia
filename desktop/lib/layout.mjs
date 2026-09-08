import { mkdir, writeFile, copyFile, access, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { folderTitle, safeFolderName, workDir } from "./paths.mjs";

export { folderTitle, safeFolderName, workDir };

export async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function metaPayload(work, folderName, downloadedAt) {
  return {
    id: work.id,
    title: work.title,
    authorName: work.authorName,
    douyinId: work.douyinId,
    caption: work.caption ?? "",
    hashtags: work.hashtags ?? [],
    userTags: work.userTags ?? [],
    folderName,
    kind: work.kind,
    videoStatus: work.videoStatus ?? ((work.videos?.length || work.kind === "video" || work.kind === "mixed") ? "pending" : "none"),
    videoFiles: Array.from({ length: Math.max(work.videos?.length || (work.kind === "video" || work.kind === "mixed" ? 1 : 0), 0) }, (_, i) => `视频${i + 1}.mp4`),
    downloadedAt,
    status: work.status ?? "downloaded",
  };
}

export async function ensureWorkFolder({ rootPath, folderName, work, imageFiles, coverSource, videoFile, videoFiles }) {
  const dir = workDir(rootPath, folderName, work.title, work.id);
  await mkdir(dir, { recursive: true });
  const downloadedAt = new Date().toISOString();

  const saved = [];
  for (let i = 0; i < imageFiles.length; i++) {
    const src = imageFiles[i];
    const ext = extOf(src.name || src.path || ".jpg");
    const dest = join(dir, `图${i + 1}${ext}`);
    if (!(await exists(dest))) {
      if (src.path) await copyFile(src.path, dest);
      else if (src.bytes) await writeFile(dest, src.bytes);
    }
    saved.push(dest);
  }

  const clips = videoFiles?.length ? videoFiles : videoFile ? [videoFile] : [];
  const videoPaths = [];
  let videoStatus = work.videoStatus ?? (clips.length || work.kind === "video" || work.kind === "mixed" ? "pending" : "none");
  if (clips.length || work.kind === "video" || work.kind === "mixed") {
    if (clips.length === 0) {
      videoStatus = "missing";
    } else {
      let savedCount = 0;
      for (let i = 0; i < clips.length; i++) {
        const dest = join(dir, `视频${i + 1}.mp4`);
        const src = clips[i];
        if (await exists(dest)) {
          videoPaths.push(dest);
          savedCount += 1;
          continue;
        }
        if (src?.path || src?.bytes) {
          if (src.path) await copyFile(src.path, dest);
          else await writeFile(dest, src.bytes);
          videoPaths.push(dest);
          savedCount += 1;
        }
      }
      videoStatus = savedCount === clips.length ? "saved" : savedCount ? "pending" : "missing";
    }
  }

  const coverDest = join(dir, "cover.jpg");
  if (!(await exists(coverDest))) {
    if (coverSource?.path) await copyFile(coverSource.path, coverDest);
    else if (coverSource?.bytes) await writeFile(coverDest, coverSource.bytes);
    else if (saved[0]) await copyFile(saved[0], coverDest);
  }

  await writeFile(
    join(dir, "meta.json"),
    `${JSON.stringify(metaPayload({ ...work, videoStatus, videos: work.videos || clips }, folderName, downloadedAt), null, 2)}\n`,
    "utf8",
  );
  await writeDesktopIni(dir);
  return { dir, files: saved, cover: coverDest, videoPath: videoPaths[0] || null, videoPaths, videoStatus };
}

function extOf(name) {
  const m = String(name).toLowerCase().match(/\.(jpe?g|png|webp|gif|bmp)$/);
  return m ? m[0].replace("jpeg", "jpg") : ".jpg";
}

async function writeDesktopIni(dir) {
  const ini = join(dir, "desktop.ini");
  const body = `[.ShellClassInfo]
IconResource=cover.jpg,0
InfoTip=藏匣作品
[ViewState]
FolderType=Pictures
`;
  await writeFile(ini, body, "utf8");
  if (process.platform !== "win32") return;
  await runAttrib(["+s", dir]);
  await runAttrib(["+h", ini]);
}

function runAttrib(args) {
  return new Promise((resolve) => {
    execFile("attrib", args, () => resolve());
  });
}

export async function writeIndex(rootPath, records) {
  const dir = join(rootPath, ".cangxia");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "index.json");
  await writeFile(file, `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
  return file;
}

export async function readIndex(rootPath) {
  const file = join(rootPath, ".cangxia", "index.json");
  if (!(await exists(file))) return { version: 1, records: [] };
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return { version: 1, records: [] };
  }
}

export async function deleteWorkFolders(rootPath, items) {
  const index = await readIndex(rootPath);
  const records = index.records || [];
  const idSet = new Set(items.map((it) => it.id));
  for (const item of items) {
    const rec = records.find((r) => r.id === item.id);
    const dir = rec?.dir || workDir(rootPath, item.folderName, item.title, item.id);
    await rm(dir, { recursive: true, force: true });
  }
  await writeIndex(
    rootPath,
    records.filter((r) => !idSet.has(r.id)),
  );
  return { ok: true, deleted: items.map((it) => it.id) };
}

export async function writeWorkMeta(dir, work, folderName, videoStatus) {
  const downloadedAt = new Date().toISOString();
  await writeFile(
    join(dir, "meta.json"),
    `${JSON.stringify(metaPayload({ ...work, videoStatus, status: work.status ?? "downloaded" }, folderName, downloadedAt), null, 2)}\n`,
    "utf8",
  );
  await writeDesktopIni(dir);
}
