import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";

export function CaptchaDialog() {
  const open = useApp((s) => s.captchaOpen);
  const reason = useApp((s) => s.captchaReason);
  const toastWechat = useApp((s) => s.toastWechat);
  const resolveCaptcha = useApp((s) => s.resolveCaptcha);
  const skipCaptchaBatch = useApp((s) => s.skipCaptchaBatch);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        <p className="text-xs font-medium text-warn">需要你回电脑操作</p>
        <h2 className="mt-2 text-lg font-semibold">抖音弹出了验证码</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          批量刷新或下载时，平台会把连续请求当成异常，常见是网页滑块，偶尔是点选或旋转。工具已暂停。请在已登录的浏览器里完成验证，再点继续。无法自动过码。
        </p>
        {toastWechat && (
          <p className="mt-3 text-sm text-ok">已按设置尝试向微信推送「请回电脑过验证」。</p>
        )}
        {!toastWechat && (
          <p className="mt-3 text-sm text-subtle">未填写微信 token，仅弹出本窗口与系统通知。</p>
        )}
        <p className="mt-2 text-xs text-subtle">
          {reason === "refresh" ? "完成后再继续读收藏。也可关掉后点停止，先用已经读到的。" : "完成后再从断点继续下载。"}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={resolveCaptcha}>
            我已完成验证，继续
          </Button>
          <Button className="flex-1" variant="secondary" onClick={skipCaptchaBatch}>
            稍后
          </Button>
        </div>
      </div>
    </div>
  );
}
