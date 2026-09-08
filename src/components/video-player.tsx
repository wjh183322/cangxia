import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoPlayer({
  src,
  poster,
  autoPlay = false,
  fill = false,
}: {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  fill?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setPlaying(false);
    setCurrent(0);
    setBroken(false);
    if (autoPlay) {
      el.muted = muted;
      void el.play();
    }
  }, [src, autoPlay]);

  function togglePlay() {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      el.muted = muted;
      void el.play();
    } else {
      el.pause();
    }
  }

  function seek(value: number) {
    const el = ref.current;
    if (!el) return;
    el.currentTime = value;
    setCurrent(value);
  }

  function toggleMute() {
    const el = ref.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }

  return (
    <div className={cn("overflow-hidden bg-bg", fill && "flex h-full min-h-0 flex-col")}>
      <div className={cn("relative bg-bg", fill ? "min-h-0 flex-1" : "aspect-video")}>
        <video
          ref={ref}
          className="size-full object-contain"
          src={src}
          poster={poster}
          playsInline
          preload="metadata"
          disablePictureInPicture
          controlsList="nodownload nofullscreen noremoteplayback"
          onContextMenu={(e) => e.preventDefault()}
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration || 0;
            setDuration(d);
            if (!Number.isFinite(d) || d <= 0) setBroken(true);
          }}
          onError={() => setBroken(true)}
          onEnded={() => setPlaying(false)}
        />
        {broken && (
          <p className="absolute inset-0 flex items-center justify-center bg-bg/80 px-4 text-center text-sm text-muted">
            这个文件不是可播放的视频，请重新读取后再下载
          </p>
        )}
        {!playing && !broken && (
          <button
            type="button"
            className="absolute inset-0 flex items-center justify-center bg-bg/20"
            onClick={togglePlay}
            aria-label="播放"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg">
              <Play className="size-6 translate-x-0.5" />
            </span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-surface px-3 py-2">
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-md text-fg hover:bg-raised"
          onClick={togglePlay}
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <span className="w-16 shrink-0 text-xs tabular-nums text-muted">
          {formatTime(current)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={current}
          onChange={(e) => seek(Number(e.target.value))}
          className={cn("h-1 min-w-0 flex-1 cursor-pointer accent-accent")}
          aria-label="进度"
        />
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted">
          {formatTime(duration)}
        </span>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-md text-fg hover:bg-raised"
          onClick={toggleMute}
          aria-label={muted ? "取消静音" : "静音"}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      </div>
    </div>
  );
}
