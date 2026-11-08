import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Automated WCAG A/AA checks, contrast included, in both themes. Catches only what a scanner can see: it doesn't
// replace trying the app with a keyboard and a screen reader.

const PAGES = [
  "home",
  "history",
  "qr",
  "links",
  "looks/backgrounds",
  "templates",
  "settings/team",
  "settings/api-keys",
  "settings/integrations",
  "settings/billing",
  "settings/brand",
];

for (const theme of ["light", "dark"]) {
  test(`app pages pass the accessibility scan (${theme})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript((value) => localStorage.setItem("imagine-theme", value), theme);
    const id = Math.random().toString(36).slice(2, 8);
    await page.goto("/en/sign-up");
    await page.locator("#auth-name").fill("Owner E2E");
    await page.locator("#auth-company").fill(`Axe ${id}`);
    await page.locator("#auth-email").fill(`axe-${id}@e2e.test`);
    await page.locator("#auth-password").fill("e2e-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/en\/home/);

    for (const name of [...PAGES, "privacy"]) {
      await page.goto(`/en/${name}`);
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const found = violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(" ")} ${node.any[0]?.message ?? ""}`));
      expect.soft(found, name).toEqual([]);
    }
  });
}
