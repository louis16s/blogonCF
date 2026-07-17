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

export type RichText = { text: string; href?: string; bold?: boolean; italic?: boolean; code?: boolean };

export type ContentBlock = {
  id: string;
  type: string;
  richText?: RichText[];
  checked?: boolean;
  url?: string;
  caption?: string;
  language?: string;
  icon?: string;
  children?: ContentBlock[];
};
