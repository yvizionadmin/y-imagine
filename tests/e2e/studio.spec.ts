import { expect, test } from "@playwright/test";
import postgres from "postgres";

const unique = () => Math.random().toString(36).slice(2, 8);

test("Studio home: sign-in lands on the prompt, Image makes a picture, Video is paid-only", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Studio E2E");
  await page.locator("#auth-company").fill(`Studio Co ${unique()}`);
  await page.locator("#auth-email").fill(`studio-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);
  await expect(page.getByRole("heading", { name: "Create anything you imagine" })).toBeVisible();
  // Shortcuts to the other tools sit under the prompt.
  await expect(page.getByRole("navigation", { name: "Other tools" }).getByRole("link", { name: "Recolor" })).toBeVisible();

  // A demo key routes jobs to the offline demo provider.
  await page.goto("/en/settings/api-keys");
  const openai = page.locator("li").filter({ has: page.getByRole("heading", { name: "OpenAI" }) });
  await openai.getByRole("button", { name: "Add key" }).click();
  await page.locator("#key-openai").fill("demo-e2e-key-123456");
  await openai.getByRole("button", { name: /Save/ }).click();
  await expect(openai.getByRole("button", { name: "Rotate key" })).toBeVisible();

  await page.goto("/en/home");
  const modes = page.getByRole("radiogroup", { name: "What to create" });
  await expect(modes.getByRole("radio", { name: "Image" })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Prompt").fill("A ceramic vase on a linen table, morning light");
  // Options open from chips in the prompt bar.
  await page.getByRole("button", { name: /^Aspect ratio: 1:1/ }).click();
  await page.getByRole("radiogroup", { name: "Aspect ratio" }).getByRole("radio", { name: "16:9" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Aspect ratio: 16:9 · HD" })).toBeVisible();
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByRole("img", { name: "A ceramic vase on a linen table, morning light" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("49 credits")).toBeVisible();

  // Video: kept in the URL; the Free plan sees the upgrade prompt and can't generate.
  await modes.getByRole("radio", { name: /Video/ }).click();
  await expect(page).toHaveURL(/\/en\/home\?mode=video/);
  await expect(page.getByText("Video is on paid plans")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate" })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "What to create" }).getByRole("radio", { name: /Video/ })).toHaveAttribute("aria-checked", "true");

  // Arabic: same page, right-to-left.
  await page.goto("/ar/home?mode=video");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "أنشئ كل ما تتخيله" })).toBeVisible();
  await expect(page.getByText("الفيديو متاح في الخطط المدفوعة")).toBeVisible();
});

test("Studio video on a paid plan: queue, progress, then playback", async ({ page }) => {
  const company = `Video Co ${unique()}`;
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Video E2E");
  await page.locator("#auth-company").fill(company);
  await page.locator("#auth-email").fill(`video-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // Paid plans come from Stripe, which E2E doesn't call: set the plan in the test database.
  const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/imagine_e2e_test", { max: 1 });
  await sql`update organizations set plan = 'pro' where name = ${company}`;
  await sql.end();

  await page.goto("/en/home?mode=video");
  await expect(page.getByText("Video is on paid plans")).toHaveCount(0);
  // Options come from the model's capabilities: no square video.
  await page.getByRole("button", { name: /^Aspect ratio:/ }).click();
  await expect(page.getByRole("radiogroup", { name: "Aspect ratio" }).getByRole("radio")).toHaveText(["16:9", "9:16"]);
  await page.keyboard.press("Escape");
  await page.getByLabel("Prompt").fill("Slow push-in on a steaming cup of coffee, morning light");
  await page.getByRole("button", { name: /^Duration:/ }).click();
  await page.getByRole("radiogroup", { name: "Duration" }).getByRole("radio", { name: "4s" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText("Your video is being made.")).toBeVisible();
  await expect(page.locator("video")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/^9:16 · 4s$/)).toBeVisible();
});
