import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "秘書アプリ",
  description: "NotionやAIDEなどを参照し、チャットボットでプライベートを補佐するPWA",
  applicationName: "秘書アプリ",
  appleWebApp: {
    capable: true,
    title: "秘書アプリ",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#c8503c",
  // ホーム画面から起動したときに、ノッチ側までレイアウトを広げる。
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
