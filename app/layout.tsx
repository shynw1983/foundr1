import type { Metadata, Viewport } from "next";
import { OsTranslationProvider } from "./os/components/OsTranslationProvider";
import { PwaRegister } from "./os/components/PwaRegister";
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
  themeColor: "#202a36"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <PwaRegister />
        <OsTranslationProvider>{children}</OsTranslationProvider>
      </body>
    </html>
  );
}
