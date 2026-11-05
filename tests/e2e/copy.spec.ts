import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

test("write English + Arabic copy, edit it, and find it in recent copy", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Copy Writer");
  await page.locator("#auth-company").fill(`Copy Co ${unique()}`);
  await page.locator("#auth-email").fill(`copy-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/generate/);

  await page.getByRole("link", { name: "Copy" }).click();
  await expect(page).toHaveURL(/\/en\/copy/);
  await page.locator("#copy-sku").fill("SOFA-2041");
  await page.locator("#copy-name").fill("Oslo Linen Sofa");
  await page.locator("#copy-details").fill("Solid oak legs\nRemovable linen covers");
  await page.getByRole("radio", { name: "Luxury" }).click();
  await page.getByRole("button", { name: "Write Copy" }).click();

  const english = page.getByRole("article", { name: "English" });
  const arabic = page.getByRole("article", { name: "Arabic" });
  await expect(english).toBeVisible();
  await expect(arabic).toHaveAttribute("dir", "rtl");
  await expect(english.locator("textarea").nth(1)).toHaveValue("Solid oak legs\nRemovable linen covers");

  await english.locator("textarea").first().fill("Oslo Linen Sofa – Edited");
  await page.getByRole("button", { name: "Save edits" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /Oslo Linen Sofa/ }).click();
  await expect(page.getByRole("article", { name: "English" }).locator("textarea").first()).toHaveValue("Oslo Linen Sofa – Edited");

  await page.goto("/en/dashboard");
  await expect(page.getByText("49 credits")).toBeVisible();
});
