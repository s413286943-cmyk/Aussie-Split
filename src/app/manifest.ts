import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "澳新 2027 · 日程与记账",
    short_name: "澳新2027",
    description: "澳新 2027 两人日程与记账",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f2e8",
    theme_color: "#0f766e",
    lang: "zh-CN",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/aussie-chill-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/aussie-chill-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
