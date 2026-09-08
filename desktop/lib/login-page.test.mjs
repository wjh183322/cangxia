import assert from "node:assert/strict";
import test from "node:test";
import { isFolderCardText, clickFolderCardScript, clickFolderSideScript, LIST_VISIBLE_FOLDERS_SCRIPT } from "./login-page.mjs";

test("folder card matches lock icon names", () => {
  assert.equal(isFolderCardText("玛丽罗斯🔒共1345作品", "玛丽罗斯"), true);
  assert.equal(isFolderCardText("玛丽罗斯 共 1345 作品", "玛丽罗斯"), true);
  assert.equal(isFolderCardText("雷电将军共909作品", "玛丽罗斯"), false);
});

test("side click matches name plus count", () => {
  const src = clickFolderSideScript("雷电将军");
  assert.match(src, /雷电将军/);
  assert.match(src, /startsWith\(nw\)/);
});

test("visible folder script matches 共N作品", () => {
  assert.match(LIST_VISIBLE_FOLDERS_SCRIPT, /共\\d\+作品/);
});
