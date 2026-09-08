import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app-shell";
import { DesktopBridge } from "@/components/desktop-bridge";
import { LoginScreen } from "@/components/login-screen";
import { useApp } from "@/lib/store";
import "./window.css";

function Root() {
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

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
