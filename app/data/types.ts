export { DEFAULT_FOOTER_QUOTES, DEFAULT_SITE_CONFIG, SITE_LABELS } from "../../shared/site-config";
export type { FooterQuote, SiteConfig, ThemeMode, ThemePreset, TocDefaultState } from "../../shared/site-config";

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

export type SiteNotice = {
  id: string;
  title: string;
  summary: string;
  icon?: string;
  date: string;
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
  accessSignature?: string;
};

type ContentBlockType =
  | "paragraph" | "heading_1" | "heading_2" | "heading_3"
  | "bulleted_list_item" | "numbered_list_item" | "to_do" | "quote" | "callout" | "toggle"
  | "code" | "divider" | "image" | "bookmark" | "embed" | "video" | "file" | "pdf" | "audio"
  | "child_page" | "child_database" | "equation" | "table" | "table_row" | "table_cell"
  | "column_list" | "column" | "synced_block" | "template" | "table_of_contents" | "breadcrumb"
  | "unsupported";

export type ContentBlock = {
  id: string;
  type: ContentBlockType;
  pageId?: string;
  databaseId?: string;
  richText?: RichText[];
  checked?: boolean;
  url?: string;
  previewSignature?: string;
  accessSignature?: string;
  caption?: string;
  language?: string;
  icon?: string;
  color?: string;
  children?: ContentBlock[];
};

export type ChildDatabase = {
  id: string;
  title: string;
  rows: Array<{ id: string; title: string; icon?: string; fields: Array<{ name: string; value: string }> }>;
};

export type ChildPage = {
  id: string;
  title: string;
  icon?: string;
  accessSignature?: string;
  blocks: ContentBlock[];
  headings?: Array<{ id: string; label: string; level: number }>;
  nextCursor?: string;
  truncated?: boolean;
};
