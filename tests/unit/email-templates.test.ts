import { afterEach, describe, expect, it, vi } from "vitest";
import { emailTransport } from "@/lib/email/send";
import { emailTranslator, renderEmail } from "@/lib/email/templates";

describe("email templates", () => {
  it("escapes every value and lays Arabic out right-to-left", () => {
    const mail = renderEmail({
      locale: "ar",
      to: "a@b.c",
      subject: "<b>hi</b>",
      heading: "مرحبا",
      lines: ['Tom & "Jerry" <script>'],
      quote: "<img src=x>",
      button: { label: "Go", url: "https://app.test/x?a=1&b=2" },
    });
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain("Tom &amp; &quot;Jerry&quot; &lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain('href="https://app.test/x?a=1&amp;b=2"');
    expect(mail.text).toContain("Go: https://app.test/x?a=1&b=2");
  });

  it("has every email in both languages", () => {
    for (const locale of ["en", "ar"] as const) {
      const t = emailTranslator(locale);
      expect(t("invite.subject", { inviter: "A", org: "B", role: "C" })).toContain("B");
      expect(t("copySubmitted.subject", { actor: "A", count: 2, label: "L", org: "O" })).toBeTruthy();
      expect(t("reset.button")).toBeTruthy();
    }
  });
});

describe("email transport", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("comes from the environment", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(emailTransport()).toBe("resend");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_URL", "smtps://u:p@smtp.example.com:465");
    expect(emailTransport()).toBe("smtp");
    vi.stubEnv("SMTP_URL", "");
    expect(emailTransport()).toBe("outbox");
    vi.stubEnv("NODE_ENV", "production");
    expect(emailTransport()).toBe("outbox"); // EMAIL_OUTBOX_DIR is set for tests
    vi.stubEnv("EMAIL_OUTBOX_DIR", "");
    expect(emailTransport()).toBeNull();
  });
});
