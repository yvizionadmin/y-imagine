import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const unique = () => Math.random().toString(36).slice(2, 8);
const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");

// B12 "done when": audio can be generated and added to an editor project.
test("Editor sound: generate a voice-over and music, use them as tracks and export with them", async ({ page }) => {
  const company = `Sound Co ${unique()}`;
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Sound E2E");
  await page.locator("#auth-company").fill(company);
  await page.locator("#auth-email").fill(`sound-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);
  const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/imagine_e2e_test", { max: 1 });
  await sql`update organizations set plan = 'pro' where name = ${company}`;
  await sql.end();

  await page.goto("/en/editor");
  await page.getByRole("button", { name: "New video" }).first().click();
  await page.getByRole("button", { name: "Add clip", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Upload a clip").setInputFiles("public/demo/demo-video.webm");
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });

  // Voice-over: script, voice, cost shown, made and placed as the voice track.
  const voice = page.getByRole("region", { name: "Voice-over" });
  await voice.getByRole("button", { name: "Generate voice-over" }).click();
  const voiceForm = voice.getByRole("form", { name: "Generate voice-over" });
  await expect(voiceForm.getByText("1 credit")).toBeVisible();
  await voiceForm.getByRole("textbox", { name: "Voice-over script" }).fill("Meet the sofa. Soft and made to last.");
  await voiceForm.getByRole("radio", { name: "Deep" }).click();
  await voiceForm.getByRole("button", { name: "Generate" }).click();
  await expect(voice.getByText("Voice-over: Meet the sofa. Soft and made to last.")).toBeVisible({ timeout: 15_000 });
  await expect(voice.getByRole("slider", { name: /Voice volume/ })).toBeVisible();
  await expect(voice.getByRole("spinbutton", { name: "Starts at (s)" })).toHaveValue("0");

  // Music: a description, 2 credits, placed as the music track.
  const music = page.getByRole("region", { name: "Music", exact: true });
  await music.getByRole("button", { name: "Generate music" }).click();
  await expect(music.getByText("2 credits")).toBeVisible();
  await music.getByRole("textbox", { name: "Describe the music" }).fill("Calm acoustic guitar");
  await music.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(music.getByText("Music: Calm acoustic guitar")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Export MP4" }).click();
  const download = page.getByRole("link", { name: "Download MP4" });
  await expect(download).toBeVisible({ timeout: 60_000 });
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  const saved = test.info().outputPath("with-sound.mp4");
  await file.saveAs(saved);
  const info = (() => {
    try {
      execFileSync(FFMPEG, ["-hide_banner", "-i", saved], { stdio: "pipe" });
      return "";
    } catch (error) {
      return String((error as { stderr?: Buffer }).stderr ?? "");
    }
  })();
  expect(info).toContain("Audio: aac");

  // Saved with the project; Arabic labels.
  await page.goto(page.url().replace("/en/", "/ar/"));
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("region", { name: "التعليق الصوتي" }).getByText("تعليق صوتي: Meet the sofa. Soft and made to last.")).toBeVisible();
  await expect(page.getByRole("region", { name: "الموسيقى", exact: true }).getByText("موسيقى: Calm acoustic guitar")).toBeVisible();
});
