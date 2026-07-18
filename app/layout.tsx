import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bblog.530555.xyz"),
  title: { default: "louis16s' blog", template: "%s · louis16s' blog" },
  description: "关于旅行、摄影、开发与生活的个人记录。由 Notion 写作，运行在 Cloudflare。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { type: "website", locale: "zh_CN", siteName: "louis16s' blog", images: [{ url: "/og.png", width: 1200, height: 630, alt: "louis16s' blog" }] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = { colorScheme: "light dark", themeColor: "#ffffff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
