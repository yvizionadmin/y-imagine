import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

test("a signed-out visitor sees the site, moves through it and signs up", async ({ page }) => {
  await page.goto("/en");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Product content");

  const main = page.getByRole("navigation", { name: "Main" }).first();
  await main.getByRole("link", { name: "Features" }).click();
  await expect(page).toHaveURL(/\/en\/features$/);
  await expect(page.getByRole("heading", { name: "Everything your catalog team needs" })).toBeVisible();

  await main.getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/en\/pricing$/);
  for (const plan of ["Free", "Starter", "Pro", "Enterprise"]) await expect(page.getByRole("heading", { name: plan, exact: true })).toBeVisible();
  await expect(page.getByText("200 job credits / month")).toBeVisible();
  await expect(page.getByText("Video not included")).toBeVisible();
  // A link styled as an outline button keeps its visible edge.
  const outline = await page.getByRole("link", { name: "Get started" }).first().evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(outline).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.getByText(/25 GB video storage · clips kept 90 days/)).toBeVisible();

  const footer = page.getByRole("contentinfo");
  await footer.getByRole("link", { name: "Terms" }).click();
  await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("not yet legally reviewed");
  await footer.getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();

  await page.getByRole("link", { name: "Start free" }).first().click();
  await expect(page).toHaveURL(/\/en\/sign-up/);
  await expect(page.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/en/terms");
  await page.locator("#auth-name").fill("Visitor");
  await page.locator("#auth-company").fill(`Visitor Co ${unique()}`);
  await page.locator("#auth-email").fill(`visitor-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // With a session, the site's home goes straight to the Studio; other public pages still open.
  await page.goto("/en");
  await expect(page).toHaveURL(/\/en\/home$/);
  await page.goto("/en/pricing");
  await expect(page.getByRole("heading", { name: "Simple plans, your own AI keys" })).toBeVisible();
});

test("the Arabic site is right-to-left, can switch language, and private pages stay private", async ({ page }) => {
  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("محتوى منتجات");
  await expect(page).toHaveTitle(/إيماجن AI/);

  await page.goto("/ar/pricing");
  await expect(page.getByRole("heading", { name: "باقات بسيطة بمفاتيحك الخاصة" })).toBeVisible();
  await page.goto("/ar/terms");
  await expect(page.getByRole("heading", { name: "شروط الخدمة" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await page.getByRole("banner").locator('a[href="/en/terms"]').click();
  await expect(page).toHaveURL(/\/en\/terms$/);

  await page.goto("/en/dashboard");
  await expect(page).toHaveURL(/\/en\/sign-in/);

  // No sideways scroll on a phone.
  await page.setViewportSize({ width: 390, height: 800 });
  for (const path of ["/ar", "/en/pricing", "/ar/features"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("search engines get a sitemap and robots file", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/en/pricing");
  expect(sitemap).toContain("/ar/features");
  expect(sitemap).not.toContain("/terms");
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /api/");
});
