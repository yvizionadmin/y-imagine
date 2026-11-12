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

test("the home page shows a before/after you can drag or key through, and tells search engines what it is", async ({ page }) => {
  await page.goto("/en");
  const slider = page.getByRole("slider", { name: "Compare the product photo with the AI scene" });
  await expect(slider).toBeVisible();
  await expect(page.getByRole("img", { name: "A grey sofa photographed on a plain studio background" })).toBeAttached();
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("100");

  const data = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types = data.flatMap((text) => (JSON.parse(text)["@graph"] ?? [JSON.parse(text)]).map((t: { "@type": string }) => t["@type"]));
  expect(types).toEqual(expect.arrayContaining(["Organization", "WebSite", "SoftwareApplication"]));
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");

  // The scene carousel moves with its buttons, and its centre slide stays clear after visiting other pages and coming back.
  const main = page.getByRole("navigation", { name: "Main" }).first();
  await main.getByRole("link", { name: "Pricing" }).click();
  await main.getByRole("link", { name: "Features" }).click();
  await page.getByRole("banner").getByRole("link", { name: "Imagine AI" }).click();
  await expect(page).toHaveURL(/\/en$/);
  const next = page.getByRole("button", { name: "Next scene" });
  await next.scrollIntoViewIfNeeded();
  await next.click();
  const active = page.locator(".mkt-coverflow .swiper-slide-active .mkt-scene");
  await expect(active).toHaveCSS("filter", "none");
  await expect(active).toHaveCSS("opacity", "1");
});

test("features: the index jumps to a section and the recolor preview switches colour", async ({ page }) => {
  await page.goto("/en/features");
  await page.getByRole("navigation", { name: "Jump to a feature" }).getByRole("link", { name: "Team and control" }).click();
  await expect(page.getByRole("heading", { name: "Team and control" })).toBeInViewport();
  const colors = page.getByRole("radiogroup", { name: "Colors" });
  await colors.getByRole("radio", { name: "Navy" }).click();
  await expect(colors.getByRole("radio", { name: "Navy" })).toHaveAttribute("aria-checked", "true");
  expect(await page.locator('script[type="application/ld+json"]').textContent()).toContain("BreadcrumbList");
});

test("pricing: the questions open one at a time and every answer is in the page for search engines", async ({ page }) => {
  await page.goto("/en/pricing");
  const first = page.getByRole("button", { name: "Do I need my own AI key?" });
  const cancel = page.getByRole("button", { name: "Can I cancel?" });
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await cancel.click();
  await expect(cancel).toHaveAttribute("aria-expanded", "true");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Your plan stays active until the end of the paid period")).toBeVisible();

  const faq = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "[]") as { "@type": string; mainEntity?: unknown[] }[];
  expect(faq.find((t) => t["@type"] === "FAQPage")?.mainEntity).toHaveLength(5);
  // Closed answers are collapsed, not removed.
  await expect(page.getByText("Credits are your plan's monthly quota of jobs")).toBeAttached();
});

test("search engines get a sitemap and robots file", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/en/pricing");
  expect(sitemap).toContain("/ar/features");
  expect(sitemap).not.toContain("/terms");
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /api/");
});
