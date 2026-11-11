import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";

// A super admin views a customer's org: everything shows, nothing changes, and the visit is logged.

const STAFF = "view-as-staff@e2e.test";
const PAGES = [
  "home", "generate", "generate/bulk", "recolor", "recolor/bulk", "aplus", "aplus/bulk", "copy", "copy/bulk", "chat", "looks", "looks/boards",
  "looks/history", "looks/backgrounds", "history", "links", "qr", "resize", "dashboard", "templates", "settings/team", "settings/api-keys",
  "settings/brand", "settings/billing", "settings/integrations",
];

async function signUp(browser: Browser, name: string, company: string, email: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/en/sign-up");
  await page.locator("#auth-name").fill(name);
  await page.locator("#auth-company").fill(company);
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/home/);
  return page;
}

/** One hash per table of everything stored for this org. The audit log is left out: the visit is meant to be in it. */
async function fingerprint(orgId: string) {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.columns
      where column_name = 'org_id' and table_schema = 'public' and table_name <> 'audit_log'`;
    const hashes: Record<string, string> = {};
    for (const { table_name: table } of tables) {
      const [row] = await sql.unsafe(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as hash from "${table}" t where org_id = $1`, [orgId]);
      hashes[table] = row.hash;
    }
    // No org_id here, but it holds this org's settings and flags. Its own row, then.
    const [org] = await sql`select md5(t::text) as hash from organizations t where id = ${orgId}`;
    hashes.organizations = org.hash;
    return hashes;
  } finally {
    await sql.end();
  }
}

const refused = (page: Page) => page.getByText("That wasn't saved: nothing can be changed in this view.");

test("view an org as its admin: read-only, time-limited and in the audit log", async ({ browser }) => {
  test.setTimeout(240_000);
  const id = Math.random().toString(36).slice(2, 8);
  const company = `Customer ${id}`;
  const customerEmail = `customer-${id}@e2e.test`;
  const customer = await signUp(browser, "Casey Customer", company, customerEmail);
  await customer.context().close();
  const staff = await signUp(browser, "Sam Staff", `Staff ${id}`, STAFF).catch(async () => {
    // The suite may already have made this account in another run of the same database.
    const page = await (await browser.newContext()).newPage();
    await page.goto("/en/sign-in");
    await page.locator('input[type="email"]').fill(STAFF);
    await page.locator('input[type="password"]').fill("e2e-password-123");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/en\/home/);
    return page;
  });

  await staff.goto("/en/admin/organizations");
  await staff.getByRole("link", { name: company }).click();
  await staff.waitForURL(/\/admin\/organizations\/[\w-]+$/);
  const orgId = staff.url().split("/").pop()!;
  const before = await fingerprint(orgId);
  expect(Object.keys(before).length).toBeGreaterThan(10);

  await staff.getByRole("button", { name: "View as admin" }).click();
  await staff.getByRole("dialog").getByRole("button", { name: "Continue" }).click();
  await staff.waitForURL(/\/en\/home/);
  const banner = staff.getByRole("status").filter({ hasText: `Viewing ${company} as an admin` });
  await expect(banner).toContainText("Read-only");

  // Their data is on screen, on every page, without a refusal.
  await staff.goto("/en/settings/team");
  await expect(staff.getByText(customerEmail)).toBeVisible();
  for (const name of PAGES) {
    await staff.goto(`/en/${name}`);
    await staff.waitForLoadState("networkidle");
    await expect(banner, name).toBeVisible();
    await expect(refused(staff), name).toHaveCount(0);
    await expect(staff.getByText(/Application error|Something went wrong/), name).toHaveCount(0);
  }

  // Changes are refused, and it says so.
  await staff.goto("/en/settings/brand");
  await staff.locator("#brand-name").fill("Changed by staff");
  await staff.getByRole("button", { name: "Save brand kit" }).click();
  await expect(refused(staff)).toBeVisible();

  await staff.goto("/en/settings/team");
  await staff.getByRole("button", { name: "Invite Member" }).click();
  await staff.getByRole("dialog").locator('input[type="email"]').fill(`intruder-${id}@e2e.test`);
  await staff.getByRole("dialog").locator('button[type="submit"]').click();
  await expect(refused(staff)).toBeVisible();
  await staff.keyboard.press("Escape");

  // So are API calls, which would spend the customer's provider credit.
  const chat = await staff.request.post("/api/chat", { data: { messages: [] } });
  expect(chat.status()).toBe(403);
  expect(await chat.json()).toEqual({ error: "read_only" });
  const form = await staff.request.post("/en/settings/brand", { form: { name: "no javascript" } });
  expect(form.status()).toBe(403);

  // The real test: nothing stored for this org changed.
  expect(await fingerprint(orgId)).toEqual(before);

  // Leaving goes back to the console, and the staff member's own org is theirs again.
  await staff.getByRole("button", { name: "Exit view" }).click();
  await staff.waitForURL(new RegExp(`/admin/organizations/${orgId}$`));
  await expect(staff.getByText("opened a read-only view of").first()).toBeVisible();
  await expect(staff.getByText("closed the read-only view of").first()).toBeVisible();
  await staff.goto("/en/settings/team");
  await expect(staff.getByText(customerEmail)).toHaveCount(0);
  await expect(banner).toHaveCount(0);
  await staff.context().close();
});

test("an ordinary user has no view, and a forged cookie does nothing", async ({ browser }) => {
  const id = Math.random().toString(36).slice(2, 8);
  const page = await signUp(browser, "Olive Ordinary", `Ordinary ${id}`, `ordinary-${id}@e2e.test`);
  await page.context().addCookies([{ name: "imagine_view_as", value: "someone.some-org.9999999999999.forged", url: page.url() }]);
  await page.goto("/en/settings/team");
  await expect(page.getByText("Olive Ordinary").first()).toBeVisible();
  await expect(page.getByText(/as an admin\. Read-only/)).toHaveCount(0);
  await page.goto("/en/admin/organizations");
  await page.waitForURL(/\/en\/home/);
});
