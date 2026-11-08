import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

// The prompt dock: settings live in chips under the canvas; each opens its own panel above the bar.
test("tool settings open from chips in the prompt dock, in English and Arabic", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Dock E2E");
  await page.locator("#auth-company").fill(`Dock Co ${unique()}`);
  await page.locator("#auth-email").fill(`dock-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  await page.goto("/en/generate");
  // The whole rail fits a laptop screen (Playwright's default is 1280×720), More included.
  await expect(page.getByRole("button", { name: "More" })).toBeInViewport({ ratio: 1 });

  // A compact prompt bar pinned under the results; the page heading is for screen readers.
  await expect(page.getByRole("heading", { level: 1, name: "Place your product anywhere" })).toHaveCount(1);
  const settings = page.getByRole("group", { name: "Settings" });
  // Nothing is open on arrival: the canvas stays clear.
  await expect(page.locator("#sku")).toBeHidden();
  await expect(settings.getByRole("button", { name: /^Product Info, Needs your input/ })).toBeVisible();

  // The start screen offers examples: "Try it" fills the scene, style and prompt, then asks for the product.
  await page.getByRole("button", { name: "Try it: Scandinavian living room" }).click();
  await expect(settings.getByRole("button", { name: /^Scene Settings: Living Room · Scandinavian/ })).toBeVisible();
  await expect(page.locator("#instructions")).toHaveValue(/soft morning window light/);
  await expect(page.locator("#sku")).toBeFocused();
  await page.locator("#sku").press("Escape");

  // A chip opens its panel; another chip swaps it; Escape closes it.
  await settings.getByRole("button", { name: /^Format & Dimensions/ }).click();
  await page.getByRole("radiogroup", { name: "Aspect Ratio" }).getByRole("radio", { name: "16:9" }).click();
  await expect(settings.getByRole("button", { name: /^Format & Dimensions: 16:9 · HD/ })).toBeVisible();
  await settings.getByRole("button", { name: /^Product Info/ }).click();
  await expect(page.getByRole("radiogroup", { name: "Aspect Ratio" })).toBeHidden();
  await page.locator("#sku").fill("DOCK-1");
  await expect(settings.getByRole("button", { name: /^Product Info: DOCK-1/ })).toBeVisible();
  await page.locator("#sku").press("Escape");
  await expect(page.locator("#sku")).toBeHidden();

  // The product tile opens the product panel too; clicking the canvas closes it.
  await page.getByRole("button", { name: "Product", exact: true }).click();
  await expect(page.locator("#sku")).toBeFocused();
  await page.mouse.click(1200, 120); // top corner of the canvas, clear of the panel
  await expect(page.locator("#sku")).toBeHidden();

  // The prompt stays inline, and Single/Bulk sits in the bar.
  await expect(page.locator("#instructions")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Generate mode" }).getByRole("link", { name: "Bulk" })).toBeVisible();

  // The "will appear here" placeholder shows at the start, and collapses once editing starts.
  await page.goto("/en/aplus");
  await expect(page.getByText("Your A+ image will appear here")).toBeVisible();
  await page.getByRole("group", { name: "Settings" }).getByRole("button", { name: /^Text Content/ }).click();
  await expect(page.getByText("Your A+ image will appear here")).toBeHidden();

  // Bulk: the product list is pasted or uploaded, one input at a time.
  await page.goto("/en/generate/bulk");
  const source = page.getByRole("radiogroup", { name: "How to add products" });
  await expect(page.locator("#bulk-skus")).toBeVisible();
  await expect(page.getByRole("button", { name: "Template" })).toBeHidden();
  await source.getByRole("radio", { name: "Upload CSV" }).click();
  await expect(page.locator("#bulk-skus")).toBeHidden();
  await expect(page.getByRole("button", { name: "Template" })).toBeVisible();
  await source.getByRole("radio", { name: "Paste SKUs" }).click();
  await expect(page.locator("#bulk-skus")).toBeVisible();

  // Arabic: same dock, mirrored.
  await page.goto("/ar/generate");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("group", { name: "الإعدادات" }).getByRole("button").first().click();
  await expect(page.locator("#sku")).toBeVisible();
});

test("Resize runs from the prompt dock: add images, pick a platform, resize, download", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Resize E2E");
  await page.locator("#auth-company").fill(`Resize Co ${unique()}`);
  await page.locator("#auth-email").fill(`resize-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  await page.goto("/en/resize");
  const settings = page.getByRole("group", { name: "Settings" });
  await expect(settings.getByRole("button", { name: /^Platform: Amazon/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resize All Images" })).toBeDisabled();
  await page.locator('input[type="file"]').setInputFiles("public/demo/sofa-source.png");
  await settings.getByRole("button", { name: /^Platform/ }).click();
  await page.getByRole("radio", { name: "Shopify" }).click();
  await expect(settings.getByRole("button", { name: /^Platform: Shopify/ })).toBeVisible();
  await page.getByRole("button", { name: "Resize All Images" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Download as ZIP" })).toBeEnabled();
});

test("Looks: the catalog shows as cards, the room is visible, and products land on it", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Looks E2E");
  await page.locator("#auth-company").fill(`Looks Co ${unique()}`);
  await page.locator("#auth-email").fill(`looks-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // No catalog yet: the panel says how to connect one.
  await page.goto("/en/looks");
  await expect(page.getByText("Connect your store")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build a shop-the-look photo" })).toBeVisible();

  await page.goto("/en/settings/integrations");
  await page.getByRole("button", { name: "Add connection" }).first().click();
  await page.getByRole("button", { name: /Demo/ }).click();
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();

  // The catalog opens as cards; adding one marks it Added and places it on the room.
  await page.goto("/en/looks");
  const add = page.getByRole("button", { name: /^Add .* to the look$/ }).first();
  await expect(add).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate Look" })).toBeDisabled();
  await add.click();
  await expect(page.getByText("Added", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Layers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate Look" })).toBeEnabled();
});
