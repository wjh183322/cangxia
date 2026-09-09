import test from "node:test";
import assert from "node:assert/strict";
import { albumUrlsFromShareHtml } from "./share-origin.mjs";

test("share page RENDER_DATA uses url_list not download_url_list", () => {
  const payload = encodeURIComponent(
    JSON.stringify({
      loaderData: {
        note: {
          aweme: {
            detail: {
              images: [
                { url_list: ["https://p3/origin-1.jpg"], download_url_list: ["https://p3/wm-1.jpg"] },
                { url_list: ["https://p3/origin-2.jpg"], download_url_list: ["https://p3/wm-2.jpg"] },
                { url_list: ["https://p3/origin-3.webp", "https://p3/origin-3.jpg"] },
              ],
            },
          },
        },
      },
    }),
  );
  const html = `<html><script id="RENDER_DATA" type="application/json">${payload}</script></html>`;
  const urls = albumUrlsFromShareHtml(html);
  assert.deepEqual(urls, ["https://p3/origin-1.jpg", "https://p3/origin-2.jpg", "https://p3/origin-3.jpg"]);
});
