import assert from "node:assert/strict";
import test from "node:test";
import { extractCities } from "../shared/cities.js";
import { buildWordCloud } from "../shared/wordCloud.js";

test("city mentions use only public title and body and group aliases by article", () => {
  const docs = [
    { id: "a", title: "东京", body: "Tokyo 东京，上海。摄影 摄影。", summary: "伦敦", tags: ["北京"] },
    { id: "b", title: "旅行", body: "东京与上海。" },
  ];
  const result = extractCities(docs);
  const tokyo = result.cities.find((city) => city.word === "东京");
  assert.equal(tokyo.count, 4);
  assert.deepEqual(tokyo.postIds, ["a", "b"]);
  assert.ok(result.cities.some((city) => city.word === "上海"));
  assert.ok(!result.cities.some((city) => ["伦敦", "北京"].includes(city.word)));
  const words = buildWordCloud(docs, 56, result.matchedWords);
  assert.ok(!words.some((word) => word.word === "东京" || word.word === "上海"));
  assert.ok(words.some((word) => word.word === "摄影"));
});

test("English and simplified Chinese city aliases are grouped", () => {
  const result = extractCities([{ id: "a", title: "New York", body: "纽约，紐約。" }]);
  assert.deepEqual(result.cities.find((city) => city.word === "纽约"), { word: "纽约", count: 3, postIds: ["a"] });
});
