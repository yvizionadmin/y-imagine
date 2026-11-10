import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

// B6: an uploaded scene saved for the team shows up as a team scene for that product type.
test("Generate: save an uploaded scene for the team, pick it after a reload and generate with it", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Scenes E2E");
  await page.locator("#auth-company").fill(`Scenes Co ${unique()}`);
  await page.locator("#auth-email").fill(`scenes-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  await page.goto("/en/settings/api-keys");
  const openai = page.locator("li").filter({ has: page.getByRole("heading", { name: "OpenAI" }) });
  await openai.getByRole("button", { name: "Add key" }).click();
  await page.locator("#key-openai").fill("demo-e2e-key-123456");
  await openai.getByRole("button", { name: /Save/ }).click();
  await expect(openai.getByRole("button", { name: "Rotate key" })).toBeVisible();

  await page.goto("/en/generate");
  await page.getByRole("button", { name: /^Scene Settings/ }).click();
  await page.locator("#category").selectOption("furniture");
  await page.getByRole("button", { name: /^Browse all/ }).click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles("public/scenes/luxury-loft.png");
  await page.getByRole("button", { name: "Save for the team" }).click();
  await page.getByRole("textbox", { name: "Scene name" }).fill("Our loft showroom");
  await page.getByRole("combobox", { name: "Room type" }).selectOption("livingRoom");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Saved: it is now the selected team scene.
  await expect(page.getByRole("radio", { name: "Team scene: Our loft showroom" })).toHaveAttribute("aria-checked", "true");

  // Another visit lists it for furniture, not for another product type.
  await page.goto("/en/generate");
  await page.getByRole("button", { name: /^Scene Settings/ }).click();
  await page.locator("#category").selectOption("kitchenAppliances");
  await expect(page.getByRole("radio", { name: /^Team scene:/ })).toHaveCount(0);
  await page.locator("#category").selectOption("furniture");
  await page.getByRole("radio", { name: "Team scene: Our loft showroom" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Scene Settings: Our loft showroom/ })).toBeVisible();

  await page.getByRole("button", { name: /^Product Info/ }).click();
  await page.locator("#sku").fill("E2E-SCENE-1");
  await page.locator('input[type="file"]').first().setInputFiles("public/demo/sofa-source.png");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Generate Image" }).click();
  await expect(page.getByRole("img", { name: /AI generated/i }).first()).toBeVisible({ timeout: 60_000 });

  // The admin finds it in Room Backgrounds.
  await page.goto("/en/looks/backgrounds");
  await expect(page.getByText("Our loft showroom").first()).toBeVisible();
});
