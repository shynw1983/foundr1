"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function PwaRegister() {
  const pathname = usePathname();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const registerServiceWorker = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // The app still works as a normal website if registration is blocked.
      });
    };

    if (document.readyState === "complete") {
      registerServiceWorker();
      return;
    }
    window.addEventListener("load", registerServiceWorker, { once: true });
    return () => window.removeEventListener("load", registerServiceWorker);
  }, []);

  useEffect(() => {
    const isStoreApp = pathname.startsWith("/store");
    const manifestHref = isStoreApp ? "/manifest-store.webmanifest" : "/manifest-os.webmanifest";
    const appleTitle = isStoreApp ? "Foundr1 STORE" : "Foundr1 OS";
    const appleIconHref = isStoreApp
      ? "/icons/foundr1-store-apple-touch.png"
      : "/icons/foundr1-os-apple-touch.png";
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

    let appleIconLink = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
    if (!appleIconLink) {
      appleIconLink = document.createElement("link");
      appleIconLink.rel = "apple-touch-icon";
      document.head.appendChild(appleIconLink);
    }
    appleIconLink.href = appleIconHref;
  }, [pathname]);

  return null;
}
