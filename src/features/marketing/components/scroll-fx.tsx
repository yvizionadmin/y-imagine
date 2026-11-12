"use client";

import { useEffect, useRef } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import "lenis/dist/lenis.css";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * Scroll motion for the Home, Features and Pricing pages. Children stay server-rendered: every element is in the
 * HTML and visible without JavaScript; GSAP only sets the starting state once it runs, and only for people who
 * haven't asked for reduced motion. Hooks are data attributes:
 * - `data-split`: heading whose words rise in, line by line
 * - `data-reveal`: fades up when it scrolls into view (batched, staggered)
 * - `data-reveal-scale`: grows to full size as it scrolls in
 * - `data-parallax="12"`: drifts by that many percent across the viewport
 * - `data-hero-media`: tips back and shrinks as the hero scrolls away
 * - `data-steps` / `data-step` / `data-draw`: pinned walk-through on wide screens
 */
export function ScrollFx({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useSmoothScroll();

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add({ motion: "(prefers-reduced-motion: no-preference)", wide: "(min-width: 768px)" }, (context) => {
        const { motion, wide } = context.conditions as { motion: boolean; wide: boolean };
        if (!motion) return;
        const q = gsap.utils.selector(scope);

        for (const el of q("[data-split]") as HTMLElement[]) {
          SplitText.create(el, {
            type: "lines,words",
            mask: "lines",
            autoSplit: true,
            onSplit: (self) =>
              gsap.from(self.words, { yPercent: 110, duration: 1.1, ease: "expo.out", stagger: 0.035, scrollTrigger: { trigger: el, start: "top 88%", once: true } }),
          });
        }

        const reveals = q("[data-reveal]");
        if (reveals.length) {
          gsap.set(reveals, { y: 56, opacity: 0 });
          ScrollTrigger.batch(reveals, {
            start: "top 90%",
            once: true,
            onEnter: (batch) => gsap.to(batch, { y: 0, opacity: 1, duration: 1.1, ease: "power3.out", stagger: 0.09, overwrite: true }),
          });
        }

        for (const el of q("[data-reveal-scale]") as HTMLElement[]) {
          gsap.fromTo(el, { scale: 0.88, opacity: 0.5 }, { scale: 1, opacity: 1, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "top 35%", scrub: 0.6 } });
        }

        for (const el of q("[data-parallax]") as HTMLElement[]) {
          const amount = Number(el.dataset.parallax) || 10;
          gsap.fromTo(el, { yPercent: -amount }, { yPercent: amount, ease: "none", scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
        }

        for (const el of q("[data-hero-media]") as HTMLElement[]) {
          gsap.to(el, { scale: 0.9, rotateX: 12, yPercent: 8, opacity: 0.6, ease: "none", transformPerspective: 1200, scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: true } });
        }

        const steps = q("[data-steps]")[0] as HTMLElement | undefined;
        if (steps) {
          const items = steps.querySelectorAll("[data-step]");
          const line = steps.querySelector("[data-draw]");
          if (wide) {
            const tl = gsap.timeline({ scrollTrigger: { trigger: steps, start: "center center", end: "+=110%", pin: true, scrub: 0.8 } });
            if (line) tl.fromTo(line, { scaleX: 0 }, { scaleX: 1, ease: "none", duration: items.length }, 0);
            items.forEach((item, i) => tl.from(item, { opacity: 0.12, y: 48, ease: "power2.out", duration: 0.8 }, i));
          } else {
            gsap.from(items, { opacity: 0, y: 40, stagger: 0.15, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: steps, start: "top 80%", once: true } });
          }
        }
      });
      return () => mm.revert();
    },
    { scope },
  );

  return <div ref={scope}>{children}</div>;
}

/** Lenis smooth scrolling, driven by GSAP's ticker so ScrollTrigger reads the same position. Off for reduced motion. */
function useSmoothScroll() {
  useEffect(() => {
    if (matchMedia(REDUCED).matches) return;
    // Anchor links (the Features page index) land below the floating header.
    const lenis = new Lenis({ autoRaf: false, anchors: { offset: -96 }, lerp: 0.09 });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
    };
  }, []);
}
