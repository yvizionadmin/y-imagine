import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

// U1: the top bar's search (⌘K) and the Upgrade link next to the credits.
test("Top bar: ⌘K search jumps to a tool; an admin on Free sees Upgrade", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Search E2E");
  await page.locator("#auth-company").fill(`Search Co ${unique()}`);
  await page.locator("#auth-email").fill(`search-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // The credits stay as they were; the org's admin on Free gets the way to upgrade.
  await expect(page.getByText("50 credits")).toBeVisible();
  await page.getByRole("link", { name: "Upgrade" }).click();
  await page.waitForURL(/\/en\/settings\/billing/);

  // Keyboard: ⌘K (Ctrl+K elsewhere), type, arrow down, Enter.
  const dialog = page.getByRole("dialog", { name: "Go to a tool or page" });
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  const input = dialog.getByRole("combobox");
  await input.fill("recolor");
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await expect(dialog.getByRole("option", { name: /Recolor product/ })).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowDown");
  await expect(dialog.getByRole("option", { name: /Bulk recolor/ })).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");
  await page.waitForURL(/\/en\/recolor\/bulk/);
  await expect(dialog).toBeHidden();

  // Mouse: the search button, a word from the description, a click.
  await page.getByRole("button", { name: "Search tools and pages" }).click();
  await dialog.getByRole("combobox").fill("subtitles");
  await dialog.getByRole("option", { name: /Video editor/ }).click();
  await page.waitForURL(/\/en\/editor$/);

  await page.keyboard.press("ControlOrMeta+k");
  await dialog.getByRole("combobox").fill("zzzz");
  await expect(dialog.getByText("Nothing matches. Try another word.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Arabic: same search, Arabic names.
  await page.goto("/ar/home");
  await page.getByRole("button", { name: "ابحث في الأدوات والصفحات" }).click();
  const arDialog = page.getByRole("dialog", { name: "انتقل إلى أداة أو صفحة" });
  await arDialog.getByRole("combobox").fill("الفوترة");
  await arDialog.getByRole("option", { name: /الفوترة والخطة/ }).click();
  await page.waitForURL(/\/ar\/settings\/billing/);
});
