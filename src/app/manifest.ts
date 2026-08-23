import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "秘書アプリ",
    short_name: "秘書",
    description: "NotionやAIDEなどを参照し、チャットボットでプライベートを補佐するPWA",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1120",
    theme_color: "#0f766e",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
