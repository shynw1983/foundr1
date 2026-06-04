"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function PwaRegister() {
  const pathname = usePathname();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // The app still works as a normal website if registration is blocked.
      });
    });
  }, []);

  useEffect(() => {
    const isStoreApp = pathname.startsWith("/store");
    const manifestHref = isStoreApp ? "/manifest-store.webmanifest" : "/manifest-os.webmanifest";
    const appleTitle = isStoreApp ? "Foundr1 Store" : "Foundr1 OS";
    let manifestLink = document.querySelector<HTMLLinkElement>("link[rel='manifest']");
    if (!manifestLink) {
      manifestLink = document.createElement("link");
      manifestLink.rel = "manifest";
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = manifestHref;

    let appleTitleMeta = document.querySelector<HTMLMetaElement>("meta[name='apple-mobile-web-app-title']");
    if (!appleTitleMeta) {
      appleTitleMeta = document.createElement("meta");
      appleTitleMeta.name = "apple-mobile-web-app-title";
      document.head.appendChild(appleTitleMeta);
    }
    appleTitleMeta.content = appleTitle;
  }, [pathname]);

  return null;
}
