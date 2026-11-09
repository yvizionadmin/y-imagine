import { expect, test, type Page } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

async function generate(page: Page, instructions: string) {
  await page.locator("#instructions").fill(instructions);
  const button = page.getByRole("button", { name: "Generate Image" });
  await button.click();
  // Done when the next run can start (the result is then saved to History in the background).
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByRole("img", { name: /AI generated/i }).first()).toBeVisible();
}

// B5: phrases the team keeps using in saved results come back as chips, within the org.
test("Generate suggests a phrase the team used in two saved results", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Team E2E");
  await page.locator("#auth-company").fill(`Team Co ${unique()}`);
  await page.locator("#auth-email").fill(`team-${unique()}@e2e.test`);
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
  const teamChip = page.getByRole("button", { name: "Add “low camera angle” (used by your team)" });
  await page.getByRole("button", { name: /^Product Info/ }).click();
  await page.locator("#sku").fill("E2E-TEAM-1");
  await page.locator('input[type="file"]').first().setInputFiles("public/demo/sofa-source.png");
  await page.getByRole("button", { name: /^Scene Settings/ }).click();
  await page.locator("#category").selectOption("furniture");
  await page.getByRole("radio", { name: "Living Room" }).click();
  await page.keyboard.press("Escape");
  await expect(teamChip).toHaveCount(0);

  await generate(page, "low camera angle, terracotta pots");
  await generate(page, "brass floor lamp, low camera angle");

  // A new visit loads the team's phrases (the second save may still be landing, so revisit until it shows).
  await expect(async () => {
    await page.goto("/en/generate");
    await expect(teamChip).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.locator("#instructions").fill("");
  await teamChip.click();
  await expect(page.locator("#instructions")).toHaveValue("low camera angle");
  await expect(teamChip).toHaveCount(0);

  // English phrases aren't offered on the Arabic page.
  await page.goto("/ar/generate");
  await expect(page.locator("#instructions")).toBeVisible();
  await expect(page.getByRole("button", { name: /low camera angle/ })).toHaveCount(0);
});
