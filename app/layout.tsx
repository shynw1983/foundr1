import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { FloatingFeedbackButton } from "../components/feedback/FloatingFeedbackButton";
import { AppZoomGuard } from "./os/components/AppZoomGuard";
import { AppVersionNotice } from "./os/components/AppVersionNotice";
import { OsTranslationProvider } from "./os/components/OsTranslationProvider";
import { PwaRegister } from "./os/components/PwaRegister";
import { getAppVersion, getShortAppVersion } from "../lib/app-version";
import "./globals.css";

export const metadata: Metadata = {
  title: "Foundr1 OS",
  description: "飲食店向けオペレーション管理システム",
  manifest: "/manifest-os.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Foundr1 OS"
  },
  icons: {
    icon: [
      { url: "/icons/foundr1-os-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/foundr1-os-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: "/icons/foundr1-os-apple-touch.png"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#202a36"
};

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const version = getAppVersion();
  const body = (
    <html lang="ja">
      <body>
        <AppZoomGuard />
        <PwaRegister />
        <AppVersionNotice
          appName="OS"
          initialVersion={version}
          initialShortVersion={getShortAppVersion(version)}
          pathPrefixes={["/os"]}
          realtimeConfigEndpoint="/api/notifications/realtime-config"
          realtimeEventName="store.version.updated"
        />
        <OsTranslationProvider>{children}</OsTranslationProvider>
        <FloatingFeedbackButton />
      </body>
    </html>
  );

  if (!clerkPublishableKey) return body;

  return (
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/member?loggedOut=1">
      {body}
    </ClerkProvider>
  );
}
