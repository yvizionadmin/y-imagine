import { expect, test, type Page } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

async function signUp(page: Page) {
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Chat User");
  await page.locator("#auth-company").fill(`Chat Co ${unique()}`);
  await page.locator("#auth-email").fill(`chat-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);
}

test("chat with the assistant, reload and find the history, failed replies give the text back", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/en\/chat/);
  await expect(page.getByRole("heading", { name: "How can I help today?" })).toBeVisible();
  await expect(page.getByText("Each reply uses 1 credit")).toBeVisible();

  const box = page.getByRole("textbox", { name: /Ask about product copy/ });
  await box.fill("Ideas for a summer sale on sofas");
  await box.press("Enter");

  const messages = page.getByTestId("chat-messages");
  await expect(messages.locator('[data-role="user"]')).toHaveText("Ideas for a summer sale on sofas");
  await expect(messages.locator('[data-role="assistant"]')).toContainText("I can help with product descriptions");
  await expect(page).toHaveURL(/thread=/);
  const thread = page.getByRole("complementary", { name: "Chats" }).getByRole("button", { name: /^Ideas for a summer sale/ });
  await expect(thread).toBeVisible();

  // History survives a reload (the thread id is in the URL).
  await page.reload();
  await expect(page.getByTestId("chat-messages").locator('[data-role="assistant"]')).toContainText("demo reply");
  await expect(page.getByRole("heading", { name: "Ideas for a summer sale on sofas" })).toBeVisible();

  // A failed reply removes the exchange and puts the text back in the box.
  await page.getByRole("button", { name: "New chat" }).first().click();
  await box.fill("This will FAIL");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The reply failed" })).toBeVisible();
  await expect(box).toHaveValue("This will FAIL");
  await expect(page.getByRole("complementary", { name: "Chats" }).getByRole("listitem")).toHaveCount(1);

  // Credits: one reply charged.
  await page.goto("/en/dashboard");
  await expect(page.getByText("49 credits")).toBeVisible();
});

test("Arabic chat is right-to-left and the reply follows the language", async ({ page }) => {
  await signUp(page);
  await page.goto("/ar/chat");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "كيف يمكنني مساعدتك اليوم؟" })).toBeVisible();
  await page.getByRole("button", { name: "اكتب وصفًا لكنبة كتان بثلاثة مقاعد وأرجل من خشب البلوط" }).click();
  const reply = page.getByTestId("chat-messages").locator('[data-role="assistant"]');
  await expect(reply).toContainText("هذا رد تجريبي");
  await expect(reply).toHaveAttribute("dir", "auto");
  await expect(page.getByRole("complementary", { name: "المحادثات" }).getByRole("button", { name: /^اكتب وصفًا لكنبة/ })).toBeVisible();
});
