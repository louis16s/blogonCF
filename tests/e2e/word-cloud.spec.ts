import { expect, test } from "@playwright/test";

test("compact word layouts stay usable and fit the viewport", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const words = Array.from({ length: 36 }, (_, i) => ({
    word: ["摄影", "旁轴相机", "旅行", "设计", "louis16s", "生活"][i % 6] + i,
    count: 40 - i, level: Math.max(1, 5 - Math.floor(i / 8)), tone: i % 6, tilt: i % 9 - 4, postIds: ["fixture"],
  }));
  await page.route("**/api/content/word-cloud", (route) => route.fulfill({ json: { words, sourceCount: 1 } }));
  await page.goto("/#word-cloud", { waitUntil: "domcontentloaded" });
  const dialog = page.getByRole("dialog", { name: "词云" });
  await expect(dialog).toBeVisible();
  const canvas = dialog.locator(".word-cloud-canvas");
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ["堆叠", "散落"]) {
      await dialog.getByRole("button", { name: mode }).click();
      await expect(canvas.locator("button[data-level]")).toHaveCount(words.length);
      const layout = await canvas.evaluate((node) => ({
        gap: Number.parseFloat(getComputedStyle(node).columnGap),
        overflow: node.scrollWidth > node.clientWidth + 1,
      }));
      expect(layout.gap).toBeLessThanOrEqual(12);
      expect(layout.overflow).toBe(false);
      const word = canvas.locator("button[data-level]").first();
      await word.click();
      await expect(word).toHaveAttribute("aria-pressed", "true");
      await expect(dialog.getByText("相关文章正在同步，请稍后再打开。")).toBeVisible();
      await word.click();
    }
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
