import { Button } from "@/components/ui/button";
import { desktop, isDesktop } from "@/lib/desktop";
import { useApp } from "@/lib/store";

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);

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
            收藏夹单次读取数
            <input
              className="mt-1 h-11 w-full rounded-md border border-line bg-raised px-3 text-sm"
              type="number"
              min={1}
              max={5000}
              value={settings.maxPerRefresh ?? 300}
              onChange={(e) => patchSettings({ maxPerRefresh: Math.max(1, Number(e.target.value) || 1) })}
            />
            <span className="mt-1 block text-xs text-muted">
              只读你当前点开确认的那一个夹，不会一次读完所有夹。最少 1 条。下次再读同一夹会跳过已有的，继续往下。
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
