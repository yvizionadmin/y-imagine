import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Local-login password reset end to end: the email lands in the e2e outbox (EMAIL_OUTBOX_DIR in
// playwright.config.ts), its link sets a new password, and the new password signs in.

const OUTBOX = path.resolve(".data/e2e-outbox");
const unique = () => Math.random().toString(36).slice(2, 8);

async function resetLinkFor(email: string) {
  for (let i = 0; i < 20; i++) {
    for (const file of (await readdir(OUTBOX).catch(() => [])).sort().reverse()) {
      const mail = JSON.parse(await readFile(path.join(OUTBOX, file), "utf8")) as { to: string; text: string };
      const link = mail.to === email && /(http\S+reset-password\?token=[\w-]+)/.exec(mail.text)?.[1];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no reset email");
}

test("forgot password → email link → new password → sign in", async ({ page }) => {
  const email = `reset-${unique()}@e2e.test`;
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Reset E2E");
  await page.locator("#auth-company").fill(`Reset Co ${unique()}`);
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("old-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);
  await page.context().clearCookies();

  await page.goto("/en/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/en\/forgot-password/);
  await page.locator("#reset-email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(email);

  await page.goto(await resetLinkFor(email));
  await page.locator("#reset-password").fill("new-password-456");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("status")).toHaveText("Password changed. Sign in with your new password.");

  await page.goto("/en/sign-in");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("new-password-456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/home/);
});

test("an unknown or used reset link says so in Arabic too", async ({ page }) => {
  await page.goto("/ar/reset-password?token=not-a-real-token-1234567890");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("alert").filter({ hasText: "الرابط" })).toHaveText("هذا الرابط غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا.");
});
