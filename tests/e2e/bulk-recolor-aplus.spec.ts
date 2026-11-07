import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SCREENSHOTS;

async function signUpWithCatalog(page: Page) {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Bulk Tools");
  await page.locator("#auth-company").fill(`Tools Co ${unique()}`);
  await page.locator("#auth-email").fill(`tools-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);
  await page.goto("/en/settings/integrations");
  await page.getByRole("button", { name: "Add connection" }).first().click();
  await page.getByRole("button", { name: /Demo/ }).click();
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
}

// No Redis in E2E: runs are processed in the web process after the response.
test("bulk recolor: one swatch on several SKUs, saved to History", async ({ page }) => {
  await signUpWithCatalog(page);
  await page.goto("/en/recolor");
  await page.getByRole("link", { name: "Bulk" }).click();
  await expect(page).toHaveURL(/\/en\/recolor\/bulk/);

  await page.locator("#bulk-skus").fill("SOFA-12345\nCHAIR-OAK-99");
  await expect(page.getByText("2 products ready")).toBeVisible();
  // Starting needs the swatch's colour first.
  await expect(page.getByRole("button", { name: "Recolor 2 products" })).toBeDisabled();
  await page.getByRole("button", { name: /^New Fabric Color/ }).click();
  // Nothing is pre-picked: choose the category too.
  await page.locator("#bulk-category").selectOption("furniture");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Upload fabric swatch/ }).click(); // the single Recolor page stays mounted (hidden) after navigating
  await (await chooser).setFiles(path.join(process.cwd(), "public/demo/sofa-source.png"));
  await expect(page.getByRole("button", { name: "Recolor 2 products" })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole("button", { name: "Recolor 2 products" }).click();

  await expect(page.getByText("Finished", { exact: true }).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("2 of 2 made").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Images in this run" }).getByRole("img")).toHaveCount(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-recolor-en.png` });

  await page.goto("/en/dashboard");
  await expect(page.getByText("48 credits")).toBeVisible();
});

test("bulk A+: a CSV with per-product text, one A+ image each", async ({ page }) => {
  await signUpWithCatalog(page);
  await page.goto("/en/aplus");
  await page.getByRole("link", { name: "Bulk" }).click();
  await expect(page).toHaveURL(/\/en\/aplus\/bulk/);

  await page
    .locator("#bulk-skus")
    .fill(
      [
        "sku,title,subtitle,feature_1,feature_1_text,feature_2,feature_2_text",
        'SOFA-12345,Oslo Sofa,"Soft, deep seats",Linen,Breathable woven linen,Oak legs,Solid oak',
        "CHAIR-OAK-99,,Made to last,Shell,Curved shell,Legs,Steel",
        "NOPE-1,Bad,,Only one,feature,,",
      ].join("\n"),
    );
  await expect(page.getByText("2 products ready")).toBeVisible();
  await expect(page.getByText("Row 3: needs at least 2 features with text")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create 2 A+ images" })).toBeDisabled();
  await page.getByRole("button", { name: /^Scene & Style/ }).click();
  await page.locator("#bulk-category").selectOption("furniture");
  await page.getByRole("button", { name: /^A\+ Reference/ }).click();
  await page.getByRole("radio", { name: "Let the AI design it" }).click();
  await page.getByRole("button", { name: "Create 2 A+ images" }).click();

  await expect(page.getByText("Finished", { exact: true }).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("list", { name: "Images in this run" }).getByRole("img")).toHaveCount(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-aplus-en.png` });

  // Opened again, the page starts fresh (the images are in History), mirrored in Arabic.
  await page.goto("/ar/aplus/bulk");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: /SOFA-12345/ })).toHaveCount(0);
  await expect(page.locator("#bulk-skus")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-aplus-ar.png` });
});
