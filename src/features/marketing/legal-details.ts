import type { Locale } from "@/i18n/routing";

// Business details for the legal pages and the Contact link. Fill these in, have a lawyer review
// src/features/marketing/legal-content.ts, then set `reviewed: true`: that removes the draft notice
// and lets search engines index the legal pages. Must be done before launch (roadmap A9).

export const LEGAL_DETAILS = {
  reviewed: false,
  /** Shown on the Enterprise plan and the footer once set; until then those lead to sign-up. */
  contactEmail: null as string | null,
  lastUpdated: "2026-11-08",
};

const PLACEHOLDERS: Record<Locale, { company: string; address: string; email: string; law: string; refunds: string; liabilityCap: string; retention: string }> = {
  en: {
    company: "[Company legal name]",
    address: "[Registered address]",
    email: "[Contact email]",
    law: "[Governing law and courts]",
    refunds: "[Refund policy to confirm]",
    liabilityCap: "[Liability cap to confirm]",
    retention: "[Period to confirm]",
  },
  ar: {
    company: "[الاسم القانوني للشركة]",
    address: "[العنوان المسجّل]",
    email: "[البريد الإلكتروني للتواصل]",
    law: "[القانون الحاكم والمحاكم المختصة]",
    refunds: "[سياسة الاسترداد قيد التأكيد]",
    liabilityCap: "[حد المسؤولية قيد التأكيد]",
    retention: "[المدة قيد التأكيد]",
  },
};

export const legalPlaceholders = (locale: Locale) => PLACEHOLDERS[locale];
