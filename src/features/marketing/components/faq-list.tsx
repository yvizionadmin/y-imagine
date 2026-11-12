"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "cn";

/**
 * Pricing questions. Every answer stays in the HTML (closed ones are collapsed, not removed), so search engines
 * and the FAQ structured data see the same text.
 */
export function FaqList({ items }: { items: { key: string; q: string; a: string }[] }) {
  const [open, setOpen] = useState<string | null>(items[0]?.key ?? null);
  const reduce = useReducedMotion();
  const base = useId();
  return (
    <ul className="flex flex-col">
      {items.map(({ key, q, a }) => {
        const isOpen = open === key;
        const panel = `${base}-${key}`;
        return (
          <li key={key} data-reveal className="border-b first:border-t">
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panel}
                onClick={() => setOpen(isOpen ? null : key)}
                className="group flex w-full items-center justify-between gap-6 py-6 text-start text-lg font-semibold tracking-tight transition-colors hover:text-primary sm:text-xl"
              >
                {q}
                <motion.span
                  aria-hidden
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={{ type: "spring", stiffness: 320, damping: 22 }}
                  className={cn("flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors", isOpen && "border-primary bg-primary text-primary-foreground")}
                >
                  <Plus className="size-4" />
                </motion.span>
              </button>
            </h3>
            <motion.div
              id={panel}
              role="region"
              aria-hidden={!isOpen}
              initial={false}
              animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
              className="overflow-hidden"
              // Closed answers keep their text but leave the tab order.
              inert={!isOpen}
            >
              <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-muted-foreground">{a}</p>
            </motion.div>
          </li>
        );
      })}
    </ul>
  );
}
