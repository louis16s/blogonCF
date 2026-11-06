import cityNames from "./cityNames.json" with { type: "json" };
import { normalizeSearchText, segmentWords } from "./wordCloud.js";

// GeoNames aliases are sorted by population; the first match wins when names collide.
let aliases;

function cityAliases() {
  if (aliases) return aliases;
  aliases = new Map();
  for (const [display, ...names] of cityNames) {
    for (const name of [display, ...names, ...names.map((value) => value.replace(/ City$/i, ""))]) {
      const normalized = normalizeSearchText(name);
      if ((!/^[\p{Script=Han}]{2,5}$/u.test(normalized) && !/^[a-z][a-z .'-]{3,30}$/i.test(normalized)) || aliases.has(normalized)) continue;
      aliases.set(normalized, display);
    }
  }
  return aliases;
}

/** Collect city mentions as the shared word segmentation runs. */
export function createCityCollector() {
  const lookup = cityAliases();
  const frequencies = new Map();
  const matchedWords = new Set();
  let previous = "";
  let previousId = "";
  return {
    matchedWords,
    observe(raw, normalized, id) {
      const isLatin = /^[a-z]/i.test(raw);
      const capitalized = isLatin && /^[A-Z]/.test(raw);
      const compound = capitalized && previousId === id && previous ? `${previous} ${normalized}` : "";
      previous = capitalized ? normalized : "";
      previousId = id;
      const key = compound && lookup.has(compound) ? compound : normalized;
      if (isLatin && !capitalized) return;
      const city = lookup.get(key);
      if (!city) return;
      const entry = frequencies.get(city) || { word: city, count: 0, postIds: new Set() };
      entry.count++;
      if (id) entry.postIds.add(String(id));
      frequencies.set(city, entry);
      matchedWords.add(key);
    },
    getCities() {
      return Array.from(frequencies.values(), ({ word, count, postIds }) => ({ word, count, postIds: Array.from(postIds) }))
        .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "zh-CN"));
    },
  };
}

/** Extract city mentions from public titles and bodies; ambiguous names can be imperfect. */
export function extractCities(documents) {
  const collector = createCityCollector();
  for (const document of documents || []) {
    segmentWords(`${document.title || ""} ${document.body || ""}`, (raw, word) => collector.observe(raw, word, String(document.id || "")));
  }
  return { cities: collector.getCities(), matchedWords: collector.matchedWords };
}
