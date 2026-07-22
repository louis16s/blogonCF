const STOP_WORDS = new Set([
  "一个", "一些", "这个", "这些", "那个", "那些", "自己", "我们", "你们", "他们", "以及", "因为", "所以", "但是", "如果", "没有", "可以", "还是", "就是", "什么", "如何", "关于", "来自", "已经", "进行", "记录", "文章", "分享", "随笔", "输入密码", "未分类",
  "the", "and", "for", "with", "from", "this", "that", "into", "your", "you", "are", "was", "were", "notion", "blog",
]);

const LATIN_WORD = /^[a-z\d][a-z\d.+#-]*$/i;
const HAN = /[\p{Script=Han}]/u;
const FALLBACK_WORDS = /[\p{Script=Han}]{2,8}|[a-z\d][a-z\d.+#-]{1,}/giu;

function normalizeWord(value) {
  const word = String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/^[#@\s]+|[，。！？、：；“”‘’（）()《》【】\[\],.!?:;\s]+$/g, "")
    .toLocaleLowerCase("zh-CN");
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

/**
 * Builds a deterministic, metadata-aware word cloud from public post summaries.
 * Tags are strongest signals, categories are next, and prose tokens add context.
 *
 * @param {Array<{title?: string, summary?: string, category?: string, tags?: string[]}>} posts
 * @param {number} [limit]
 * @returns {Array<{word: string, count: number, level: number}>}
 */
export function buildWordCloud(posts, limit = 22) {
  const scores = new Map();
  const add = (value, weight) => {
    const word = normalizeWord(value);
    if (word) scores.set(word, (scores.get(word) || 0) + weight);
  };

  for (const post of posts || []) {
    add(post.category, 2);
    for (const tag of post.tags || []) add(tag, 3);
    for (const word of segmentWords(`${post.title || ""} ${post.summary || ""}`)) add(word, 1);
  }

  const ranked = Array.from(scores, ([word, count]) => ({ word, count }))
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "zh-CN"))
    .slice(0, Math.max(0, limit));
  if (!ranked.length) return [];

  const min = ranked[ranked.length - 1].count;
  const max = ranked[0].count;
  return ranked.map((item) => ({
    ...item,
    level: max === min ? 3 : Math.round(1 + ((item.count - min) / (max - min)) * 4),
  }));
}
