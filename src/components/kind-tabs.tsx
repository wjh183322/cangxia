import type { KindFilter } from "@/lib/types";

const TABS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "album", label: "图集" },
  { id: "video", label: "视频" },
];

export function KindTabs({
  value,
  onChange,
}: {
  value: KindFilter;
  onChange: (kind: KindFilter) => void;
}) {
  return (
    <div className="flex rounded-md bg-raised p-1">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`h-9 rounded-sm px-3 text-sm ${value === tab.id ? "bg-surface text-fg" : "text-muted"}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function kindHint(kind: KindFilter, where: "collect" | "library") {
  if (where === "library") {
    if (kind === "video") return "已下载的视频，含图+视频的作品";
    if (kind === "album") return "已下载的图集，含图+视频的作品";
    return "已下载的全部作品";
  }
  if (kind === "video") return "视频和下了图+视频的作品：静图与全部原视频都下 · 新收藏在前";
  if (kind === "album") return "图集和下了图+视频的作品：原图与视频都下 · 新收藏在前";
  return "有图下图，有视频下视频，多段都下 · 新收藏在前";
}
