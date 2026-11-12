import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

test("pick a category, then a product type, and Generate opens with both", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Template Picker");
  await page.locator("#auth-company").fill(`Templates Co ${unique()}`);
  await page.locator("#auth-email").fill(`templates-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  await page.goto("/en/templates");
  await page.getByRole("link", { name: "Furniture" }).click();
  await expect(page).toHaveURL(/\/en\/templates\?category=furniture/);
  await expect(page.getByRole("heading", { name: "Furniture" })).toBeVisible();
  await expect(page.getByRole("link", { name: /All Furniture/ })).toBeVisible();

  await page.getByRole("link", { name: "Sofas" }).click();
  await expect(page).toHaveURL(/\/en\/generate\?category=furniture&sub=sofas/);
  await expect(page.locator("#category")).toHaveValue("furniture");
  await expect(page.locator("#subcategory")).toHaveValue("sofas");

  // A type never outlives its category.
  await page.getByRole("button", { name: /^Scene Settings/ }).click();
  await page.locator("#category").selectOption("bathroom");
  await expect(page.locator("#subcategory")).toHaveValue("");
  await expect(page).not.toHaveURL(/sub=/);

  // Search finds product types inside every category.
  await page.goto("/en/templates");
  await page.getByRole("searchbox").fill("faucet");
  await page.getByRole("link", { name: /Faucets/ }).click();
  await expect(page).toHaveURL(/category=bathroom&sub=faucets/);
});
