"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

export type ExampleCard = { key: string; image: string; title: string; body: string };

/**
 * A tool's start screen (like Dreamina's): the heading and a few example cards; "Try it" fills the prompt bar with
 * that example. Marked as the canvas placeholder, so it collapses once the merchant starts editing.
 */
export function ExampleCards({ heading, examples, onTry }: { heading: ReactNode; examples: ExampleCard[]; onTry: (key: string) => void }) {
  const t = useTranslations("Workspace");
  return (
    <div data-empty-state="" className="flex w-full max-w-5xl flex-col items-center gap-8">
      <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">{heading}</h2>
      <ul className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
        {examples.map((example) => (
          <li key={example.key} className="flex flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
            <div className="relative h-44 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- preset scene image */}
              <img src={example.image} alt="" className="size-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-linear-to-t from-black/70 to-transparent p-4 pt-10">
                <span className="text-base font-semibold text-white">{example.title}</span>
                <button
                  type="button"
                  onClick={() => onTry(example.key)}
                  aria-label={`${t("tryIt")}: ${example.title}`}
                  className="shrink-0 rounded-full border border-white/40 bg-black/30 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-black/50"
                >
                  {t("tryIt")}
                </button>
              </div>
            </div>
            <p className="p-4 text-[13px] leading-relaxed text-muted-foreground">{example.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
