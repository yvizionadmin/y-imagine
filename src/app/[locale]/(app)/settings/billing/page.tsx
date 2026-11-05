import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { BillingSettings } from "@/features/billing/components/billing-settings";

export default async function BillingPage({ params }: PageProps<"/[locale]/settings/billing">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    // useSearchParams (?checkout= on return from Stripe) is request data.
    <Suspense>
      <BillingSettings />
    </Suspense>
  );
}
