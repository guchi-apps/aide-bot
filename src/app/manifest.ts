import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Morrow",
    short_name: "Morrow",
    description: "NotionやAIDEなどを参照し、チャットボットでプライベートを補佐するPWA",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFAF5",
    theme_color: "#344458",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
