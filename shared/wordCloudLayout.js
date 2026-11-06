/** Arrange measured words from the bottom up. Rectangles may touch or overlap
 * slightly, but never completely cover a previous word's clickable area. */
export function layoutFallingWords(sizes, availableWidth, mode) {
  const width = Math.max(1, availableWidth);
  const placed = [];
  for (let index = 0; index < sizes.length; index++) {
    const itemWidth = Math.min(width, Math.max(1, sizes[index].width));
    const itemHeight = Math.max(1, sizes[index].height);
    const maxX = Math.max(0, width - itemWidth);
    const preferred = mode === "pile" ? maxX / 2 : maxX * ((index * 0.61803398875 + 0.17) % 1);
    const candidates = mode === "pile"
      ? Array.from({ length: Math.ceil(maxX / 24) + 1 }, (_, n) => Math.min(maxX, n * 24)).concat([maxX, preferred])
      : [preferred];
    let bestX = preferred;
    let bestY = Infinity;
    let bestCost = Infinity;
    for (const candidate of candidates) {
      let bottom = 0;
      for (const other of placed) {
        if (candidate < other.x + other.width + 2 && candidate + itemWidth + 2 > other.x) {
          bottom = Math.max(bottom, other.bottom + other.height - Math.min(3, other.height * 0.1, itemHeight * 0.1));
        }
      }
      const cost = bottom + (mode === "pile" ? Math.abs(candidate - preferred) * 0.36 : 0);
      if (cost < bestCost) { bestCost = cost; bestX = candidate; bestY = bottom; }
    }
    placed.push({ x: bestX, bottom: bestY, width: itemWidth, height: itemHeight });
  }
  const height = Math.max(240, ...placed.map((item) => item.bottom + item.height + 8));
  return { height, positions: placed.map((item) => ({ left: item.x, top: height - item.bottom - item.height })) };
}
