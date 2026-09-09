import assert from "node:assert/strict";
import test from "node:test";
import { commonQuery, parseCollectsList, parseDouyinJson, sameCollectsId, nextCursor, signUrlScript, PAGE_TOKENS_SCRIPT } from "./page-api.mjs";

test("parseCollectsList reads collects_id and name", () => {
  const list = parseCollectsList({
    collects_list: [
      { collects_id: 111, collects_name: "玛丽罗斯", total_number: 1345 },
      { collects_id: 222, collects_name: "mh", total_number: 3 },
    ],
  });
  assert.equal(list[0].name, "玛丽罗斯");
  assert.equal(list[0].id, "111");
  assert.equal(list[1].id, "222");
});

test("parseDouyinJson keeps snowflake collects_id as string", () => {
  const json = parseDouyinJson('{"collects_id":7598218830082497024,"collects_name":"玛丽罗斯"}');
  assert.equal(json.collects_id, "7598218830082497024");
  assert.notEqual(json.collects_id, "7598218830082497000");
});

test("sameCollectsId treats rounded Number as the same folder", () => {
  assert.equal(sameCollectsId("7598218830082497024", "7598218830082497000"), true);
  assert.equal(sameCollectsId("111", "222"), false);
});

test("signUrlScript includes ticket-guard headers", () => {
  const src = signUrlScript("GET", "https://www.douyin.com/aweme/v1/web/collects/video/list/?collects_id=111");
  assert.match(src, /collects_id=111/);
  assert.match(src, /bdmsInvokeList/);
  assert.match(src, /bd-ticket-guard-version/);
});

test("page tokens script reads UIFID", () => {
  assert.match(PAGE_TOKENS_SCRIPT, /UIFID/);
  assert.match(PAGE_TOKENS_SCRIPT, /_secsdk_uifid/);
});
