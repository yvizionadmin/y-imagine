import { BarChart3, Boxes, Clapperboard, ImageIcon, MessageSquare, PenLine, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { CtaBand } from "./marketing-shell";

const GROUPS = [
  { key: "images", icon: ImageIcon, points: ["lifestyle", "recolor", "aplus", "looks", "resize"] },
  { key: "video", icon: Clapperboard, points: ["prompt", "frame", "models", "consent"] },
  { key: "copy", icon: PenLine, points: ["languages", "brand", "review"] },
  { key: "chat", icon: MessageSquare, points: ["stream", "history", "brand"] },
  { key: "bulk", icon: Boxes, points: ["catalog", "bulk", "history"] },
  { key: "team", icon: Users, points: ["roles", "keys", "seats"] },
  { key: "insight", icon: BarChart3, points: ["analytics", "credits", "links"] },
] as const;

export function FeaturesPage() {
  const t = useTranslations("Marketing.features");
  return (
    <>
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pt-14 pb-16 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">{t("subtitle")}</p>
        </div>
        <ul className="grid gap-4 md:grid-cols-2">
          {GROUPS.map(({ key, icon: Icon, points }) => (
            <li key={key} className="flex flex-col gap-3 rounded-2xl border bg-background p-6">
              <span className="flex items-center gap-2.5">
                <Icon className="size-5 text-primary" aria-hidden />
                <h2 className="text-base font-semibold">{t(`groups.${key}.title`)}</h2>
              </span>
              <ul className="flex list-disc flex-col gap-1.5 ps-4 text-[13px] leading-relaxed text-muted-foreground">
                {points.map((point) => (
                  <li key={point}>{t(`groups.${key}.${point}`)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      <CtaBand />
    </>
  );
}
