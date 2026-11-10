import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const unique = () => Math.random().toString(36).slice(2, 8);
const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");

// B11 "done when": one prompt gives a finished multi-scene video.
test("AI Director: one idea becomes a finished two-scene video with narration", async ({ page }) => {
  test.setTimeout(240_000);
  const company = `Director Co ${unique()}`;
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Director E2E");
  await page.locator("#auth-company").fill(company);
  await page.locator("#auth-email").fill(`director-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // Free plan: locked.
  await page.goto("/en/editor/director");
  await expect(page.getByText("The AI Director is part of the paid plans")).toBeVisible();
  const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/imagine_e2e_test", { max: 1 });
  await sql`update organizations set plan = 'pro' where name = ${company}`;
  await sql.end();

  // Reached from the editor.
  await page.goto("/en/editor");
  await page.getByRole("link", { name: "AI Director" }).click();
  await page.waitForURL(/\/en\/editor\/director/);
  const form = page.getByRole("form", { name: "New video" });
  await form.getByRole("textbox", { name: "Your idea" }).fill("Our new oak lounge chair for slow Sunday mornings");
  await form.getByRole("radio", { name: "2", exact: true }).click();
  await form.getByRole("radio", { name: "16:9 Wide" }).click();
  // 1 script + 2 images + 2 × 8 (4 s at 720p) + 1 voice.
  await expect(form.getByText("About 20 credits")).toBeVisible();
  await form.getByRole("button", { name: "Make the video" }).click();

  const progress = page.getByRole("list", { name: "Progress" });
  await expect(progress).toBeVisible();
  await expect(page.getByRole("list", { name: "Scenes" }).getByRole("listitem")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Finished video" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("heading", { level: 2, name: "Our new oak lounge chair for slow Sunday mornings" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Scene 1" }).getByText("Filmed")).toBeVisible();

  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download MP4" }).click()]);
  const saved = test.info().outputPath("director.mp4");
  await file.saveAs(saved);
  const info = (() => {
    try {
      execFileSync(FFMPEG, ["-hide_banner", "-i", saved], { stdio: "pipe" });
      return "";
    } catch (error) {
      return String((error as { stderr?: Buffer }).stderr ?? "");
    }
  })();
  expect(info).toContain("1280x720");
  expect(info).toContain("Audio: aac");

  // It is an editor project the team can keep working on.
  await page.getByRole("link", { name: "Open in the video editor" }).click();
  await page.waitForURL(/\/en\/editor\?project=/);
  await expect(page.getByRole("listitem", { name: /^Clip \d:/ })).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Voice-over" }).getByText(/^Voice-over:/)).toBeVisible();

  // Listed, and readable in Arabic.
  await page.goto("/ar/editor/director");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "المخرج الذكي" })).toBeVisible();
  await page.getByRole("button", { name: /Our new oak lounge chair/ }).click();
  await expect(page.getByRole("heading", { name: "الفيديو النهائي" })).toBeVisible();
});
