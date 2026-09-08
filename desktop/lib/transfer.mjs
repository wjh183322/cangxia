import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { net } from "electron";

export function transferToFile({ url, dest, session, signal, headers, onProgress }) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session, redirect: "follow" });
    req.setHeader("Referer", headers?.Referer || "https://www.douyin.com/");
    req.setHeader("User-Agent", headers?.["User-Agent"] || "Mozilla/5.0");

    const abort = () => {
      try {
        req.abort();
      } catch {
        /* already closed */
      }
    };
    signal?.addEventListener("abort", abort, { once: true });

    req.on("response", (res) => {
      const code = res.statusCode || 0;
      if (code >= 400) {
        reject(new Error(`http ${code}`));
        return;
      }
      const raw = res.headers["content-length"];
      const total = Number(Array.isArray(raw) ? raw[0] : raw) || 0;
      const out = createWriteStream(dest);
      let received = 0;
      res.on("data", (chunk) => {
        if (signal?.aborted) {
          abort();
          return;
        }
        received += chunk.length;
        out.write(chunk);
        onProgress?.(received, total);
      });
      res.on("end", () => {
        out.end(() => resolve({ received, total }));
      });
      res.on("error", (err) => {
        out.destroy();
        reject(err);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export async function removePartial(dest) {
  try {
    await unlink(dest);
  } catch {
    /* ignore */
  }
}
