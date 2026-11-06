import { readFile, writeFile } from "node:fs/promises";

// Input: the unmodified cities15000.txt from GeoNames. Keep the output small
// enough for Workers Free while covering capitals, regional capitals and large cities.
const input = process.argv[2];
const conversion = process.argv[3];
if (!input || !conversion) throw new Error("Usage: node scripts/update-city-data.mjs /path/to/cities15000.txt /path/to/TSCharacters.txt");
const source = await readFile(input, "utf8");
const characterData = await readFile(conversion, "utf8");
const characters = new Map(characterData.split("\n").filter((line) => line && !line.startsWith("#")).map((line) => {
  const [traditional, simplified = ""] = line.split("\t");
  return [traditional, simplified.split(" ")[0]];
}));
const simplify = (name) => Array.from(name, (character) => characters.get(character) || character).join("");
const cities = source.split("\n").map((line) => line.split("\t"))
  .filter((row) => row.length > 14 && (Number(row[14]) >= 250000 || ["PPLC", "PPLA"].includes(row[7])))
  .sort((a, b) => Number(b[14]) - Number(a[14]))
  .map((row) => {
    const han = row[3].split(",").filter((name) => /^[\p{Script=Han}]{2,5}$/u.test(name) && !name.endsWith("市"));
    return [...new Set([han[0] ? simplify(han[0]) : row[1], row[2], ...han.slice(0, 6), ...han.slice(0, 6).map(simplify)].filter(Boolean))];
  });
await writeFile(new URL("../shared/cityNames.json", import.meta.url), `${JSON.stringify(cities)}\n`);
