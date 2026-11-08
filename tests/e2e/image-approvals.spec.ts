import { expect, test } from "@playwright/test";

// Image approvals in History, with the "only upload approved images" rule on (roadmap B4).

const id = () => Math.random().toString(36).slice(2, 8);

test("an image with approvals on: blocked, reviewed, approved, then uploaded, and readable in Arabic", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Owner E2E");
  await page.locator("#auth-company").fill(`Approvals ${id()}`);
  await page.locator("#auth-email").fill(`approvals-${id()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // A store to upload to, and the rule turned on.
  await page.goto("/en/settings/integrations");
  await page.getByRole("button", { name: "Add connection" }).first().click();
  await page.getByRole("button", { name: /Demo/ }).click();
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
  const rule = page.getByRole("checkbox", { name: /Only upload approved images/ });
  await expect(rule).not.toBeChecked();
  await rule.click();
  await expect(rule).toBeChecked();

  // An image with a SKU.
  await page.goto("/en/settings/api-keys");
  const openai = page.locator("li").filter({ has: page.getByRole("heading", { name: "OpenAI" }) });
  await openai.getByRole("button", { name: "Add key" }).click();
  await page.locator("#key-openai").fill("demo-e2e-key-123456");
  await openai.getByRole("button", { name: /Save/ }).click();
  await expect(openai.getByRole("button", { name: "Rotate key" })).toBeVisible();
  await page.goto("/en/generate");
  await page.getByRole("button", { name: /^Product Info/ }).click();
  await page.locator("#sku").fill("SOFA-12345");
  await page.locator('input[type="file"]').first().setInputFiles("public/demo/sofa-source.png");
  await page.getByRole("button", { name: /^Scene Settings/ }).click();
  await page.locator("#category").selectOption("furniture");
  await page.getByRole("radio", { name: "Living Room" }).click();
  await page.getByRole("button", { name: "Generate Image" }).click();
  await expect(page.getByRole("img", { name: /AI generated/i })).toBeVisible({ timeout: 60_000 });

  // In History it can't be uploaded yet.
  await page.goto("/en/history");
  await expect(page.getByText("1 image needs approval before it can be uploaded.")).toBeVisible();
  const card = page.locator("article").filter({ hasText: "SOFA-12345" });
  await expect(card.getByText("Draft")).toBeVisible();
  await expect(card.getByRole("button", { name: "Upload to Website" })).toHaveCount(0);

  // Ask for changes, with a note, then approve.
  await card.locator("button").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Needs approval before upload")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Upload to Website" })).toHaveCount(0);
  const approval = drawer.getByRole("region", { name: "Approval" });
  await approval.getByRole("button", { name: "Submit for review" }).click();
  await expect(approval.getByText("In review")).toBeVisible();
  await approval.getByRole("button", { name: "Request changes" }).click();
  await approval.getByLabel("What should change?").fill("Brighter room, please");
  await approval.getByRole("button", { name: "Send note" }).click();
  await expect(approval.getByText("Brighter room, please")).toBeVisible();
  await expect(drawer.getByText("Needs approval before upload")).toBeVisible();

  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(approval.getByText(/Approved by/)).toBeVisible();
  await drawer.getByRole("button", { name: "Upload to Website" }).click();
  await expect(drawer.getByText("Uploaded")).toBeVisible();

  // Arabic: the same drawer, right to left.
  await page.goto("/ar/history");
  await page.locator("article").filter({ hasText: "SOFA-12345" }).locator("button").first().click();
  await expect(page.getByRole("dialog").getByRole("region", { name: "الاعتماد" }).getByText(/اعتمدها/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
});
