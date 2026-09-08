import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { DesktopBridge } from "@/components/desktop-bridge";
import { LoginScreen } from "@/components/login-screen";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [hydrated, setHydrated] = useState(false);
  const loginGate = useApp((s) => s.loginGate);

  useEffect(() => {
    const unsub = useApp.persist.onFinishHydration(() => setHydrated(true));
    if (useApp.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  if (!hydrated) {
    return <main className="min-h-dvh bg-bg" />;
  }

  return (
    <>
      <DesktopBridge />
      {loginGate ? <LoginScreen /> : <AppShell />}
    </>
  );
}
