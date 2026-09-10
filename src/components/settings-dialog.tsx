import { Button } from "@/components/ui/button";
import { desktop, isDesktop } from "@/lib/desktop";
import { useApp } from "@/lib/store";
import { useEffect, useState } from "react";

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const [paths, setPaths] = useState({ userData: "", appName: "", listFile: "" });

  useEffect(() => {
    if (!open || !isDesktop()) return;
    const api = desktop();
    if (!api?.paths) return;
    void api.paths().then((p) => setPaths(p));
  }, [open, settings.rootPath]);

  if (!open) return null;

  async function pick() {
    const api = desktop();
    if (!api) return;
    const res = await api.pickRoot();
    if (res.ok && res.path) patchSettings({ rootPath: res.path });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold">设置</h2>
        <p className="mt-1 text-xs text-muted">{isDesktop() ? "Windows 本机" : "当前是浏览器预览，选目录只在本机程序里生效。"}</p>
        <div className="mt-5 space-y-4">
          <label className="block text-sm">
            下载根目录
            <div className="mt-1 flex gap-2">
              <input
                className="h-11 min-w-0 flex-1 rounded-md border border-line bg-raised px-3 text-sm"
                value={settings.rootPath}
                onChange={(e) => patchSettings({ rootPath: e.target.value })}
              />
              {isDesktop() && (
                <Button type="button" variant="secondary" onClick={() => void pick()}>
                  浏览
                </Button>
              )}
            </div>
          </label>
          {isDesktop() && (
            <div className="rounded-md border border-line bg-raised px-3 py-2 text-xs text-muted">
              <p>读取清单目录（一夹一份 JSON）</p>
              <p className="mt-1 break-all text-fg">{paths.listFile || `${settings.rootPath || "（先选下载根目录）"}\\.cangxia\\lists`}</p>
              <p className="mt-2">程序缓存目录（名字不一定叫藏匣）</p>
              <p className="mt-1 break-all text-fg">{paths.userData || "打开设置后显示"}{paths.appName ? `（${paths.appName}）` : ""}</p>
              {paths.listFile ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => void desktop()?.openListFile()}
                >
                  打开清单所在文件夹
                </Button>
              ) : null}
            </div>
          )}
          <label className="block text-sm">
            PushPlus token（选填）
            <input
              className="mt-1 h-11 w-full rounded-md border border-line bg-raised px-3 text-sm"
              value={settings.pushplusToken}
              onChange={(e) => patchSettings({ pushplusToken: e.target.value })}
              placeholder="关注推送加公众号后粘贴"
            />
          </label>
          <label className="block text-sm">
            WxPusher SPT（选填）
            <input
              className="mt-1 h-11 w-full rounded-md border border-line bg-raised px-3 text-sm"
              value={settings.wxpusherSpt}
              onChange={(e) => patchSettings({ wxpusherSpt: e.target.value })}
              placeholder="SPT_ 开头"
            />
          </label>
          <label className="block text-sm">
            总收藏每次读取条数
            <input
              className="mt-1 h-11 w-full rounded-md border border-line bg-raised px-3 text-sm"
              type="number"
              min={1}
              max={5000}
              value={settings.maxPerRefresh ?? 20}
              onChange={(e) => patchSettings({ maxPerRefresh: Math.max(1, Number(e.target.value) || 1) })}
            />
            <span className="mt-1 block text-xs text-muted">
              只对总收藏的「限定数量读取」有效。自建夹是全部读取，不受这个数字限制。
            </span>
          </label>
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setSettingsOpen(false)}>完成</Button>
        </div>
      </div>
    </div>
  );
}
