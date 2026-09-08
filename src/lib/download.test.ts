import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueTasks,
  hydrateTasks,
  pauseTask,
  pickNextWorkId,
  resumePaused,
  resumeTask,
  type DlTask,
} from "./download";

function task(id: string, status: DlTask["status"]): DlTask {
  return {
    workId: id,
    title: id,
    authorName: "a",
    coverUrl: "",
    folderId: "default",
    kind: "album",
    status,
    files: [
      { key: "f", name: "图1.jpg", type: "image", url: "/x", status: "waiting", received: 0, total: 10 },
    ],
    speed: 0,
    hasLocalFiles: status !== "waiting",
  };
}

test("enqueue skips duplicates and completed", () => {
  const cur = [task("a", "waiting"), task("b", "done")];
  const next = enqueueTasks(cur, [task("a", "waiting"), task("b", "waiting"), task("c", "waiting")]);
  assert.deepEqual(next.map((t) => t.workId), ["a", "b", "c"]);
});

test("pickNext skips paused and honors pauseAll", () => {
  const tasks = [task("a", "paused"), task("b", "waiting"), task("c", "waiting")];
  assert.equal(pickNextWorkId(tasks, false), "b");
  assert.equal(pickNextWorkId(tasks, true), null);
  assert.equal(pickNextWorkId([task("a", "downloading"), task("b", "waiting")], false), null);
});

test("pause current then next is waiting", () => {
  const paused = pauseTask([task("a", "downloading"), task("b", "waiting")], "a");
  assert.equal(paused[0].status, "paused");
  assert.equal(pickNextWorkId(paused, false), "b");
});

test("resume inserts after current download", () => {
  const tasks = [task("a", "downloading"), task("b", "waiting"), task("c", "paused")];
  const next = resumeTask(tasks, "c");
  assert.deepEqual(
    next.map((t) => t.workId),
    ["a", "c", "b"],
  );
  assert.equal(next[1].status, "waiting");
});

test("hydrate turns in-flight into paused", () => {
  const [t] = hydrateTasks([task("a", "downloading")]);
  assert.equal(t.status, "paused");
});

test("resume all paused become waiting", () => {
  const next = resumePaused([task("a", "paused"), task("b", "done")]);
  assert.equal(next[0].status, "waiting");
  assert.equal(next[1].status, "done");
});
