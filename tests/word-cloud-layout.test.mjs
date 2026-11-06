import assert from "node:assert/strict";
import test from "node:test";
import { layoutFallingWords } from "../shared/wordCloudLayout.js";

test("falling layouts stay within bounds, avoid full cover, and use distinct placements", () => {
  const sizes = Array.from({ length: 48 }, (_, i) => ({ width: 30 + (i * 37) % 130, height: 24 + (i % 4) * 7 }));
  for (const width of [290, 600, 900]) {
    const pile = layoutFallingWords(sizes, width, "pile");
    const drift = layoutFallingWords(sizes, width, "drift");
    assert.equal(pile.positions.length, sizes.length);
    assert.notDeepEqual(pile.positions, drift.positions);
    for (const layout of [pile, drift]) {
      for (let i = 0; i < sizes.length; i++) {
        const { left, top } = layout.positions[i];
        assert.ok(left >= 0 && left + sizes[i].width <= width + 0.01);
        assert.ok(top >= 0 && top + sizes[i].height <= layout.height + 0.01);
        for (let j = 0; j < i; j++) {
          const other = layout.positions[j];
          const overlapX = Math.max(0, Math.min(left + sizes[i].width, other.left + sizes[j].width) - Math.max(left, other.left));
          const overlapY = Math.max(0, Math.min(top + sizes[i].height, other.top + sizes[j].height) - Math.max(top, other.top));
          assert.ok(overlapX * overlapY < sizes[i].width * sizes[i].height * 0.2, "each word keeps a usable area");
        }
      }
    }
  }
});
