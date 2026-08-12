import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { THEME_BOOTSTRAP_SCRIPT } from "./components/introState";
import { DEFAULT_SITE_CONFIG, type SiteConfig } from "./data/types";
import { siteThemeVariables } from "../shared/site-config";
import "./globals.css";
import "katex/dist/katex.min.css";

function metadataBase(value: string | null): URL {
  try { return new URL(value || "https://1.530555.xyz"); }
  catch { return new URL("https://1.530555.xyz"); }
}

function siteConfig(value: string | null): SiteConfig {
  if (!value) return DEFAULT_SITE_CONFIG;
  try { return { ...DEFAULT_SITE_CONFIG, ...JSON.parse(decodeURIComponent(value)) }; }
  catch { return DEFAULT_SITE_CONFIG; }
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const config = siteConfig(requestHeaders.get("x-blog-site-config"));
  return {
    metadataBase: metadataBase(requestHeaders.get("x-blog-site-origin")),
    title: { default: config.siteTitle, template: `%s · ${config.siteTitle}` },
    description: config.siteDescription,
    icons: { icon: "/favicon.ico", shortcut: "/favicon.ico" },
    openGraph: { type: "website", locale: config.siteLanguage.replace("-", "_"), siteName: config.siteTitle, images: [{ url: config.ogImageUrl, width: 1200, height: 630, alt: config.siteTitle }] },
    twitter: { card: "summary_large_image", images: [config.ogImageUrl] },
    alternates: { canonical: "/" },
  };
}

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const config = siteConfig(requestHeaders.get("x-blog-site-config"));
  return (
    <html
      lang={config.siteLanguage}
      data-theme-default={config.themeMode}
      data-theme-toggle={config.themeToggleEnabled ? "enabled" : "disabled"}
      data-palette={config.themePreset}
      style={siteThemeVariables(config) as CSSProperties}
      suppressHydrationWarning
    >
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} /></head>
      <body>{children}</body>
    </html>
  );
}
