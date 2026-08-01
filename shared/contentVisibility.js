// Notion may typographically convert repeated ASCII hyphens into em/en dashes.
const HIDE_MARKER = /^[-‐‑‒–—―]{2,}\s*\[hide\]\s*[-‐‑‒–—―]{2,}$/i;

function blockText(block) {
  if (!block || typeof block !== "object") return "";
  if (Array.isArray(block.richText)) return block.richText.map((item) => item?.text || "").join("").trim();
  return "";
}

/**
 * Removes Notion blocks delimited by standalone `------[hide]------` markers,
 * including Notion's typographic `———[hide]———` conversion.
 * The source blocks remain untouched so server-side RSS discovery can still use them.
 */
export function withoutHiddenNotionBlocks(blocks) {
  const visible = [];
  let hidden = false;
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (HIDE_MARKER.test(blockText(block))) {
      hidden = !hidden;
      continue;
    }
    if (!hidden) visible.push(block);
  }
  return visible;
}
