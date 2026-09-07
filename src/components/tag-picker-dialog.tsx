import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tab = "topic" | "user";

export function TagPickerDialog({
  open,
  initialTab,
  topics,
  userTags,
  selectedTopic,
  selectedUserTag,
  onClose,
  onPickTopic,
  onPickUserTag,
}: {
  open: boolean;
  initialTab: Tab;
  topics: [string, number][];
  userTags: [string, number][];
  selectedTopic: string;
  selectedUserTag: string;
  onClose: () => void;
  onPickTopic: (tag: string) => void;
  onPickUserTag: (tag: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setQuery("");
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const list = tab === "topic" ? topics : userTags;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(([tag]) => tag.toLowerCase().includes(q) || `#${tag}`.toLowerCase().includes(q));
  }, [list, query]);

  if (!open) return null;

  const selected = tab === "topic" ? selectedTopic : selectedUserTag;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-bg/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-dialog w-dialog flex-col rounded-xl border border-line bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 pt-4">
          <h2 className="flex-1 text-base font-semibold">选择标签</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
            <X className="size-4" />
          </Button>
        </div>
        <div className="mt-3 flex gap-1 px-4">
          <button
            type="button"
            className={cn(
              "h-9 flex-1 rounded-md text-sm",
              tab === "topic" ? "bg-raised text-fg" : "text-muted",
            )}
            onClick={() => setTab("topic")}
          >
            话题（{topics.length}）
          </button>
          <button
            type="button"
            className={cn(
              "h-9 flex-1 rounded-md text-sm",
              tab === "user" ? "bg-raised text-fg" : "text-muted",
            )}
            onClick={() => setTab("user")}
          >
            自打标签（{userTags.length}）
          </button>
        </div>
        <div className="px-4 pt-3">
          <input
            autoFocus
            className="h-11 w-full rounded-md border border-line bg-raised px-3 text-sm"
            placeholder={tab === "topic" ? "在话题里找" : "在自打标签里找"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <button
            type="button"
            className={cn(
              "mb-2 h-10 w-full rounded-md border px-3 text-left text-sm",
              selected === "" ? "border-accent bg-raised" : "border-line text-muted",
            )}
            onClick={() => {
              if (tab === "topic") onPickTopic("");
              else onPickUserTag("");
            }}
          >
            {tab === "topic" ? "全部话题" : "全部自打标签"}
          </button>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              {list.length === 0 ? "还没有标签" : "没有匹配的标签"}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {filtered.map(([tag, count]) => {
                const active = selected === tag;
                return (
                  <li key={tag}>
                    <button
                      type="button"
                      className={cn(
                        "h-10 rounded-full border px-3 text-sm",
                        active
                          ? "border-accent bg-accent text-accent-fg"
                          : "border-line bg-raised text-fg hover:border-muted",
                      )}
                      onClick={() => {
                        if (tab === "topic") onPickTopic(tag);
                        else onPickUserTag(tag);
                      }}
                    >
                      {tab === "topic" ? `#${tag}` : tag}
                      <span className="ml-1.5 tabular-nums text-xs opacity-70">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
