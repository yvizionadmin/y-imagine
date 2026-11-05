import type { Metadata } from "next";
import { Cairo, Geist, Geist_Mono, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { ClerkProvider } from "@clerk/nextjs";
import { arSA } from "@clerk/localizations";
import { THEME_SCRIPT } from "@/components/app/theme-script";
import { clerkAppearance } from "@/features/auth/clerk-appearance";
import { ClerkSignOutProvider } from "@/features/auth/components/clerk";
import { clerkEnabled } from "@/lib/auth/constants";
import { getDirection, routing } from "@/i18n/routing";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const cairo = Cairo({ variable: "--font-cairo", subsets: ["arabic", "latin"] });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("title"), description: t("description") };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const dir = getDirection(locale);

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${cairo.variable} h-full antialiased`}
      // THEME_SCRIPT adds the "dark" class before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <DirectionProvider direction={dir}>
          <NextIntlClientProvider>
            {clerkEnabled() ? (
              <ClerkProvider
                localization={locale === "ar" ? arSA : undefined}
                appearance={clerkAppearance}
                signInUrl={`/${locale}/sign-in`}
                signUpUrl={`/${locale}/sign-up`}
              >
                <ClerkSignOutProvider>{children}</ClerkSignOutProvider>
              </ClerkProvider>
            ) : (
              children
            )}
          </NextIntlClientProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
