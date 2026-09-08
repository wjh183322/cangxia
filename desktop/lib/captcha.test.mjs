import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeCaptcha } from "./captcha.mjs";

test("homepage and sdk are not captcha", () => {
  assert.equal(looksLikeCaptcha("https://www.douyin.com/"), false);
  assert.equal(looksLikeCaptcha("https://www.douyin.com/aweme/v1/web/favorite/item/list"), false);
  assert.equal(looksLikeCaptcha("https://lf3-cdn-tos.bytescm.com/obj/sec_sdk/sec.js"), false);
  assert.equal(looksLikeCaptcha("https://verify.snssdk.com/captcha/sdk.js"), false);
  assert.equal(looksLikeCaptcha("https://www.douyin.com/slide/banner"), false);
});

test("real captcha endpoints match", () => {
  assert.equal(looksLikeCaptcha("https://verify.snssdk.com/captcha/get?aid=1"), true);
  assert.equal(looksLikeCaptcha("https://verification.zijieapi.com/captcha/verify"), true);
  assert.equal(looksLikeCaptcha("https://captcha.zijieapi.com/slide/verify"), true);
});
