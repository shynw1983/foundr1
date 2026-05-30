import type { Metadata, Viewport } from "next";
import { OpsTranslationProvider } from "./os/components/OpsTranslationProvider";
import { PwaRegister } from "./os/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Foundr1 OS",
  description: "飲食店向けオペレーションバックオフィス",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Foundr1 OS"
  },
  icons: {
    icon: "/icons/foundr1-app.svg",
    apple: "/icons/foundr1-app.svg"
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
        <OpsTranslationProvider>{children}</OpsTranslationProvider>
      </body>
    </html>
  );
}
