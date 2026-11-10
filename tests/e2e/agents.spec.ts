import { expect, test } from "@playwright/test";

const id = () => Math.random().toString(36).slice(2, 8);

// B3 "done when": an agent finds a product, writes copy and makes an image in one run, steps shown live.
test("Agents: one run finds a product, writes its copy and makes an image; saved, and readable in Arabic", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Agent E2E");
  await page.locator("#auth-company").fill(`Agents ${id()}`);
  await page.locator("#auth-email").fill(`agents-${id()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // The catalog the agent searches.
  await page.goto("/en/settings/integrations");
  await page.getByRole("button", { name: "Add connection" }).first().click();
  await page.getByRole("button", { name: /Demo/ }).click();
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();

  await page.goto("/en/agents");
  await expect(page.getByRole("heading", { name: "Give the agent a goal" })).toBeVisible();
  await expect(page.getByText(/A run uses 1 credit, plus 1 credit for each copy/)).toBeVisible();
  await page.getByRole("button", { name: /^Find the grey sofa in our catalog/ }).click();

  // Live: the stop button while it works, each step as it happens.
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  const steps = page.getByRole("list", { name: "What the agent did" });
  await expect(steps.getByRole("listitem", { name: "Searched the catalog for “grey”" })).toBeVisible({ timeout: 15_000 });
  await expect(steps.getByRole("listitem", { name: "Wrote copy for SOFA-12345" })).toBeVisible({ timeout: 15_000 });
  await expect(steps.getByRole("listitem", { name: "Made an image of SOFA-12345" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Run agent" })).toBeVisible();
  await expect(steps.getByText(/^Done\. I found "Grey Fabric 3-Seater Sofa"/)).toBeVisible();
  await expect(steps.getByRole("list", { name: "Products found" }).getByText("SOFA-12345")).toBeVisible();

  // The image opens in the viewer.
  await steps.getByRole("button", { name: "Open the image of Grey Fabric 3-Seater Sofa" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  // Saved: the run is in the list and reopens after a reload.
  await expect(page.getByRole("complementary", { name: "Runs" }).getByText("Done ·")).toBeVisible();
  await page.reload();
  await expect(steps.getByRole("listitem", { name: "Made an image of SOFA-12345" })).toBeVisible();

  // The copy is in the Copy tool.
  await steps.getByRole("link", { name: "Open in Copy" }).click();
  await page.waitForURL(/\/en\/copy\?copy=/);
  await expect(page.getByText("SOFA-12345").first()).toBeVisible();

  // Arabic, right to left.
  await page.goto("/ar/agents");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "وكلاء الذكاء الاصطناعي" })).toBeVisible();
  await page.getByRole("complementary", { name: "التشغيلات" }).getByRole("button").filter({ hasText: "Find the grey sofa" }).click();
  await expect(page.getByRole("listitem", { name: "تم إنشاء صورة لـ SOFA-12345" })).toBeVisible();
});
