"use client";

import { Suspense, useTransition } from "react";
import { Building2, Languages, LogOut, Monitor, Moon, Settings, ShieldCheck, Sun } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchOrganization } from "@/features/auth/actions";
import { useSignOut } from "@/features/auth/components/clerk";
import { usePathname, useRouter } from "@/i18n/navigation";
import { setTheme, THEMES, useTheme, type Theme } from "./theme";

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } satisfies Record<Theme, unknown>;

export type UserMenuProps = {
  user: { name: string; email: string };
  isSuperAdmin: boolean;
  /** Absent in the admin console, which isn't scoped to an org. */
  org?: { id: string; name: string; all: { id: string; name: string }[] };
};

export function UserMenu({ user, isSuperAdmin, org }: UserMenuProps) {
  const t = useTranslations("Shell");
  const router = useRouter();
  const theme = useTheme();
  const signOut = useSignOut();
  const [, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("userMenu")}
        className="flex items-center gap-2 rounded-full py-1 ps-1 pe-3 hover:bg-white/10 data-popup-open:bg-white/10"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs leading-4 font-semibold uppercase">
          {user.name.charAt(0)}
        </span>
        <span className="text-sm leading-5 font-medium capitalize">{user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 font-sans">
        <DropdownMenuGroup>
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
          <span className="truncate text-[13px] font-semibold text-foreground">{user.name}</span>
          <span className="truncate text-[11px] font-normal" dir="ltr">
            {user.email}
          </span>
          {org && <span className="truncate text-[11px] font-normal">{org.name}</span>}
        </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        {org && org.all.length > 1 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Building2 aria-hidden />
              {t("switchOrg")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56 font-sans">
              <DropdownMenuRadioGroup
                value={org.id}
                onValueChange={(id) =>
                  startTransition(async () => {
                    if ((await switchOrganization(id as string)).ok) window.location.reload();
                  })
                }
              >
                {org.all.map((o) => (
                  <DropdownMenuRadioItem key={o.id} value={o.id} closeOnClick>
                    <span className="truncate">{o.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {org && (
          <DropdownMenuItem onClick={() => router.push("/settings/team")}>
            <Settings aria-hidden />
            {t("settings")}
          </DropdownMenuItem>
        )}
        {isSuperAdmin && (
          <DropdownMenuItem onClick={() => router.push(org ? "/admin" : "/home")}>
            <ShieldCheck aria-hidden />
            {org ? t("adminConsole") : t("backToApp")}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {(() => {
              const Icon = THEME_ICON[theme];
              return <Icon aria-hidden />;
            })()}
            {t("theme")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="font-sans">
            <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
              {THEMES.map((value) => (
                <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                  {t(`themes.${value}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <Suspense>
          <LanguageItem />
        </Suspense>

        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => startTransition(() => signOut())}>
          <LogOut className="rtl:-scale-x-100" aria-hidden />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageItem() {
  const t = useTranslations("Shell");
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  return (
    <DropdownMenuItem aria-label={t("languageLabel")} onClick={() => router.replace(pathname, { locale: locale === "ar" ? "en" : "ar" })}>
      <Languages aria-hidden />
      {t("language")}
    </DropdownMenuItem>
  );
}
