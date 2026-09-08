import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ensureWorkFolder, readIndex, writeIndex, folderTitle, deleteWorkFolders, exists } from "./layout.mjs";
import { mapAweme, collectAwemes, mergeWorks, isCollectFeedUrl, isFolderListUrl } from "./aweme.mjs";

test("folderTitle strips illegal chars and keeps id", () => {
  assert.equal(folderTitle("a/b:c|d", "123"), "abcd_123");
});

test("writes work folder meta cover and index", async () => {
  const root = await mkdtemp(join(tmpdir(), "cangxia-"));
  try {
    const work = {
      id: "7481",
      title: "茶席蒸汽",
      authorName: "桌面博物",
      douyinId: "tablemuse",
      caption: "#静物 #茶",
      hashtags: ["静物", "茶"],
      userTags: [],
      kind: "album",
    };
    const result = await ensureWorkFolder({
      rootPath: root,
      folderName: "收藏",
      work,
      imageFiles: [{ name: "a.jpg", bytes: Buffer.from("fake-jpeg") }],
    });
    const meta = JSON.parse(await readFile(join(result.dir, "meta.json"), "utf8"));
    assert.equal(meta.authorName, "桌面博物");
    assert.equal(meta.douyinId, "tablemuse");
    assert.ok(meta.hashtags.includes("茶"));
    await writeIndex(root, [{ id: work.id, dir: result.dir, status: "downloaded" }]);
    const index = await readIndex(root);
    assert.equal(index.records[0].id, "7481");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mapAweme album picks non-watermark url", () => {
  const work = mapAweme(
    {
      aweme_id: "9",
      desc: "白牡丹 #静物",
      create_time: 1710000000,
      images: [{ url_list: ["https://x/watermark/a.jpg", "https://x/origin/a.jpg"] }],
      author: { nickname: "馆", unique_id: "guan" },
      text_extra: [{ hashtag_name: "静物" }],
    },
    { id: "default", name: "收藏" },
  );
  assert.equal(work.kind, "album");
  assert.equal(work.images[0].url, "https://x/origin/a.jpg");
  assert.deepEqual(work.hashtags, ["静物"]);
});

test("mapAweme album prefers download_url_list and ignores slideshow video", () => {
  const work = mapAweme(
    {
      aweme_id: "note1",
      aweme_type: 68,
      desc: "懒得说话的图文作品 #穹妹",
      images: [
        { download_url_list: ["https://hd/1.jpg"], url_list: ["https://x/watermark/a.jpg"] },
        { download_url_list: ["https://hd/2.jpg"], url_list: ["https://x/watermark/b.jpg"] },
      ],
      video: { play_addr: { url_list: ["https://x/slideshow.mp4"] } },
      author: { nickname: "懒得说话的", unique_id: "lan" },
    },
    { id: "default", name: "收藏" },
  );
  assert.equal(work.kind, "album");
  assert.equal(work.images.length, 2);
  assert.equal(work.videos.length, 0);
  assert.equal(work.images[0].url, "https://hd/1.jpg");
  assert.equal(work.images[1].url, "https://hd/2.jpg");
});

test("mapAweme video keeps still and highest bit_rate", () => {
  const work = mapAweme(
    {
      aweme_id: "8",
      desc: "雾松",
      video: {
        origin_cover: { url_list: ["https://x/still.jpg"] },
        play_addr: { url_list: ["https://x/playwm.mp4"] },
        bit_rate: [
          { bit_rate: 800000, play_addr: { url_list: ["https://x/low.mp4"] } },
          { bit_rate: 4000000, play_addr: { url_list: ["https://x/playwm-hi.mp4"] } },
        ],
      },
      author: { nickname: "山", unique_id: "shan" },
    },
    { id: "default", name: "收藏" },
  );
  assert.equal(work.kind, "video");
  assert.equal(work.images.length, 1);
  assert.equal(work.images[0].url, "https://x/still.jpg");
  assert.equal(work.videos.length, 1);
  assert.equal(work.videoUrl, "https://x/play-hi.mp4");
});

test("mapAweme video skips h265 for a playable mp4", () => {
  const work = mapAweme(
    {
      aweme_id: "h265",
      desc: "舞",
      video: {
        origin_cover: { url_list: ["https://x/still.jpg"] },
        bit_rate: [
          { bit_rate: 8000000, is_h265: 1, play_addr: { url_list: ["https://x/hevc.mp4"] } },
          { bit_rate: 2000000, is_h265: 0, play_addr: { url_list: ["https://x/avc.mp4"] } },
        ],
      },
      author: { nickname: "山", unique_id: "shan" },
    },
    { id: "default", name: "收藏" },
  );
  assert.equal(work.videoUrl, "https://x/avc.mp4");
});

test("mapAweme builds iesdouyin play url from video uri", () => {
  const work = mapAweme(
    {
      aweme_id: "uri1",
      desc: "舞",
      video: {
        origin_cover: { url_list: ["https://x/still.jpg"] },
        play_addr: { uri: "v0200abc", url_list: ["https://x/cover.jpg"] },
      },
      author: { nickname: "山", unique_id: "shan" },
    },
    { id: "default", name: "收藏" },
  );
  assert.match(work.videoUrl, /iesdouyin\.com\/aweme\/v1\/play\/\?video_id=v0200abc/);
  assert.ok(work.videos[0].urls.some((u) => u.includes("snssdk.com")));
});

test("writes numbered videos beside stills", async () => {
  const root = await mkdtemp(join(tmpdir(), "cangxia-vid-"));
  try {
    const result = await ensureWorkFolder({
      rootPath: root,
      folderName: "收藏",
      work: {
        id: "88",
        title: "雾松",
        authorName: "山",
        douyinId: "shan",
        kind: "mixed",
        videoStatus: "pending",
        videos: [{ id: "1", url: "a" }, { id: "2", url: "b" }],
      },
      imageFiles: [{ name: "a.jpg", bytes: Buffer.from("fake-jpeg") }],
      videoFiles: [
        { bytes: Buffer.from("fake-mp4-1") },
        { bytes: Buffer.from("fake-mp4-2") },
      ],
    });
    const meta = JSON.parse(await readFile(join(result.dir, "meta.json"), "utf8"));
    assert.deepEqual(meta.videoFiles, ["视频1.mp4", "视频2.mp4"]);
    assert.equal(meta.videoStatus, "saved");
    assert.equal(await readFile(join(result.dir, "视频1.mp4"), "utf8"), "fake-mp4-1");
    assert.equal(await readFile(join(result.dir, "视频2.mp4"), "utf8"), "fake-mp4-2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collectAwemes reads nested list", () => {
  const list = collectAwemes({ data: { aweme_list: [{ aweme_id: "1" }] } });
  assert.equal(list[0].aweme_id, "1");
});

test("collectAwemes unwraps aweme_info and keeps list order", () => {
  const list = collectAwemes({
    data: {
      aweme_list: [
        { aweme_info: { aweme_id: "top" }, collects_time: 9 },
        { aweme_info: { aweme_id: "second" }, collects_time: 8 },
      ],
    },
  });
  assert.equal(list[0].aweme_id, "top");
  assert.equal(list[1].aweme_id, "second");
  assert.equal(list[0]._collect_time, 9);
});

test("isCollectFeedUrl only matches favorite feeds", () => {
  assert.equal(isCollectFeedUrl("https://www.douyin.com/aweme/v1/web/aweme/listcollection/"), true);
  assert.equal(isCollectFeedUrl("https://www.douyin.com/aweme/v1/web/collects/video/list/?collects_id=1"), true);
  assert.equal(isCollectFeedUrl("https://www.douyin.com/aweme/v1/web/collects/list/"), false);
  assert.equal(isCollectFeedUrl("https://www.douyin.com/aweme/v1/web/tab/feed/"), false);
});

test("isFolderListUrl only matches collects/list", () => {
  assert.equal(isFolderListUrl("https://www.douyin.com/aweme/v1/web/collects/list/"), true);
  assert.equal(isFolderListUrl("https://www.douyin.com/aweme/v1/web/collects/video/list/?collects_id=1"), false);
});

test("mergeWorks keeps user tags and downloaded", () => {
  const merged = mergeWorks(
    [{ id: "1", userTags: ["桌面"], status: "downloaded", alsoInFolderIds: [] }],
    [{ id: "1", userTags: [], status: "new", alsoInFolderIds: ["cos"] }],
  );
  assert.equal(merged[0].status, "downloaded");
  assert.deepEqual(merged[0].userTags, ["桌面"]);
});

test("deleteWorkFolders removes dir and index record", async () => {
  const root = await mkdtemp(join(tmpdir(), "cangxia-del-"));
  try {
    const work = {
      id: "99",
      title: "茶席蒸汽",
      authorName: "桌面博物",
      douyinId: "tablemuse",
      kind: "album",
    };
    const result = await ensureWorkFolder({
      rootPath: root,
      folderName: "收藏",
      work,
      imageFiles: [{ name: "a.jpg", bytes: Buffer.from("fake-jpeg") }],
    });
    await writeIndex(root, [{ id: work.id, dir: result.dir, status: "downloaded" }]);
    await deleteWorkFolders(root, [{ id: work.id, folderName: "收藏", title: work.title }]);
    assert.equal(await exists(result.dir), false);
    const index = await readIndex(root);
    assert.equal(index.records.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
