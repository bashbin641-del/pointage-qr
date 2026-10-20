"use client";

import { useEffect } from "react";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "development";

export default function AppRuntimeGuard() {
  useEffect(() => {
    let active = true;

    async function checkVersion() {
      if (!navigator.onLine) return;

      try {
        const response = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;

        const result = await response.json() as { version?: string };
        if (!active || !result.version || result.version === appVersion) return;

        const reloadKey = `inox:deployment-reload:${result.version}`;
        if (sessionStorage.getItem(reloadKey)) return;
        sessionStorage.setItem(reloadKey, "1");
        window.location.reload();
      } catch {
        // Une perte réseau temporaire ne doit jamais interrompre la session.
      }
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    const timer = window.setInterval(() => void checkVersion(), 300_000);

    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("online", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);
    void checkVersion();

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", checkWhenVisible);
      window.removeEventListener("online", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  return null;
}
