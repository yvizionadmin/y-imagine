import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

// B6: Settings → Product Types changes what the tools offer, for this org only.
test("an admin hides a category and adds a product type; Generate offers exactly that", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Types E2E");
  await page.locator("#auth-company").fill(`Types Co ${unique()}`);
  await page.locator("#auth-email").fill(`types-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  await page.goto("/en/settings/product-types");
  await expect(page.getByRole("heading", { name: "Product Types", level: 2 })).toBeVisible();
  const cosmetics = page.getByRole("listitem").filter({ has: page.getByText("Cosmetics", { exact: true }) }).first();
  await cosmetics.getByRole("checkbox").click();
  await expect(cosmetics.getByText("Hidden")).toBeVisible();

  await page.getByRole("textbox", { name: "Add a product type to Furniture" }).fill("Rattan daybeds");
  await page.getByRole("textbox", { name: "Add a product type to Furniture" }).press("Enter");
  await expect(page.getByRole("button", { name: "Remove Rattan daybeds" })).toBeVisible();
  // Same name again, or a built-in one, is refused.
  await page.getByRole("textbox", { name: "Add a product type to Furniture" }).fill("sofas");
  await page.getByRole("textbox", { name: "Add a product type to Furniture" }).press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "That product type is already in this category." })).toBeVisible();

  await page.goto("/en/generate");
  await page.getByRole("button", { name: /^Scene Settings/ }).click();
  const category = page.locator("#category");
  await expect(category.locator("option", { hasText: "Cosmetics" })).toHaveCount(0);
  await category.selectOption("furniture");
  await page.locator("#subcategory").selectOption({ label: "Rattan daybeds" });
  // The pick is in the address, so a reload keeps it.
  await expect(page).toHaveURL(/category=furniture.*sub=custom%3A|sub=custom%3A.*category=furniture/);
  await page.reload();
  await page.getByRole("button", { name: /^Scene Settings/ }).click();
  await expect(page.locator("#subcategory").locator("option:checked")).toHaveText("Rattan daybeds");
});
