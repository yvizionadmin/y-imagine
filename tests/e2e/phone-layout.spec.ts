import { expect, test, type Locator, type Page } from "@playwright/test";

// The app shell and the crowded screens on a phone, in both languages. Clipped content doesn't show up as page
// scroll, so these check that the controls are really on screen.

async function signUp(page: Page) {
  const id = Math.random().toString(36).slice(2, 8);
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Owner E2E");
  await page.locator("#auth-company").fill(`Layout ${id}`);
  await page.locator("#auth-email").fill(`layout-${id}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);
}

async function expectOnScreen(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  const width = locator.page().viewportSize()!.width;
  expect(box.x, "starts on screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "ends on screen").toBeLessThanOrEqual(width);
}

for (const locale of ["en", "ar"]) {
  test(`top bar, History, Looks and Team fit a phone (${locale})`, async ({ page }) => {
    await signUp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const account = page.getByRole("button", { name: locale === "en" ? /Account menu/ : /قائمة الحساب/ });

    // Tool pages carry a badge, which used to push the account menu off the bar.
    for (const route of ["generate", "recolor/bulk", "looks", "history", "qr"]) {
      await page.goto(`/${locale}/${route}`);
      const fits = await page.locator("header").first().evaluate((bar) => bar.scrollWidth <= bar.clientWidth);
      expect(fits, route).toBe(true);
      await expectOnScreen(account);
    }
    await account.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto(`/${locale}/history`);
    await expectOnScreen(page.locator("#history-sku"));
    await expectOnScreen(page.locator('input[type="date"]').first());
    await expectOnScreen(page.locator('input[type="date"]').last());
    await expectOnScreen(page.locator("#history-review"));
    await expectOnScreen(page.locator('form button[type="submit"]'));

    // One row of tabs that scrolls, not labels wrapping onto two lines.
    await page.goto(`/${locale}/looks`);
    const tabs = page.locator('nav:has(a[href$="/looks/boards"]) a');
    const tops = await tabs.evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
    expect(new Set(tops).size).toBe(1);

    // The member actions stay reachable without scrolling the table sideways.
    await page.goto(`/${locale}/settings/team`);
    await expectOnScreen(page.locator("thead th").last());
  });

  // U7: the results area's "will appear here" text isn't cut at the edges, and the prompt dock keeps its chips on
  // a full-width row with Generate below, instead of one chip per line.
  test(`tool screens fit a phone: empty results and the prompt dock (${locale})`, async ({ page }) => {
    await signUp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["recolor", "aplus", "qr"]) {
      await page.goto(`/${locale}/${route}`);
      const empty = page.locator("[data-empty-state]").first();
      await expectOnScreen(empty.locator("h2, h3, p").first());
      await expectOnScreen(empty.locator("p").last());
      const chips = page.getByRole("group", { name: locale === "en" ? "Settings" : /الإعدادات/ });
      // The chips get the dock's whole row (minus its padding), not a narrow column beside Generate.
      const share = await chips.evaluate((el) => el.getBoundingClientRect().width / el.parentElement!.clientWidth);
      expect(share, `${route}: chips use the dock's width`).toBeGreaterThan(0.85);
    }
  });
}
