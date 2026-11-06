import { expect, test, type Page } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

async function signUp(page: Page, company: string) {
  const email = `owner-${unique()}@e2e.test`;
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Owner E2E");
  await page.locator("#auth-company").fill(company);
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);
  return email;
}

test("sign up → add a key → generate → credits used on the dashboard", async ({ page }) => {
  await signUp(page, `Acme ${unique()}`);
  await expect(page.getByText("50 credits")).toBeVisible();

  // Settings → API Keys: a demo key validates offline and routes jobs to the demo provider.
  await page.goto("/en/settings/api-keys");
  const openai = page.locator("li").filter({ has: page.getByRole("heading", { name: "OpenAI" }) });
  await openai.getByRole("button", { name: "Add key" }).click();
  await page.locator("#key-openai").fill("demo-e2e-key-123456");
  await openai.getByRole("button", { name: /Save/ }).click();
  await expect(openai.getByRole("button", { name: "Rotate key" })).toBeVisible();

  // Generate a lifestyle image.
  await page.goto("/en/generate");
  await page.locator("#sku").fill("E2E-SOFA-1");
  await page.locator('input[type="file"]').first().setInputFiles("public/demo/sofa-source.png");
  await page.getByRole("button", { name: "Generate Image" }).click();
  await expect(page.getByRole("img", { name: /AI generated/i })).toBeVisible({ timeout: 60_000 });

  // One credit used.
  await page.goto("/en/dashboard");
  await expect(page.getByText("49 credits")).toBeVisible();
});

test("wrong password is refused without saying which part was wrong", async ({ page }) => {
  const email = await signUp(page, `Beta ${unique()}`);
  await page.context().clearCookies();
  await page.goto("/en/sign-in");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("That email and password don't match.");
});

test("signed-out visitors are sent to sign-in, keeping where they were going", async ({ page }) => {
  await page.goto("/en/settings/billing");
  await expect(page).toHaveURL(/\/en\/sign-in\?next=%2Fen%2Fsettings%2Fbilling/);
});

test("org admins who aren't super admins can't open the console", async ({ page }) => {
  await signUp(page, `Gamma ${unique()}`);
  await page.goto("/en/admin");
  await expect(page).toHaveURL(/\/en\/home/);
});

test("Arabic renders right-to-left, and Billing shows the plan without Stripe", async ({ page }) => {
  await signUp(page, `Delta ${unique()}`);
  await page.goto("/ar/settings/billing");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "الفوترة" })).toBeVisible();
  await expect(page.getByText("الفوترة الإلكترونية غير متاحة بعد", { exact: false })).toBeVisible();
});
