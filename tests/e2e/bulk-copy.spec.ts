import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

// No Redis in E2E: the run is processed in the web process after the response (same runner as the worker).
test("bulk copy: paste rows, run them, open a written product, download the CSV", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Bulk Writer");
  await page.locator("#auth-company").fill(`Bulk Co ${unique()}`);
  await page.locator("#auth-email").fill(`bulk-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  await page.goto("/en/copy");
  await page.getByRole("link", { name: "Bulk" }).click();
  await expect(page).toHaveURL(/\/en\/copy\/bulk/);

  await page.locator("#bulk-rows").fill('sku,name,details\nOSLO-1,Oslo Sofa,"Oak legs, linen"\nLAMP-2,Arc Lamp,Brass\n,No SKU');
  await expect(page.getByText("2 products ready")).toBeVisible();
  await expect(page.getByText("1 row skipped")).toBeVisible();
  await page.getByRole("button", { name: "Write 2 products" }).click();

  await expect(page.getByText("Finished", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("2 of 2 written").first()).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/_copy\.csv$/);

  await page.getByRole("row", { name: /OSLO-1/ }).getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/en\/copy\?copy=/);
  await expect(page.getByRole("article", { name: "English" }).locator("textarea").nth(1)).toHaveValue("Oak legs\nLinen");

  await page.goto("/en/dashboard");
  await expect(page.getByText("48 credits")).toBeVisible();
});
