import type { Metadata } from "next";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import "@/styles/tokens.css";
import "@/styles/ledger.css";
import "@/styles/itinerary.css";
import "@/styles/docket.css";
import "@/styles/route-atlas.css";
import "@/styles/ledger-focus.css";
import "@/styles/live-route.css";
import "@/styles/trip-board.css";
import "@/styles/motion.css";

export const metadata: Metadata = {
  title: "澳新 2027",
  description: "澳新 2027 两人日程与记账",
  applicationName: "澳新 2027",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "澳新 2027",
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
