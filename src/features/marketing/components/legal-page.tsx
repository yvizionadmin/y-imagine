import { useFormatter, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { LATN } from "@/lib/format";
import { legalDoc, type LegalKind } from "../legal-content";
import { LEGAL_DETAILS } from "../legal-details";

export function LegalPage({ kind, locale }: { kind: LegalKind; locale: Locale }) {
  const t = useTranslations("Marketing.legal");
  const format = useFormatter();
  const doc = legalDoc(locale, kind);
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-14 sm:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="text-xs text-muted-foreground">
          {t("updated", { date: format.dateTime(new Date(`${LEGAL_DETAILS.lastUpdated}T12:00:00Z`), { ...LATN, dateStyle: "long" }) })}
        </p>
        {!LEGAL_DETAILS.reviewed && (
          <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            {t("draft")}
          </p>
        )}
        <p className="text-sm leading-relaxed">{doc.intro}</p>
      </header>
      {doc.sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{section.title}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-sm leading-relaxed text-muted-foreground">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
