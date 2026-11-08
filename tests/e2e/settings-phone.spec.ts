import { expect, test, type Page } from "@playwright/test";

// Settings on a phone: the sub-menu sits above the page instead of squeezing it, in both languages.

const PAGES = ["team", "api-keys", "brand", "billing", "integrations"];

async function signUp(page: Page) {
  const id = Math.random().toString(36).slice(2, 8);
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Owner E2E");
  await page.locator("#auth-company").fill(`Phone ${id}`);
  await page.locator("#auth-email").fill(`phone-${id}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const locale of ["en", "ar"]) {
  test(`every settings page fits a phone (${locale})`, async ({ page }) => {
    await signUp(page);
    await page.setViewportSize({ width: 390, height: 844 });

    for (const name of PAGES) {
      await page.goto(`/${locale}/settings/${name}`);
      await expect(page.locator(`nav a[href="/${locale}/settings/${name}"]`)).toHaveAttribute("aria-current", "page");
      await page.waitForLoadState("networkidle");
      expect(await noSidewaysScroll(page), name).toBe(true);
    }

    // Cards get the width, and the links work from the row above the page.
    await page.goto(`/${locale}/settings/api-keys`);
    const card = page.locator("ul > li").filter({ has: page.getByRole("heading", { name: "Kling", exact: true }) });
    await expect(card).toBeVisible();
    expect((await card.boundingBox())!.width).toBeGreaterThan(250);

    const content = await page.locator("main > div > div > div").first().boundingBox();
    const nav = await page.getByRole("navigation", { name: locale === "en" ? "Settings" : "الإعدادات" }).boundingBox();
    expect(nav!.y + nav!.height).toBeLessThanOrEqual(content!.y + 1);

    await page.locator(`nav a[href="/${locale}/settings/billing"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/settings/billing`));
  });
}

test("on desktop the sub-menu stays a sidebar, with its title and upcoming items", async ({ page }) => {
  await signUp(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/en/settings/api-keys");
  const nav = page.getByRole("navigation", { name: "Settings" });
  await expect(nav.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(nav.getByText("General")).toBeVisible();
  const box = await nav.boundingBox();
  expect(box!.width).toBe(240);
  expect(box!.height).toBeGreaterThan(400);
});
