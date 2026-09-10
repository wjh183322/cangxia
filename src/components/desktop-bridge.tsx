import { useEffect } from "react";
import { desktop } from "@/lib/desktop";
import { applyDesktopDlEvent } from "@/lib/download-pump";
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
      useApp.getState().applyRefreshResult(data.folders, data.works, { folder: data.folder });
      if (data.method) {
        useApp.setState({
          lastRead: {
            method: data.method,
            folder: data.folder || "",
            count: Number(data.harvested || 0),
          },
        });
      }
    });
    const offPick = api.onFolderPick((data) => {
      useApp.getState().openFolderPick(data.folders || []);
    });
    const offCaptcha = api.onCaptcha(() => {
      const s = useApp.getState();
      if (s.captchaOpen) return;
      s.pauseAllDl();
      useApp.setState({
        captchaOpen: true,
        captchaReason: s.syncingBrowser ? "refresh" : "download",
        toastWechat: Boolean(s.settings.pushplusToken || s.settings.wxpusherSpt),
      });
      void api.notifyCaptcha();
    });
    const offDl = api.onDl((ev) => applyDesktopDlEvent(ev as Parameters<typeof applyDesktopDlEvent>[0]));
    void api.setSettings(useApp.getState().settings);
    void useApp.getState().syncDownloadedFromDisk();
    let saveTimer = 0;
    const unsub = useApp.subscribe((s) => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        if (!s.settings.rootPath) return;
        void api.saveList({
          works: s.works,
          folders: s.folders,
          hiddenCollectIds: s.hiddenCollectIds,
          chosenFolderIds: s.chosenFolderIds,
        });
      }, 800);
    });
    return () => {
      offProgress();
      offStatus();
      offCount();
      offDone();
      offPick();
      offCaptcha();
      offDl();
      unsub();
      window.clearTimeout(saveTimer);
    };
  }, []);
  return null;
}