import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

test("Rail AI Image: hover lists the image tools and the org's models; the item itself does not navigate", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Menu E2E");
  await page.locator("#auth-company").fill(`Menu Co ${unique()}`);
  await page.locator("#auth-email").fill(`menu-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // No image key yet: the models column points to API Keys.
  const item = page.getByRole("button", { name: "AI Image", exact: true });
  const menu = page.getByRole("dialog", { name: "AI Image" });
  // Hover again until the page has hydrated and the menu opens.
  const openMenu = () =>
    expect(async () => {
      await page.mouse.move(800, 500);
      await item.hover();
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass();
  await openMenu();
  await expect(menu.getByText("No image models yet")).toBeVisible();
  await expect(menu.getByRole("link", { name: /Recolor product/ })).toBeVisible();

  await page.goto("/en/settings/api-keys");
  const openai = page.locator("li").filter({ has: page.getByRole("heading", { name: "OpenAI" }) });
  await openai.getByRole("button", { name: "Add key" }).click();
  await page.locator("#key-openai").fill("demo-e2e-key-123456");
  await openai.getByRole("button", { name: /Save/ }).click();
  await expect(openai.getByRole("button", { name: "Rotate key" })).toBeVisible();

  await page.goto("/en/home");
  await openMenu();
  await expect(menu.getByText("In use")).toBeVisible();
  await menu.getByRole("link", { name: /Image resizer/ }).click();
  await page.waitForURL(/\/en\/resize/);

  // Clicking the item opens the menu (touch, keyboard) and stays on the page.
  await page.mouse.move(800, 500);
  await expect(menu).toBeHidden();
  await item.click();
  await expect(menu).toBeVisible();
  await expect(page).toHaveURL(/\/en\/resize/);
});
