import { expect, test, type Page } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SCREENSHOTS;

// No Redis in E2E: the run is processed in the web process after the response (same runner as the worker).
/** Nothing is pre-picked in bulk Generate: open the scene chip (the first), choose a category and its first scene. */
async function pickScene(page: Page) {
  await page.locator('button[aria-controls$="-panel"]').first().click();
  await page.locator("#bulk-category").selectOption("furniture");
  const scene = page.locator('section[id$="-panel"]:visible [role="radiogroup"] [role="radio"]').first();
  await scene.click();
  await scene.press("Escape");
}

test("bulk generate: connect a catalog, run SKUs, see the images and find them in History", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Bulk Imager");
  await page.locator("#auth-company").fill(`Imager Co ${unique()}`);
  await page.locator("#auth-email").fill(`imager-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // Without a catalog the run is refused, with a way to connect one.
  await page.goto("/en/generate");
  await page.getByRole("link", { name: "Bulk" }).click();
  await expect(page).toHaveURL(/\/en\/generate\/bulk/);
  await page.locator("#bulk-skus").fill("SOFA-12345");
  await expect(page.getByRole("button", { name: "Generate 1 image" })).toBeDisabled();
  await pickScene(page);
  await page.getByRole("button", { name: "Generate 1 image" }).click();
  await expect(page.getByText(/no catalog is connected/)).toBeVisible();
  await page.getByRole("link", { name: "Connect a catalog" }).click();

  await page.getByRole("button", { name: "Add connection" }).first().click();
  await page.getByRole("button", { name: /Demo/ }).click();
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();

  await page.goto("/en/generate/bulk");
  // The dock's chips render once the page is interactive; typing earlier can be lost to hydration.
  await expect(page.getByRole("group", { name: "Settings" }).getByRole("button").first()).toBeVisible();
  await page.locator("#bulk-skus").fill("SOFA-12345, 220 cm wide\nCHAIR-OAK-99\nNOPE-404\nsofa-12345");
  await expect(page.getByText("3 products ready")).toBeVisible();
  await expect(page.getByText("1 line skipped")).toBeVisible();
  await pickScene(page);
  await page.getByRole("button", { name: "Generate 3 images" }).click();

  await expect(page.getByText("Finished", { exact: true }).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("2 of 3 made").first()).toBeVisible();
  const images = page.getByRole("list", { name: "Images in this run" });
  await expect(images.getByRole("img")).toHaveCount(2);
  await expect(images.getByText("SKU not found in your catalog")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-generate-en.png` });

  await page.getByRole("link", { name: "View in History" }).click();
  await expect(page).toHaveURL(/\/en\/history/);
  await expect(page.getByText("CHAIR-OAK-99").first()).toBeVisible();

  await page.goto("/en/dashboard");
  await expect(page.getByText("48 credits")).toBeVisible();

  // The page opens fresh (earlier runs are in History); a run in Arabic shows its images right-to-left.
  await page.goto("/ar/generate/bulk");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: /SOFA-12345/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "الإعدادات" }).getByRole("button").first()).toBeVisible();
  await page.locator("#bulk-skus").fill("SOFA-12345");
  await pickScene(page);
  await page.getByRole("button", { name: "إنشاء صورة واحدة" }).click();
  await expect(page.getByRole("list", { name: "صور هذه الدفعة" }).getByRole("img")).toHaveCount(1, { timeout: 45_000 });
  await expect(page.getByText("اكتملت", { exact: true }).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-generate-ar.png` });
});
