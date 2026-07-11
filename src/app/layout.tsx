import type { Metadata } from "next";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import "@/styles/tokens.css";
import "@/styles/ledger.css";
import "@/styles/itinerary.css";
import "@/styles/docket.css";
import "@/styles/route-atlas.css";
import "@/styles/ledger-focus.css";
import "@/styles/live-route.css";
import "@/styles/motion.css";

export const metadata: Metadata = {
  title: "Aussie Chill",
  description: "澳洲旅行两对夫妻行程与 split bill 账本",
  applicationName: "Aussie Chill",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Aussie Chill",
  },
};

const serviceWorkerRelease = requireBuildRelease(process.env.AUSSIE_BUILD_RELEASE);

function requireBuildRelease(value: string | undefined): string {
  if (!value) throw new Error("The application build release is unavailable");
  return value;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <ServiceWorkerRegistration release={serviceWorkerRelease} />
      </body>
    </html>
  );
}
