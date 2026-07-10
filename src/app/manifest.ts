import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aussie Chill",
    short_name: "Aussie Chill",
    description: "澳洲旅行行程与共同费用账本",
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
