import { expect, test } from "@playwright/test";

const routes = [
  ["/", /Your Discord/i],
  ["/features", /A calmer server/i],
  ["/privacy", /control of your data/i],
  ["/subscriptions", /More orbit/i],
  ["/missing-page", /drifted out of range/i],
] as const;

for (const [route, heading] of routes) {
  test(`${route} is readable without horizontal overflow`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("landing page supports keyboard focus and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your Discord/i })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
  await expect(page.locator(".motion-layer")).toBeHidden();
});

test("landing visual baseline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your Discord/i })).toBeVisible();
  await expect(page).toHaveScreenshot("landing.png", { fullPage: true });
});
