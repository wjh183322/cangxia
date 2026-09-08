import assert from "node:assert/strict";
import test from "node:test";
import { commonQuery, dyApiScript, parseCollectsList, nextCursor } from "./page-api.mjs";

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

test("dyApiScript embeds collects_id", () => {
  const src = dyApiScript({
    method: "GET",
    path: "/aweme/v1/web/collects/video/list/",
    query: commonQuery({ collects_id: "111", cursor: "0", count: "10" }),
  });
  assert.match(src, /collects_id/);
  assert.match(src, /XMLHttpRequest/);
});

test("nextCursor reads has_more", () => {
  const n = nextCursor({ cursor: 20, has_more: 1 }, 0);
  assert.equal(n.cursor, 20);
  assert.equal(n.hasMore, true);
});
