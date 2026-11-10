import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const unique = () => Math.random().toString(36).slice(2, 8);
const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");

// B10 "done when": a user cuts two clips together with subtitles and downloads the MP4.
test("Video editor: two clips, a subtitle and music, exported and downloaded as one MP4", async ({ page }) => {
  const clip = test.info().outputPath("detail.mp4");
  const music = test.info().outputPath("theme.mp3");
  mkdirSync(path.dirname(clip), { recursive: true });
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=640x360:d=3:r=25", "-f", "lavfi", "-i", "sine=f=440:d=3", "-c:v", "libx264", "-c:a", "aac", "-shortest", clip]);
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=f=220:d=2", music]);

  const company = `Editor Co ${unique()}`;
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Editor E2E");
  await page.locator("#auth-company").fill(company);
  await page.locator("#auth-email").fill(`editor-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);

  // Free plan: the editor is locked.
  await page.goto("/en/editor");
  await expect(page.getByText("The video editor is part of the paid plans")).toBeVisible();

  // Paid plans come from Stripe, which E2E doesn't call: set the plan in the test database.
  const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/imagine_e2e_test", { max: 1 });
  await sql`update organizations set plan = 'pro' where name = ${company}`;
  await sql.end();

  await page.reload();
  await page.getByRole("button", { name: "New video" }).first().click();
  const name = page.getByRole("textbox", { name: "Video name" });
  await name.fill("Launch reel");

  // Clip 1: the demo clip; clip 2: one with sound.
  await page.getByRole("button", { name: "Add clip", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Upload a clip").setInputFiles("public/demo/demo-video.webm");
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole("button", { name: "Add clip", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Upload a clip").setInputFiles(clip);
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  const clips = page.getByRole("listitem", { name: /^Clip \d:/ });
  await expect(clips).toHaveCount(2);
  await clips.first().getByRole("spinbutton", { name: "End" }).fill("3");

  await page.getByRole("button", { name: "Add subtitle at the playhead" }).click();
  await page.getByRole("textbox", { name: "Subtitle 1" }).fill("Two clips, one video");

  await page.getByLabel("Upload music or voice-over").setInputFiles(music);
  await expect(page.getByText("theme.mp3")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("radio", { name: "1:1 Square" }).click();
  await page.getByRole("button", { name: "Export MP4" }).click();
  const download = page.getByRole("link", { name: "Download MP4" });
  await expect(download).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Export" }).locator("video")).toBeVisible();

  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toBe("Launch reel.mp4");
  const saved = test.info().outputPath("export.mp4");
  await file.saveAs(saved);
  expect(statSync(saved).size).toBeGreaterThan(10_000);
  // 3 s + 3 s, square, with sound.
  const info = (() => {
    try {
      execFileSync(FFMPEG, ["-hide_banner", "-i", saved], { stdio: "pipe" });
      return "";
    } catch (error) {
      return String((error as { stderr?: Buffer }).stderr ?? "");
    }
  })();
  expect(info).toMatch(/Duration: 00:00:0(5\.[89]|6\.[01])/);
  expect(info).toContain("720x720");
  expect(info).toContain("Audio: aac");

  // Everything was saved: a reload opens the same project.
  await page.reload();
  await expect(name).toHaveValue("Launch reel");
  await expect(clips).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "Subtitle 1" })).toHaveValue("Two clips, one video");
  await expect(page.getByRole("radio", { name: "1:1 Square" })).toHaveAttribute("aria-checked", "true");

  // Arabic, right to left.
  await page.goto("/ar/editor");
  await expect(page.getByRole("heading", { name: "محرر الفيديو" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("listitem", { name: /^المقطع/ })).toHaveCount(2);
});
