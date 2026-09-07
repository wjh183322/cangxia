import { useEffect, useRef } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from "lucide-react";
import { KindTabs } from "@/components/kind-tabs";
import { VideoPlayer } from "@/components/video-player";
import { Button } from "@/components/ui/button";
import { isDesktop } from "@/lib/desktop";
import { useApp } from "@/lib/store";
import type { Work } from "@/lib/types";
import { kindChip, workSlides } from "@/lib/utils";

export function BrowseOverlay({ works }: { works: Work[] }) {
  const browseWorkId = useApp((s) => s.browseWorkId);
  const browseMediaIndex = useApp((s) => s.browseMediaIndex);
  const setBrowseMediaIndex = useApp((s) => s.setBrowseMediaIndex);
  const openBrowse = useApp((s) => s.openBrowse);
  const closeBrowse = useApp((s) => s.closeBrowse);
  const openLibraryWork = useApp((s) => s.openLibraryWork);
  const kind = useApp((s) => s.kind);
  const setKind = useApp((s) => s.setKind);
  const applyTagFilter = useApp((s) => s.applyTagFilter);
  const touch = useRef({ x: 0, y: 0 });
  const wheelLock = useRef(0);

  const index = Math.max(0, works.findIndex((w) => w.id === browseWorkId));
  const work = works[index] ?? null;
  const slides = work ? workSlides(work) : [];
  const mediaIndex = Math.min(browseMediaIndex, Math.max(0, slides.length - 1));
  const slide = slides[mediaIndex];

  useEffect(() => {
    if (!browseWorkId) return;
    if (!works.some((w) => w.id === browseWorkId)) {
      if (works[0]) openBrowse(works[0].id);
      else closeBrowse();
    }
  }, [browseWorkId, works, openBrowse, closeBrowse]);

  function goWork(delta: number) {
    if (!works.length) return;
    const next = Math.min(works.length - 1, Math.max(0, index + delta));
    if (works[next] && works[next].id !== browseWorkId) openBrowse(works[next].id);
  }

  function goMedia(delta: number) {
    if (!slides.length) return;
    const next = mediaIndex + delta;
    if (next < 0) {
      goWork(-1);
      return;
    }
    if (next >= slides.length) {
      goWork(1);
      return;
    }
    setBrowseMediaIndex(next);
  }

  useEffect(() => {
    if (!work) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeBrowse();
      if (e.key === "ArrowUp") goWork(-1);
      if (e.key === "ArrowDown") goWork(1);
      if (e.key === "ArrowLeft") goMedia(-1);
      if (e.key === "ArrowRight") goMedia(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [work, index, mediaIndex, works, slides.length]);

  if (!browseWorkId || !work) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-bg"
      onWheel={(e) => {
        const now = Date.now();
        if (now - wheelLock.current < 420) return;
        if (Math.abs(e.deltaY) < 40) return;
        wheelLock.current = now;
        goWork(e.deltaY > 0 ? 1 : -1);
      }}
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - touch.current.x;
        const dy = e.changedTouches[0].clientY - touch.current.y;
        if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return;
        if (Math.abs(dy) > Math.abs(dx)) goWork(dy > 0 ? -1 : 1);
        else goMedia(dx > 0 ? -1 : 1);
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <KindTabs value={kind} onChange={setKind} />
        <p className="text-xs tabular-nums text-muted">
          {index + 1}/{works.length} · {kindChip(work)} · {mediaIndex + 1}/{slides.length || 1}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              closeBrowse();
              openLibraryWork(work.id);
            }}
          >
            作品墙
          </Button>
          <Button variant="ghost" size="icon" onClick={closeBrowse} aria-label="关闭浏览">
            <X className="size-5" />
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-2 top-1/2 z-10 -translate-y-1/2"
          onClick={() => goMedia(-1)}
          aria-label="上一项"
        >
          <ChevronLeft className="size-6" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2"
          onClick={() => goMedia(1)}
          aria-label="下一项"
        >
          <ChevronRight className="size-6" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-1/2 top-2 z-10 -translate-x-1/2"
          onClick={() => goWork(-1)}
          disabled={index === 0}
          aria-label="上一条作品"
        >
          <ChevronUp className="size-6" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2"
          onClick={() => goWork(1)}
          disabled={index === works.length - 1}
          aria-label="下一条作品"
        >
          <ChevronDown className="size-6" />
        </Button>

        <div className="flex h-full w-full items-center justify-center px-14 py-14">
          {!slide ? (
            <p className="text-sm text-muted">没有可浏览的图或视频</p>
          ) : slide.type === "image" ? (
            <img src={slide.url} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <div className="flex h-full max-h-full w-full max-w-3xl flex-col">
              <VideoPlayer src={slide.url} poster={work.coverUrl} autoPlay fill />
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="truncate text-sm font-medium">{work.title}</p>
        <p className="truncate text-xs text-muted">
          {work.authorName} · {work.douyinId}
          {slide?.type === "video" ? (isDesktop() ? " · 原声" : " · 预览无声") : ""}
        </p>
        <p className="mt-1 line-clamp-2 text-xs text-subtle">{work.caption}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {work.hashtags.map((t) => (
            <button
              key={t}
              type="button"
              className="h-8 rounded-full bg-raised px-3 text-xs text-muted hover:bg-line hover:text-fg"
              onClick={() => applyTagFilter("topic", t, work.id)}
            >
              #{t}
            </button>
          ))}
          {work.userTags.map((t) => (
            <button
              key={t}
              type="button"
              className="h-8 rounded-full bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
              onClick={() => applyTagFilter("user", t, work.id)}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-subtle">上下切作品，左右切本条图/视频。滚轮也可上下切。</p>
      </div>
    </div>
  );
}
