import { useState } from "react";
import { Button } from "@/components/ui/button";
import { isDesktop } from "@/lib/desktop";
import { useApp } from "@/lib/store";

export function LoginScreen() {
  const login = useApp((s) => s.login);
  const skipLoginGate = useApp((s) => s.skipLoginGate);
  const pendingRead = useApp((s) => s.pendingReadAfterLogin);
  const pendingList = useApp((s) => s.pendingListFoldersAfterLogin);
  const native = isDesktop();
  const [phase, setPhase] = useState<"idle" | "qr" | "ok" | "err">("idle");
  const [error, setError] = useState("");

  async function start() {
    setError("");
    setPhase("qr");
    if (native) {
      const before = useApp.getState().loggedIn;
      await login();
      if (useApp.getState().loggedIn && useApp.getState().loggedIn !== before) {
        setPhase("ok");
        return;
      }
      if (useApp.getState().loggedIn) {
        setPhase("ok");
        return;
      }
      setPhase("err");
      setError("登录窗口已关闭或超时。请再试一次。");
      return;
    }
    window.setTimeout(() => {
      setPhase("ok");
      window.setTimeout(() => void login(), 400);
    }, 1200);
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-12 text-fg">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-8">
        <p className="text-xs font-medium tracking-wide text-muted">
          {native ? "Windows 本机" : "Windows 程序预览"}
        </p>
        <h1 className="mt-3 font-sans text-3xl font-semibold tracking-tight">藏匣</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {native
            ? pendingList
              ? "读取收藏夹需要先登录自己的抖音号。扫码后会继续读取名单。"
              : pendingRead
                ? "读取收藏需要先登录自己的抖音号。扫码后会继续读取。"
                : "扫码登录自己的抖音号后，才能读取收藏。本地和已同步的清单不登录也能看。"
            : "备份当前登录号的抖音收藏图集。文件只落本机。预览使用演示数据，不会连接你的真实账号。"}
        </p>
        <div className="mt-8 flex min-h-40 items-center justify-center rounded-lg bg-raised">
          {phase === "idle" && (
            <p className="px-6 text-center text-sm text-muted">
              {native ? "点击后弹出抖音网页，用手机扫码" : "扫码登录抖音网页后，即可刷新收藏清单"}
            </p>
          )}
          {phase === "qr" && (
            <p className="px-6 text-center text-sm text-muted">
              {native ? "等待扫码，请勿关闭弹出的窗口…" : "等待扫码…"}
            </p>
          )}
          {phase === "ok" && <p className="text-sm text-ok">已登录</p>}
          {phase === "err" && <p className="px-6 text-center text-sm text-danger">{error}</p>}
        </div>
        <Button className="mt-6 w-full" onClick={() => void start()} disabled={phase === "qr"}>
          {phase === "qr" ? "登录中" : "扫码登录"}
        </Button>
        <button
          type="button"
          className="mt-3 w-full text-center text-xs text-muted hover:text-fg"
          onClick={() => skipLoginGate()}
        >
          先不登录，返回本地
        </button>
        <p className="mt-4 text-xs leading-relaxed text-subtle">
          验证码出现时会暂停并通知你，需在本机窗口里完成滑块，不会自动过码。
        </p>
      </div>
    </main>
  );
}
