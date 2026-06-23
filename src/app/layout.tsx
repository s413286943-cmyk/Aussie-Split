import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aussie Chill Split Bill",
  description: "澳洲旅行两对夫妻 split bill 账本",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
