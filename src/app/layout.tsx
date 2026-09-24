import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Morrow",
  description: "NotionやAIDEなどを参照し、チャットボットでプライベートを補佐するPWA",
  applicationName: "Morrow",
  appleWebApp: {
    capable: true,
    title: "Morrow",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#344458",
  // ホーム画面から起動したときに、ノッチ側までレイアウトを広げる。
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="overflow-hidden overscroll-none">
      <body className="h-dvh overflow-hidden overscroll-none antialiased">{children}</body>
    </html>
  );
}
