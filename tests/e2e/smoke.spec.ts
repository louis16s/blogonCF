import { expect, test } from "@playwright/test";

test("the production shell renders without browser errors", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/louis16s/i);
  await expect(page.getByText("请先配置 Notion 内容源")).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog-overlay], vite-error-overlay")).toHaveCount(0);
  if (testInfo.project.name === "chromium-mobile") {
    const menu = page.locator("details.mobile-menu");
    await menu.locator(":scope > summary").click();
    await expect(menu).toHaveAttribute("open", "");
    await expect(page.getByRole("navigation", { name: "移动端菜单" })).toBeVisible();
  } else {
    await expect(page.getByRole("complementary", { name: "站点导航" })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("missing content produces an in-site error page rather than a framework overlay", async ({ page }) => {
  const response = await page.goto("/blog/not-configured", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(503);
  await expect(page.getByText(/Notion connection is not configured|文章暂时无法读取/)).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog-overlay], vite-error-overlay")).toHaveCount(0);
});
