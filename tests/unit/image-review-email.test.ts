import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { IntlMessageFormat } from "intl-messageformat";

// The image review emails use ICU plurals with a nested label: both languages must render them.

const render = (locale: "en" | "ar", message: string, count: number) =>
  new IntlMessageFormat(message, locale).format({ actor: "Sara", label: "SOFA-1", count, org: "Acme" }) as string;

function emailMessages(messages: Record<string, unknown>) {
  const ns = Object.values(messages).find((v) => v && typeof v === "object" && "imageSubmitted" in v) as Record<string, Record<string, string>>;
  return [ns.imageSubmitted.subject, ns.imageSubmitted.body, ns.imageApproved.subject, ns.imageApproved.body, ns.imageChanges.subject, ns.imageChanges.body];
}

describe("image review emails", () => {
  for (const [locale, messages] of [["en", en], ["ar", ar]] as const) {
    it(`renders every plural in ${locale}`, () => {
      for (const message of emailMessages(messages)) {
        for (const count of [1, 2, 3, 11, 100]) {
          const text = render(locale, message, count);
          expect(text.length).toBeGreaterThan(0);
          expect(text).not.toContain("{");
        }
      }
    });
  }

  it("names the image when there is one, and counts when there are several", () => {
    const body = (en as unknown as { Email: { imageApproved: { body: string } } }).Email?.imageApproved.body ?? emailMessages(en)[3];
    expect(render("en", body, 1)).toContain("SOFA-1");
    expect(render("en", body, 3)).toContain("3 of your images");
  });
});
