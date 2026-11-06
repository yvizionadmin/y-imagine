"use client";

import { useTransition } from "react";
import { Building2, Loader2, LogOut, UserX, Wrench } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { useSignOut } from "./clerk";

const REASONS = ["suspended", "maintenance", "no_org", "account"] as const;
type Reason = (typeof REASONS)[number];

/** Where getWorkspace() sends people who are signed in but can't use the app right now. */
export function BlockedNotice({ maintenanceMessage }: { maintenanceMessage: string }) {
  const t = useTranslations("Auth.blocked");
  const raw = useSearchParams().get("reason");
  const reason: Reason = (REASONS as readonly string[]).includes(raw ?? "") ? (raw as Reason) : "no_org";
  const router = useRouter();
  const signOut = useSignOut();
  const [pending, startTransition] = useTransition();
  const Icon = reason === "maintenance" ? Wrench : reason === "account" ? UserX : Building2;

  return (
    <div className="flex flex-col gap-6">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-primary">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-[26px] leading-tight font-extrabold">{t(`${reason}.title`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`${reason}.body`)}</p>
        {reason === "maintenance" && maintenanceMessage && (
          <p className="rounded-lg border bg-muted px-3 py-2 text-sm">{maintenanceMessage}</p>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => router.push("/home")} className="h-10 px-4 text-[13px] font-semibold">
          {t("retry")}
        </Button>
        <Button onClick={() => startTransition(() => signOut())} disabled={pending} className="h-10 px-4 text-[13px] font-bold">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut className="rtl:-scale-x-100" aria-hidden />}
          {t("signOut")}
        </Button>
      </div>
    </div>
  );
}
