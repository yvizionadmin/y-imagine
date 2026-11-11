import { expect, test } from "@playwright/test";
import postgres from "postgres";

const unique = () => Math.random().toString(36).slice(2, 8);

// B13 "done when": the same character appears across AI Director scenes.
test("Characters: save one from photos with consent, then star her in an AI Director video", async ({ page }) => {
  test.setTimeout(240_000);
  const company = `Cast Co ${unique()}`;
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Cast E2E");
  await page.locator("#auth-company").fill(company);
  await page.locator("#auth-email").fill(`cast-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);
  const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/imagine_e2e_test", { max: 1 });
  await sql`update organizations set plan = 'pro' where name = ${company}`;
  await sql.end();

  // From the Director to the character library.
  await page.goto("/en/editor/director");
  await page.getByRole("link", { name: "Manage characters" }).click();
  await page.waitForURL(/\/en\/editor\/characters/);
  const photos = page.getByRole("form", { name: "From photos" });
  await photos.getByRole("textbox", { name: "Name" }).fill("Layla");
  await photos.getByRole("textbox", { name: "How they look (optional)" }).fill("woman in her 30s, short black hair, mustard sweater");
  await photos.getByLabel("Choose up to 3 photos").setInputFiles(["public/demo/sofa-source.png", "public/demo/source-chair.png"]);
  await expect(photos.getByText("2 photos chosen")).toBeVisible();
  // Saving needs the rights and consent confirmation.
  await expect(photos.getByRole("button", { name: "Save character" })).toBeDisabled();
  await photos.getByRole("checkbox").check();
  await photos.getByRole("button", { name: "Save character" }).click();
  const card = page.getByRole("listitem", { name: "Layla" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(/rights and consent confirmed/)).toBeVisible();
  await expect(card.getByRole("img")).toHaveCount(2);

  // A two-scene video starring her.
  await page.getByRole("link", { name: "AI Director" }).click();
  await page.waitForURL(/\/en\/editor\/director/);
  const form = page.getByRole("form", { name: "New video" });
  await form.getByRole("textbox", { name: "Your idea" }).fill("A slow Sunday morning with our oak lounge chair");
  await form.getByRole("radiogroup", { name: "Character" }).getByRole("radio", { name: "Layla" }).click();
  await form.getByRole("radio", { name: "2", exact: true }).click();
  await form.getByRole("button", { name: "Make the video" }).click();
  await expect(page.getByText("Starring Layla")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finished video" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("list", { name: "Scenes" }).getByRole("listitem")).toHaveCount(2);

  // Arabic, right to left.
  await page.goto("/ar/editor/characters");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "الشخصيات" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Layla" }).getByText(/تم تأكيد الحقوق والموافقة/)).toBeVisible();

  // Deleting asks in the app's own dialog (U5): Cancel keeps her, Delete removes her.
  await page.goto("/en/editor/characters");
  const layla = page.getByRole("listitem", { name: "Layla" });
  await layla.getByRole("button", { name: /^Delete/ }).click();
  const ask = page.getByRole("dialog", { name: /Layla/ });
  await expect(ask.getByRole("button", { name: "Cancel" })).toBeFocused();
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toBeHidden();
  await expect(layla).toBeVisible();
  await layla.getByRole("button", { name: /^Delete/ }).click();
  await page.getByRole("dialog", { name: /Layla/ }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(layla).toHaveCount(0);
});
