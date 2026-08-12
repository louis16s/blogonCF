export type FooterQuote = {
  lead: string;
  sub: string;
};

export type ThemeMode = "system" | "light" | "dark";
export type ThemePreset = "warm" | "neutral" | "forest" | "ocean";
export type TocDefaultState = "auto" | "open" | "closed";

export type SiteConfig = {
  siteTitle: string;
  siteDescription: string;
  siteLanguage: string;
  favicon: string;
  avatarUrl: string;
  ogImageUrl: string;
  author: string;
  since: string;
  postCountText: string;
  footerCredit: string;
  repositoryUrl: string;
  footerQuotes: FooterQuote[];
  wordCloudEnabled: boolean;
  categoriesEnabled: boolean;
  rssEnabled: boolean;
  searchEnabled: boolean;
  introEnabled: boolean;
  introTitle: string;
  introSubtitle: string;
  themeMode: ThemeMode;
  themePreset: ThemePreset;
  themeToggleEnabled: boolean;
  lightBackground: string;
  lightSurface: string;
  lightText: string;
  lightAccent: string;
  darkBackground: string;
  darkSurface: string;
  darkText: string;
  darkAccent: string;
  toolsDefaultOpen: boolean;
  categoriesDefaultOpen: boolean;
  tocDefaultState: TocDefaultState;
};

export const DEFAULT_FOOTER_QUOTES: FooterQuote[] = [
  { lead: "页面看到底了。喝口水，再随便逛逛。", sub: "偶尔拍照，或是写代码，剩下的时间用来对焦生活。" },
  { lead: "这一页先停在这里。窗外或许正好有光。", sub: "把日子调到合适的曝光，也给自己留一点余量。" },
  { lead: "读到这里，算是一起走了一小段路。", sub: "照片留住瞬间，文字替它慢慢显影。" },
  { lead: "页面有尽头，想法暂时没有。", sub: "生活不必一直清晰，偶尔失焦也很好。" },
  { lead: "先看到这里吧。下一次打开，也许又是另一种天气。", sub: "相机负责取景，代码负责运转，日子负责发生。" },
  { lead: "翻页之前，先听一会儿周围的声音。", sub: "认真记录，也认真错过，这些都算生活。" },
  { lead: "这一卷写完了，下一卷还在路上。", sub: "慢一点按下快门，也慢一点得出答案。" },
  { lead: "感谢看到最后。这里没有结论，只有一些留下来的光。", sub: "愿每一次记录，都比上一次更接近真实。" },
];

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  siteTitle: "louis16s' blog",
  siteDescription: "偶尔拍照，或是写代码，剩下的时间用来对焦生活。",
  siteLanguage: "zh-CN",
  favicon: "/favicon.svg",
  avatarUrl: "",
  ogImageUrl: "/og.jpg",
  author: "louis16s",
  since: "2020",
  postCountText: "这里收录着 {count} 个文章。不赶时间，慢慢翻。",
  footerCredit: "在 [Notion](https://www.notion.so/) 创造，Cloudflare 带它兜风。",
  repositoryUrl: "",
  footerQuotes: DEFAULT_FOOTER_QUOTES,
  wordCloudEnabled: true,
  categoriesEnabled: true,
  rssEnabled: true,
  searchEnabled: true,
  introEnabled: true,
  introTitle: "louis16s",
  introSubtitle: "正在对焦生活",
  themeMode: "system",
  themePreset: "warm",
  themeToggleEnabled: true,
  lightBackground: "",
  lightSurface: "",
  lightText: "",
  lightAccent: "",
  darkBackground: "",
  darkSurface: "",
  darkText: "",
  darkAccent: "",
  toolsDefaultOpen: true,
  categoriesDefaultOpen: false,
  tocDefaultState: "auto",
};

export const SITE_LABELS = {
  wordCloud: "词云",
  tools: "小工具",
  categories: "文章分类",
  rss: "RSS 订阅",
} as const;

export function createDefaultSiteConfig(): SiteConfig {
  return { ...DEFAULT_SITE_CONFIG, footerQuotes: DEFAULT_FOOTER_QUOTES.map((quote) => ({ ...quote })) };
}

export function siteThemeVariables(config: SiteConfig): Record<string, string> {
  return Object.fromEntries([
    ["--site-light-bg", config.lightBackground],
    ["--site-light-surface", config.lightSurface],
    ["--site-light-ink", config.lightText],
    ["--site-light-accent", config.lightAccent],
    ["--site-dark-bg", config.darkBackground],
    ["--site-dark-surface", config.darkSurface],
    ["--site-dark-ink", config.darkText],
    ["--site-dark-accent", config.darkAccent],
  ].filter((entry): entry is [string, string] => Boolean(entry[1])));
}
