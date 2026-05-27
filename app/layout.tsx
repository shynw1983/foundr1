import type { Metadata, Viewport } from "next";
import { OpsTranslationProvider } from "./ops/components/OpsTranslationProvider";
import { PwaRegister } from "./ops/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "店舗発注管理",
  description: "複数店舗・複数ブランド向け発注管理システム",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "発注管理"
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
