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
};

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  author: "louis16s",
  since: "2020",
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
  truncated?: boolean;
};
