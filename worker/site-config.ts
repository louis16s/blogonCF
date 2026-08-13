/* Notion Config normalization kept separate from routing and network access. */
import {
  createDefaultSiteConfig,
  type SiteConfig,
  type ThemeMode,
  type ThemePreset,
  type TocDefaultState,
} from "../shared/site-config";

type NotionText = { plain_text?: string; text?: { content?: string } };
type NotionFile = { file?: { url?: string }; external?: { url?: string } };
type NotionProperty = {
  title?: NotionText[];
  rich_text?: NotionText[];
  url?: string;
  checkbox?: boolean;
  select?: { name?: string };
  files?: NotionFile[];
  number?: number | null;
};

export type NotionConfigPage = {
  id?: string;
  last_edited_time?: string;
  properties?: Record<string, NotionProperty | undefined>;
};

export const NOTION_FILE_HOSTS = new Set(["prod-files-secure.s3.us-west-2.amazonaws.com"]);
export const CONFIG_IMAGE_KEYS = new Set(["FAVICON_URL", "AVATAR_URL", "OG_IMAGE_URL"]);

const TRUE_VALUES = /^(?:1|true|yes|on|开启|启用|是)$/i;
const FALSE_VALUES = /^(?:0|false|no|off|关闭|禁用|否)$/i;
const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const FULL_HEX_COLOR = /^#[0-9a-f]{6}$/;
const GITHUB_REPOSITORY = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i;

export function toPublicSiteConfig(pages: NotionConfigPage[]): SiteConfig {
  const config = createDefaultSiteConfig();
  for (const page of pages) {
    const properties = page.properties || {};
    if (properties["启用"]?.checkbox !== true) continue;
    const key = configPageKey(page);
    const value = configPageValue(page);
    if (!key || isConfigLinkPage(page)) continue;

    if (key === "SITE_TITLE" && value) config.siteTitle = cleanConfigText(value, 100) || config.siteTitle;
    if (key === "SITE_DESCRIPTION" && value) config.siteDescription = cleanConfigText(value, 240) || config.siteDescription;
    if (key === "SITE_LANGUAGE" && LANGUAGE_CODE.test(value)) config.siteLanguage = value;

    const hasConfigImage = Boolean(configPageFileUrl(page));
    if (key === "FAVICON_URL") config.favicon = hasConfigImage ? versionedConfigAsset("/favicon.ico", page) : safePublicAsset(value) || config.favicon;
    if (key === "AVATAR_URL") config.avatarUrl = hasConfigImage ? versionedConfigAsset("/_notion/config-image/AVATAR_URL", page) : safePublicAsset(value);
    if (key === "OG_IMAGE_URL") config.ogImageUrl = hasConfigImage ? versionedConfigAsset("/_notion/config-image/OG_IMAGE_URL", page) : safePublicAsset(value) || config.ogImageUrl;

    if (key === "AUTHOR" && value) config.author = cleanConfigText(value, 80) || config.author;
    if (key === "SINCE") config.since = value.match(/(?:19|20)\d{2}/)?.[0] || config.since;
    if (key === "POST_COUNT_TEXT" && value) config.postCountText = cleanConfigText(value, 160) || config.postCountText;
    if (key === "FOOTER_CREDIT" && value) config.footerCredit = cleanConfigText(value, 160) || config.footerCredit;
    if (key === "REPOSITORY_URL" && GITHUB_REPOSITORY.test(value)) config.repositoryUrl = value.slice(0, 240);

    if (key === "WORD_CLOUD_ENABLED") config.wordCloudEnabled = configBoolean(value, config.wordCloudEnabled);
    if (key === "CATEGORIES_ENABLED") config.categoriesEnabled = configBoolean(value, config.categoriesEnabled);
    if (key === "RSS_ENABLED") config.rssEnabled = configBoolean(value, config.rssEnabled);
    if (key === "SEARCH_ENABLED") config.searchEnabled = configBoolean(value, config.searchEnabled);
    if (key === "INTRO_ENABLED") config.introEnabled = configBoolean(value, config.introEnabled);
    if (key === "INTRO_TITLE" && value) config.introTitle = cleanConfigText(value, 60) || config.introTitle;
    if (key === "INTRO_SUBTITLE" && value) config.introSubtitle = cleanConfigText(value, 100) || config.introSubtitle;

    if (key === "THEME_MODE") config.themeMode = configEnum(value, ["system", "light", "dark"], config.themeMode) as ThemeMode;
    if (key === "THEME_PRESET") config.themePreset = configEnum(value, ["warm", "neutral", "forest", "ocean"], config.themePreset) as ThemePreset;
    if (key === "THEME_TOGGLE_ENABLED") config.themeToggleEnabled = configBoolean(value, config.themeToggleEnabled);
    if (key === "LIGHT_BACKGROUND") config.lightBackground = configColor(value);
    if (key === "LIGHT_SURFACE") config.lightSurface = configColor(value);
    if (key === "LIGHT_TEXT") config.lightText = configColor(value);
    if (key === "LIGHT_ACCENT") config.lightAccent = configColor(value);
    if (key === "DARK_BACKGROUND") config.darkBackground = configColor(value);
    if (key === "DARK_SURFACE") config.darkSurface = configColor(value);
    if (key === "DARK_TEXT") config.darkText = configColor(value);
    if (key === "DARK_ACCENT") config.darkAccent = configColor(value);
    if (key === "TOOLS_DEFAULT_OPEN") config.toolsDefaultOpen = configBoolean(value, config.toolsDefaultOpen);
    if (key === "CATEGORIES_DEFAULT_OPEN") config.categoriesDefaultOpen = configBoolean(value, config.categoriesDefaultOpen);
    if (key === "TOC_DEFAULT_STATE") config.tocDefaultState = configEnum(value, ["auto", "open", "closed"], config.tocDefaultState) as TocDefaultState;

    if (key === "FOOTER_QUOTES" && value) {
      const quotes = value.split(/\r?\n/)
        .map((line) => line.split(/\s*[｜|]\s*/, 2).map((part) => cleanConfigText(part, 120)))
        .filter((parts) => parts.length === 2 && parts[0] && parts[1])
        .slice(0, 16)
        .map(([lead, sub]) => ({ lead: lead.slice(0, 100), sub }));
      if (quotes.length) config.footerQuotes = quotes;
    }
  }
  return config;
}

