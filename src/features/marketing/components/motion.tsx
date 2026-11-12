"use client";

import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";

const SPRING = { stiffness: 220, damping: 18, mass: 0.4 };

/** Lights up the `.mkt-spot` card under the pointer. One listener for the whole group; children stay server-rendered. */
export function Spotlight({ children, className }: { children: React.ReactNode; className?: string }) {
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const card = (event.target as HTMLElement).closest<HTMLElement>(".mkt-spot");
    if (!card || !event.currentTarget.contains(card)) return;
    const box = card.getBoundingClientRect();
    card.style.setProperty("--x", `${event.clientX - box.left}px`);
    card.style.setProperty("--y", `${event.clientY - box.top}px`);
  }
  return (
    <div className={className} onPointerMove={onPointerMove}>
      {children}
    </div>
  );
}

/** Leans its child toward a mouse pointer on a spring. Touch and reduced motion get a still button. */
export function Magnetic({ children, strength = 0.3 }: { children: React.ReactNode; strength?: number }) {
  const reduce = useReducedMotion();
  const x = useSpring(0, SPRING);
  const y = useSpring(0, SPRING);
  function move(event: React.PointerEvent<HTMLSpanElement>) {
    if (reduce || event.pointerType !== "mouse") return;
    const box = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - box.left - box.width / 2) * strength);
    y.set((event.clientY - box.top - box.height / 2) * strength);
  }
  function leave() {
    x.set(0);
    y.set(0);
  }
  return (
    <motion.span onPointerMove={move} onPointerLeave={leave} style={{ x, y }} whileTap={reduce ? undefined : { scale: 0.96 }} className="inline-block">
      {children}
    </motion.span>
  );
}

/** A card that tilts in 3D toward the pointer, with a soft glare. */
export function TiltCard({ children, className, max = 7 }: { children: React.ReactNode; className?: string; max?: number }) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [max, -max]), SPRING);
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), SPRING);
  const glareX = useTransform(px, (v) => `${v * 100}%`);
  const glareY = useTransform(py, (v) => `${v * 100}%`);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX} ${glareY}, rgba(255,255,255,.14), transparent 55%)`;

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (reduce || event.pointerType !== "mouse") return;
    const box = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - box.left) / box.width);
    py.set((event.clientY - box.top) / box.height);
  }
  function leave() {
    px.set(0.5);
    py.set(0.5);
  }
  return (
    <motion.div
      onPointerMove={move}
      onPointerLeave={leave}
      style={reduce ? undefined : { rotateX, rotateY, transformPerspective: 900 }}
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ type: "spring", ...SPRING }}
      className={className}
    >
      {children}
      {!reduce && <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: glare }} />}
    </motion.div>
  );
}
