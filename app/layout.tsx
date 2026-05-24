import type { Metadata, Viewport } from "next";
import { OpsTranslationProvider } from "./ops/components/OpsTranslationProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "店舗発注管理",
  description: "複数店舗・複数ブランド向け発注管理システム"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <OpsTranslationProvider>{children}</OpsTranslationProvider>
      </body>
    </html>
  );
}
