import assert from "node:assert/strict";
import test from "node:test";
import { isFolderCardText, clickFolderCardScript } from "./login-page.mjs";

test("folder card matches lock icon names", () => {
  assert.equal(isFolderCardText("玛丽罗斯🔒共1345作品", "玛丽罗斯"), true);
  assert.equal(isFolderCardText("玛丽罗斯 共 1345 作品", "玛丽罗斯"), true);
  assert.equal(isFolderCardText("雷电将军共909作品", "玛丽罗斯"), false);
});

test("click script strips lock before matching", () => {
  const src = clickFolderCardScript("玛丽罗斯");
  assert.match(src, /nw \+ "共"/);
  assert.match(src, /\\u4e00-\\u9fff/);
});
