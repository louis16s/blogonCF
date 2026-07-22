const STOP_WORDS = new Set([
  "一个", "一些", "这个", "这些", "那个", "那些", "自己", "我们", "你们", "他们", "以及", "因为", "所以", "但是", "如果", "没有", "可以", "还是", "就是", "什么", "如何", "关于", "来自", "已经", "进行", "记录", "文章", "分享", "随笔", "输入密码", "未分类",
  "the", "and", "for", "with", "from", "this", "that", "into", "your", "you", "are", "was", "were", "notion", "blog",
]);

const LATIN_WORD = /^[a-z\d][a-z\d.+#-]*$/i;
const HAN = /[\p{Script=Han}]/u;
const FALLBACK_WORDS = /[\p{Script=Han}]{2,8}|[a-z\d][a-z\d.+#-]{1,}/giu;

export function normalizeSearchText(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function normalizeWord(value) {
  const word = normalizeSearchText(value)
    .replace(/^[#@\s]+|[，。！？、：；“”‘’（）()《》【】\[\],.!?:;\s]+$/g, "")
    .trim();
  if (!word || STOP_WORDS.has(word)) return "";
  if (LATIN_WORD.test(word)) return word.length >= 2 ? word : "";
  return HAN.test(word) && word.length >= 2 && word.length <= 10 ? word : "";
}

function segmentWords(value) {
  const text = String(value || "");
  if (!text.trim()) return [];
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
    return Array.from(segmenter.segment(text), (part) => part.isWordLike ? normalizeWord(part.segment) : "").filter(Boolean);
  }
  return Array.from(text.matchAll(FALLBACK_WORDS), (match) => normalizeWord(match[0])).filter(Boolean);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Builds a deterministic word cloud from public article titles and bodies only.
 * Article properties such as summary, category and tags are intentionally ignored.
 *
 * @param {Array<{id?: string, title?: string, body?: string}>} documents
 * @param {number} [limit]
 * @returns {Array<{word: string, count: number, level: number, tone: number, tilt: number, postIds: string[]}>}
 */
export function buildWordCloud(documents, limit = 56) {
  const frequencies = new Map();

  for (const document of documents || []) {
    const documentId = String(document.id || "");
    for (const word of segmentWords(`${document.title || ""} ${document.body || ""}`)) {
      const current = frequencies.get(word) || { count: 0, postIds: new Set() };
      current.count += 1;
      if (documentId) current.postIds.add(documentId);
      frequencies.set(word, current);
    }
  }

  const ranked = Array.from(frequencies, ([word, value]) => ({ word, count: value.count, postIds: Array.from(value.postIds) }))
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count || b.postIds.length - a.postIds.length || a.word.localeCompare(b.word, "zh-CN"))
    .slice(0, Math.max(0, limit));
  if (!ranked.length) return [];

  const min = ranked[ranked.length - 1].count;
  const max = ranked[0].count;
  return ranked.map((item) => {
    const hash = stableHash(item.word);
    return {
      ...item,
      level: max === min ? 3 : Math.round(1 + ((Math.sqrt(item.count) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min))) * 4),
      tone: hash % 6,
      tilt: (Math.floor(hash / 6) % 9) - 4,
    };
  });
}
