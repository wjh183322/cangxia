import { createWriteStream } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { net } from "electron";
import { CHROME_UA } from "./login-page.mjs";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

export function transferToFile({ url, dest, session, signal, headers, onProgress }) {
  return new Promise((resolve, reject) => {
    const play = /aweme\/v1\/play/i.test(url);
    const req = net.request({ url, session, redirect: "follow" });
    req.setHeader("Referer", headers?.Referer || "https://www.douyin.com/");
    req.setHeader("Origin", headers?.Origin || "https://www.douyin.com");
    req.setHeader("User-Agent", headers?.["User-Agent"] || (play ? MOBILE_UA : CHROME_UA));
    req.setHeader("Accept", "*/*");
    req.setHeader("Accept-Encoding", "identity");

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

export async function sniffFile(dest) {
  try {
    const fh = await open(dest, "r");
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    await fh.close();
    if (bytesRead < 8) return "empty";
    if (buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
    if (buf[0] === 0x89 && buf.slice(1, 4).toString("latin1") === "PNG") return "png";
    if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "webp";
    if (buf.slice(4, 8).toString("latin1") === "ftyp") return "mp4";
    if (buf[0] === 0x1a && buf[1] === 0x45) return "webm";
    const head = buf.slice(0, 12).toString("utf8");
    if (head.includes("<") || head.includes("{") || head.startsWith("http")) return "html";
    return "unknown";
  } catch {
    return "empty";
  }
}

function bufferHasAudioTrack(buf) {
  if (!buf || buf.length < 20) return false;
  for (let i = 0; i < buf.length - 16; i++) {
    if (buf[i] === 0x68 && buf[i + 1] === 0x64 && buf[i + 2] === 0x6c && buf[i + 3] === 0x72) {
      const kind = buf.slice(i + 12, i + 16).toString("latin1");
      if (kind === "soun") return true;
    }
  }
  return false;
}

export async function mp4HasAudio(dest) {
  try {
    const fh = await open(dest, "r");
    const st = await fh.stat();
    if (st.size < 64) {
      await fh.close();
      return false;
    }
    const headLen = Math.min(st.size, 2 * 1024 * 1024);
    const head = Buffer.alloc(headLen);
    await fh.read(head, 0, headLen, 0);
    if (bufferHasAudioTrack(head)) {
      await fh.close();
      return true;
    }
    const tailLen = Math.min(st.size, 2 * 1024 * 1024);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, Math.max(0, st.size - tailLen));
    await fh.close();
    return bufferHasAudioTrack(tail);
  } catch {
    return false;
  }
}
  try {
    const fh = await open(dest, "r");
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    await fh.close();
    if (bytesRead < 8) return "empty";
    if (buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
    if (buf[0] === 0x89 && buf.slice(1, 4).toString("latin1") === "PNG") return "png";
    if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "webp";
    if (buf.slice(4, 8).toString("latin1") === "ftyp") return "mp4";
    if (buf[0] === 0x1a && buf[1] === 0x45) return "webm";
    const head = buf.slice(0, 12).toString("utf8");
    if (head.includes("<") || head.includes("{") || head.startsWith("http")) return "html";
    return "unknown";
  } catch {
    return "empty";
  }
}

export async function removePartial(dest) {
  try {
    await unlink(dest);
  } catch {
    /* ignore */
  }
}