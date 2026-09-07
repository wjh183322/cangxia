import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";

export function Viewer() {
  const works = useApp((s) => s.works);
  const libraryWorkId = useApp((s) => s.libraryWorkId);
  const viewerIndex = useApp((s) => s.viewerIndex);
  const setViewerIndex = useApp((s) => s.setViewerIndex);
  const work = works.find((w) => w.id === libraryWorkId);
  const index = viewerIndex ?? 0;
  const total = work?.images.length ?? 0;

  useEffect(() => {
    if (viewerIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setViewerIndex(null);
      if (e.key === "ArrowLeft") setViewerIndex(Math.max(0, index - 1));
      if (e.key === "ArrowRight") setViewerIndex(Math.min(total - 1, index + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerIndex, index, total, setViewerIndex]);

  if (viewerIndex === null || !work) return null;
  const img = work.images[index];
  if (!img) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm tabular-nums text-muted">
          {index + 1} / {total}
        </p>
        <Button variant="ghost" size="icon" onClick={() => setViewerIndex(null)} aria-label="关闭">
          <X className="size-5" />
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12 pb-8">
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-2 top-1/2 -translate-y-1/2"
          onClick={() => setViewerIndex(Math.max(0, index - 1))}
          disabled={index === 0}
          aria-label="上一张"
        >
          <ChevronLeft className="size-6" />
        </Button>
        <img src={img.url} alt="" className="max-h-full max-w-full object-contain" />
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-1/2 -translate-y-1/2"
          onClick={() => setViewerIndex(Math.min(total - 1, index + 1))}
          disabled={index === total - 1}
          aria-label="下一张"
        >
          <ChevronRight className="size-6" />
        </Button>
      </div>
    </div>
  );
}
