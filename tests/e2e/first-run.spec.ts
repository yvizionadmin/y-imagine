import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

// U6: what a brand-new org sees. A fresh browser: no tool guide seen yet.
test.use({ storageState: { cookies: [], origins: [] } });

test("First run: Home's setup checklist follows the org's progress; each tool explains itself once", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("First Run");
  await page.locator("#auth-company").fill(`First Co ${unique()}`);
  await page.locator("#auth-email").fill(`first-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  const setup = page.getByRole("region", { name: "Get set up" });
  await expect(setup.getByText("0 of 4 done")).toBeVisible();
  await setup.getByRole("link", { name: "Add a key" }).click();
  await page.waitForURL(/\/en\/settings\/api-keys/);
  const openai = page.locator("li").filter({ has: page.getByRole("heading", { name: "OpenAI" }) });
  await openai.getByRole("button", { name: "Add key" }).click();
  await page.locator("#key-openai").fill("demo-e2e-key-123456");
  await openai.getByRole("button", { name: /Save/ }).click();
  await expect(openai.getByRole("button", { name: "Rotate key" })).toBeVisible();
  await page.goto("/en/home");
  await expect(setup.getByText("1 of 4 done")).toBeVisible();
  await setup.getByRole("button", { name: "Write a prompt" }).click();
  await expect(page.getByLabel("Prompt")).toBeFocused();
  // Hiding it is remembered in this browser.
  await setup.getByRole("button", { name: "Hide the setup checklist" }).click();
  await expect(setup).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Create anything you imagine" })).toBeVisible();
  await expect(setup).toHaveCount(0);

  // A tool's guide shows the first time only.
  await page.goto("/en/generate");
  const guide = page.getByRole("complementary", { name: "Lifestyle images in 3 steps" });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("listitem")).toHaveCount(3);
  await guide.getByRole("button", { name: "Got it" }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Product Info/ })).toBeVisible();
  await expect(guide).toHaveCount(0);
  // Each tool has its own; Arabic too.
  await page.goto("/ar/recolor");
  await expect(page.getByRole("complementary", { name: "إعادة التلوين في 3 خطوات" })).toBeVisible();
});
