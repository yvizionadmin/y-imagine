import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SCREENSHOTS;

test("set up a brand kit and write copy in the brand voice", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Brand Admin");
  await page.locator("#auth-company").fill(`Brand Co ${unique()}`);
  await page.locator("#auth-email").fill(`brand-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // No kit yet: the Copy panel points to the settings page.
  await page.goto("/en/copy");
  await page.getByRole("link", { name: "Add a brand kit" }).click();
  await expect(page).toHaveURL(/\/en\/settings\/brand/);
  await expect(page.getByText("No brand kit yet.")).toBeVisible();

  await page.locator("#brand-name").fill("Northwind Home");
  await page.locator("#brand-voice").fill("warm, confident and practical");
  await page.locator("#brand-avoid").fill("cheap, best ever");
  await page.getByRole("button", { name: "Save brand kit" }).click();
  await expect(page.getByText("Brand kit saved")).toBeVisible();
  await expect(page.getByText("Brand Admin updated the brand kit")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-en.png`, fullPage: true });

  await page.reload();
  await expect(page.locator("#brand-avoid")).toHaveValue("cheap, best ever");

  await page.goto("/en/copy");
  const toggle = page.getByRole("checkbox", { name: /Use brand kit/ });
  await expect(toggle).toBeChecked();
  await expect(page.getByText("Write in the Northwind Home brand voice")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/copy-en.png` });
  await page.locator("#copy-sku").fill("SOFA-2041");
  await page.locator("#copy-name").fill("Oslo Linen Sofa");
  await page.locator("#copy-details").fill("Solid oak legs\nNot cheap looking");
  await page.getByRole("button", { name: "Write Copy" }).click();

  const english = page.getByRole("article", { name: "English" });
  await expect(english).toBeVisible();
  await expect(english.locator("textarea").nth(1)).not.toHaveValue(/cheap/i);
  await expect(english.locator("input").first()).toHaveValue("Oslo Linen Sofa | Northwind Home");

  // Arabic: same page mirrored.
  await page.goto("/ar/settings/brand");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#brand-name")).toHaveValue("Northwind Home");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-ar.png`, fullPage: true });
  await page.goto("/ar/copy");
  await expect(page.getByRole("checkbox", { name: /استخدام هوية العلامة/ })).toBeChecked();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/copy-ar.png` });
});
