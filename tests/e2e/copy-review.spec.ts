import { expect, test } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SCREENSHOTS;

test("submit copy for review, request changes, resubmit and approve", async ({ page }) => {
  // The person who signs up is the org's admin, so they can both submit and approve.
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill("Review Admin");
  await page.locator("#auth-company").fill(`Review Co ${unique()}`);
  await page.locator("#auth-email").fill(`review-${unique()}@e2e.test`);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/generate/);

  await page.goto("/en/copy");
  await page.locator("#copy-sku").fill("SOFA-2041");
  await page.locator("#copy-name").fill("Oslo Linen Sofa");
  await page.getByRole("button", { name: "Write Copy" }).click();

  const review = page.getByRole("region", { name: "Approval" });
  await expect(review.getByText("Draft", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Submit for review" }).click();
  await expect(review.getByText("In review", { exact: true })).toBeVisible();

  await review.getByRole("button", { name: "Request changes" }).click();
  await review.getByLabel("What should change?").fill("Shorten the title");
  await review.getByRole("button", { name: "Send to the writer" }).click();
  await expect(review.getByText("Changes requested", { exact: true })).toBeVisible();
  await expect(review.getByText("Shorten the title")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/review-changes-en.png` });

  // Edits must be saved before the copy can go back for review.
  await page.getByRole("article", { name: "English" }).locator("textarea").first().fill("Oslo Sofa");
  await expect(review.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  await page.getByRole("button", { name: "Save edits" }).click();
  await review.getByRole("button", { name: "Submit for review" }).click();

  // The "In review" filter is the admin's queue.
  await page.getByRole("radio", { name: "In review" }).click();
  await expect(page.getByRole("button", { name: /Oslo Linen Sofa/ })).toBeVisible();

  await review.getByRole("button", { name: "Approve" }).click();
  await expect(review.getByText(/Approved by Review Admin/)).toBeVisible();
  await expect(page.getByText("Nothing is waiting for review.")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/review-approved-en.png` });

  await page.goto("/ar/copy");
  await page.getByRole("button", { name: /Oslo Linen Sofa/ }).click();
  await expect(page.getByRole("region", { name: "الاعتماد" }).getByText("معتمد", { exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/review-approved-ar.png` });
});
