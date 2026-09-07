import { useEffect } from "react";
import { desktop } from "@/lib/desktop";
import { useApp } from "@/lib/store";

export function DesktopBridge() {
  useEffect(() => {
    const api = desktop();
    if (!api) return;
    const offProgress = api.onProgress((job) => useApp.setState({ job }));
    const offStatus = api.onWorkStatus(({ id, status, videoStatus }) => {
      useApp.setState((s) => ({
        works: s.works.map((w) =>
          w.id === id ? { ...w, status, videoStatus: videoStatus ?? w.videoStatus } : w,
        ),
      }));
    });
    const offCount = api.onSyncCount((syncCount) => useApp.setState({ syncCount }));
    const offDone = api.onRefreshDone((data) => {
      useApp.getState().applyRefreshResult(data.folders, data.works);
    });
    const offCaptcha = api.onCaptcha(() => {
      const s = useApp.getState();
      useApp.setState({
        captchaOpen: true,
        captchaReason: s.syncingBrowser ? "refresh" : "download",
        toastWechat: Boolean(s.settings.pushplusToken || s.settings.wxpusherSpt),
      });
      void api.notifyCaptcha();
    });
    void api.setSettings(useApp.getState().settings);
    return () => {
      offProgress();
      offStatus();
      offCount();
      offDone();
      offCaptcha();
    };
  }, []);
  return null;
}
