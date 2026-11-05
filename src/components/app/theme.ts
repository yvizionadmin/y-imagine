"use client";

import { useSyncExternalStore } from "react";

import { THEME_KEY as KEY, THEMES, type Theme } from "./theme-script";

// setTheme keeps <html class="dark"> in sync after THEME_SCRIPT applied the saved theme.
export { THEMES, type Theme };

const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : "light";
  } catch {
    return "light";
  }
}

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
  apply(theme);
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      const media = matchMedia("(prefers-color-scheme: dark)");
      const onSystem = () => read() === "system" && apply("system");
      media.addEventListener("change", onSystem);
      return () => {
        listeners.delete(onChange);
        media.removeEventListener("change", onSystem);
      };
    },
    read,
    () => "light",
  );
}
