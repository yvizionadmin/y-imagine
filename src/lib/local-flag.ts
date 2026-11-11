"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "imagine:local-flag";

function read(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/**
 * A per-browser yes/no remembered in localStorage (a dismissed tip or checklist). A convenience only: if storage is
 * blocked it reads false and the tip shows again. `null` key means "not known yet" and reads true (stay hidden).
 * The server render reads true too, so nothing flashes before the browser's answer is known.
 */
export function useLocalFlag(key: string | null): [boolean, () => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => (key === null ? true : read(key)),
    () => true,
  );
  const set = useCallback(() => {
    if (key === null) return;
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Storage blocked: it just won't be remembered.
    }
    window.dispatchEvent(new Event(EVENT));
  }, [key]);
  return [value, set];
}
