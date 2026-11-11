/** Fired in the browser when a screen starts background work, so the top bar's jobs tray checks at once. */
export const JOBS_EVENT = "imagine:jobs";

export function jobsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(JOBS_EVENT));
}
