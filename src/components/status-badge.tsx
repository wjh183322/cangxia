import type { Work } from "@/lib/types";
import { cn, videoStatusOf } from "@/lib/utils";

export function StatusBadge({ work }: { work: Work }) {
  const { label, tone } = badgeOf(work);
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "new" && "bg-accent/15 text-accent",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "muted" && "bg-muted/15 text-muted",
      )}
    >
      {label}
    </span>
  );
}

function badgeOf(work: Work): { label: string; tone: "new" | "ok" | "warn" | "muted" } {
  if (work.status === "stale") return { label: "已下载 · 源已失效", tone: "muted" };
  if (work.kind === "video" || work.kind === "mixed") {
    const video = videoStatusOf(work);
    if (work.status === "downloaded" && video === "saved") return { label: "已下载", tone: "ok" };
    if (work.status === "downloaded" && video === "missing") {
      return { label: "已下载静图 · 无原视频", tone: "warn" };
    }
    if (work.status === "downloaded") return { label: "已下载静图", tone: "ok" };
    if (work.status === "no-origin" && video === "missing") {
      return { label: "无原图 · 无原视频", tone: "warn" };
    }
    if (work.status === "no-origin") return { label: "无原图", tone: "warn" };
    if (video === "missing") return { label: "无原视频", tone: "warn" };
    return { label: "新", tone: "new" };
  }
  if (work.status === "downloaded") return { label: "已下载", tone: "ok" };
  if (work.status === "no-origin") return { label: "无原图", tone: "warn" };
  return { label: "新", tone: "new" };
}
