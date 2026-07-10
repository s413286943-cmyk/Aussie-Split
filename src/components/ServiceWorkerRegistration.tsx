"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration({ release }: { release: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;

    const register = () => {
      navigator.serviceWorker.register(`/sw.js?release=${encodeURIComponent(release)}`).catch(() => {
        // The app remains usable online when registration is unavailable.
      });
    };
    window.addEventListener("load", register);
    if (document.readyState === "complete") register();

    return () => window.removeEventListener("load", register);
  }, [release]);

  return null;
}
