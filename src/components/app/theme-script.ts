// Light / Dark / System, stored per browser. Plain module (not "use client") so the locale layout
// can inline THEME_SCRIPT, which applies the saved theme before first paint.

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = "imagine-theme";
/** Dark unless the person chose otherwise (U7: the creative tools read best on dark, like the references). */
export const DEFAULT_THEME: Theme = "dark";

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||"${DEFAULT_THEME}";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