export function configPageKey(page: NotionConfigPage): string {
  const properties = page.properties || {};
  const configured = propertyText(properties["配置名"]);
  return (configured || propertyText(properties.title) || propertyText(properties.name)).replaceAll("`", "").trim().toLocaleUpperCase();
}

export function configPageValue(page: NotionConfigPage): string {
  const properties = page.properties || {};
  const link = typeof properties["链接"]?.url === "string" ? properties["链接"].url.trim() : "";
  return (link || propertyText(properties["配置值"]) || propertyText(properties.value) || propertyText(properties.slug)).trim();
}

export function configPageFileUrl(page: NotionConfigPage | undefined): string {
  const properties = page?.properties || {};
  const files = properties["图片"]?.files || properties.image?.files || properties.Image?.files;
  if (!Array.isArray(files) || !files.length) return "";
  const file = files[0];
  const rawUrl = typeof file?.file?.url === "string" ? file.file.url : typeof file?.external?.url === "string" ? file.external.url : "";
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && NOTION_FILE_HOSTS.has(url.hostname) ? url.href : "";
  } catch { return ""; }
}

export function isConfigLinkPage(page: NotionConfigPage): boolean {
  const properties = page.properties || {};
  if (properties["启用"]?.checkbox !== true) return false;
  if (properties["类型"]?.select?.name === "Link" || properties.type?.select?.name === "Link") return true;
  const key = configPageKey(page);
  return key === "LINK" || key.startsWith("LINK:") || key.startsWith("LINK_");
}

function configBoolean(value: string, fallback: boolean): boolean {
  if (TRUE_VALUES.test(value)) return true;
  if (FALSE_VALUES.test(value)) return false;
  return fallback;
}

function configEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  const normalized = value.trim().toLocaleLowerCase() as T;
  return allowed.includes(normalized) ? normalized : fallback;
}

function configColor(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return FULL_HEX_COLOR.test(normalized) ? normalized : "";
}

function safePublicAsset(value: string): string {
  const cleaned = value.trim();
  if (/^\/(?!\/)[^\s]*$/.test(cleaned)) return cleaned.slice(0, 500);
  try {
    const url = new URL(cleaned);
    return url.protocol === "https:" ? url.href.slice(0, 500) : "";
  } catch { return ""; }
}

function versionedConfigAsset(path: string, page: NotionConfigPage): string {
  const editedAt = Date.parse(page.last_edited_time || "");
  return Number.isFinite(editedAt) ? `${path}?v=${editedAt.toString(36)}` : path;
}

function cleanConfigText(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function propertyText(property: NotionProperty | undefined): string {
  const value = property?.rich_text || property?.title;
  return Array.isArray(value) ? value.map((item) => item.plain_text || item.text?.content || "").join("") : "";
}
