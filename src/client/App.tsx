import { useEffect } from "react";
import { Brand } from "./components/brand";
import { MotionLayer, SoundEffects } from "./components/effects";
import { Icon } from "./components/icon";
import { AstraApp } from "./pages/dashboard";
import { AiProviderPanel, DeveloperPanel, PremiumAccessPanel } from "./pages/developer";
import { BillingPortal, Features, Privacy, Subscriptions } from "./pages/public";

export { Toggle } from "./components/toggle";

export default function App() {
  const titles: Record<string, string> = {
    "/": "Astra — Discord command center",
    "/features": "Features — Astra",
    "/privacy": "Privacy — Astra",
    "/billing": "Plans and billing — Astra",
    "/subscriptions": "Subscriptions — Astra",
    "/developer": "Developer settings — Astra",
    "/developer/ai": "AI provider — Astra",
    "/developer/premium": "Premium access — Astra",
  };
  useEffect(() => {
    document.title = titles[location.pathname] || "Page not found — Astra";
  }, []);
  const page =
    location.pathname === "/features" ? (
      <Features />
    ) : location.pathname === "/privacy" ? (
      <Privacy />
    ) : location.pathname === "/billing" ? (
      <BillingPortal />
    ) : location.pathname === "/subscriptions" ? (
      <Subscriptions />
    ) : location.pathname === "/developer/ai" ? (
      <AiProviderPanel />
    ) : location.pathname === "/developer/premium" ? (
      <PremiumAccessPanel />
    ) : location.pathname === "/developer" ? (
      <DeveloperPanel />
    ) : location.pathname === "/" ? (
      <AstraApp />
    ) : (
      <main className="not-found">
        <Brand />
        <p className="eyebrow"><span />404 · LOST IN ORBIT</p>
        <h1>This page drifted out of range.</h1>
        <p>The address may have changed, or the page may no longer exist.</p>
        <a className="button primary" href="/">Return home <Icon name="arrow" /></a>
      </main>
    );
  return (
    <>
      <MotionLayer />
      {page}
      <SoundEffects />
    </>
  );
}
