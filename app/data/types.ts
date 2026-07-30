export type Post = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  category: string;
  tags: string[];
  date: string;
  icon?: string;
  locked?: boolean;
};

export type SiteLink = {
  id: string;
  title: string;
  href: string;
  summary: string;
  icon?: string;
  external: boolean;
  kind: "rss" | "tool" | "nav";
};

export type SiteConfig = {
  author: string;
  since: string;
  footerQuotes: FooterQuote[];
};

export type FooterQuote = {
  lead: string;
  sub: string;
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
  author: "louis16s",
  since: "2020",
  footerQuotes: DEFAULT_FOOTER_QUOTES,
};

export type RichText = {
  text: string;
  href?: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  color?: string;
};

export type ContentBlock = {
  id: string;
  type: string;
  pageId?: string;
  richText?: RichText[];
  checked?: boolean;
  url?: string;
  caption?: string;
  language?: string;
  icon?: string;
  color?: string;
  children?: ContentBlock[];
};

export type ChildPage = {
  id: string;
  title: string;
  icon?: string;
  blocks: ContentBlock[];
  hasMore?: boolean;
  nextCursor?: string;
  truncated?: boolean;
};
