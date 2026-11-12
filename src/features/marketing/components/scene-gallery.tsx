"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";
import { useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { A11y, Autoplay, EffectCoverflow, FreeMode, Keyboard, Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/effect-coverflow";

/**
 * Two rows for the Home gallery: a slow, endless ticker of product categories, then a coverflow of scenes you
 * can drag, swipe, or move with the arrows and keyboard. Swiper reads the clock while rendering, so the server
 * (and the first paint) gets a still row of the same images and Swiper takes over once the page is live.
 */
export function SceneGallery({
  categories,
  scenes,
  labels,
}: {
  categories: string[];
  scenes: string[];
  labels: { previous: string; next: string; region: string };
}) {
  const reduce = useReducedMotion();
  const live = useSyncExternalStore(noop, () => true, () => false);
  if (!live) return <StillGallery categories={categories} scenes={scenes} />;
  return (
    <div className="flex flex-col gap-10">
      <Swiper
        modules={[Autoplay, FreeMode]}
        aria-hidden
        className="mkt-ticker"
        slidesPerView="auto"
        spaceBetween={16}
        loop
        freeMode={{ enabled: true, momentum: false }}
        allowTouchMove={false}
        speed={reduce ? 0 : 7000}
        autoplay={reduce ? false : { delay: 0, disableOnInteraction: false }}
      >
        {categories.map((key) => (
          <SwiperSlide key={key} className="w-auto!">
            <div className="relative size-40 overflow-hidden rounded-3xl border sm:size-52">
              <Image src={`/templates/${key}.jpg`} alt="" fill sizes="208px" className="object-cover" />
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      <section aria-label={labels.region} className="relative">
        <Swiper
          modules={[A11y, Autoplay, EffectCoverflow, Keyboard, Navigation]}
          effect="coverflow"
          coverflowEffect={{ rotate: 14, depth: 160, modifier: 1, stretch: 0, slideShadows: false }}
          centeredSlides
          slidesPerView="auto"
          spaceBetween={24}
          loop
          grabCursor
          keyboard={{ enabled: true, onlyInViewport: true }}
          navigation={{ prevEl: ".mkt-gallery-prev", nextEl: ".mkt-gallery-next" }}
          a11y={{ prevSlideMessage: labels.previous, nextSlideMessage: labels.next }}
          autoplay={reduce ? false : { delay: 2800, pauseOnMouseEnter: true, disableOnInteraction: false }}
          speed={900}
          className="mkt-coverflow overflow-visible! py-4!"
        >
          {scenes.map((file) => (
            <SwiperSlide key={file} className="w-[78vw]! max-w-[34rem]">
              {/* Dimmed until active; styled from Swiper's own class (marketing.css), which stays right across page visits. */}
              <div className="mkt-scene relative aspect-[16/10] overflow-hidden rounded-[2rem] border bg-muted shadow-2xl">
                <Image src={`/scenes/${file}`} alt="" fill sizes="(min-width: 640px) 544px, 78vw" className="object-cover" />
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
        <div className="mt-8 flex justify-center gap-3">
          <button type="button" aria-label={labels.previous} className="mkt-gallery-prev flex size-12 items-center justify-center rounded-full border bg-background/70 backdrop-blur transition-colors hover:border-primary hover:text-primary">
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          </button>
          <button type="button" aria-label={labels.next} className="mkt-gallery-next flex size-12 items-center justify-center rounded-full border bg-background/70 backdrop-blur transition-colors hover:border-primary hover:text-primary">
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </button>
        </div>
      </section>
    </div>
  );
}

const noop = () => () => {};

/** What the server sends: the same cards, standing still, laid out like the live gallery. */
function StillGallery({ categories, scenes }: { categories: string[]; scenes: string[] }) {
  return (
    <div className="flex flex-col gap-10">
      <ul aria-hidden className="flex gap-4 overflow-hidden">
        {categories.map((key) => (
          <li key={key} className="relative size-40 shrink-0 overflow-hidden rounded-3xl border sm:size-52">
            <Image src={`/templates/${key}.jpg`} alt="" fill sizes="208px" className="object-cover" />
          </li>
        ))}
      </ul>
      <ul aria-hidden className="flex justify-center gap-4 overflow-hidden py-4">
        {scenes.slice(0, 3).map((file, i) => (
          <li key={file} className={`relative aspect-[16/10] w-[78vw] max-w-[34rem] shrink-0 overflow-hidden rounded-[2rem] border ${i === 1 ? "" : "brightness-50 saturate-50"}`}>
            <Image src={`/scenes/${file}`} alt="" fill sizes="(min-width: 640px) 544px, 78vw" className="object-cover" />
          </li>
        ))}
      </ul>
      <div className="h-12" />
    </div>
  );
}
