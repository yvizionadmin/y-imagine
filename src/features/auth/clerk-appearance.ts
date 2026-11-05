// Clerk components themed with the app's CSS variables, so they follow light/dark and the brand
// colour, and sit flat inside the auth shell like the local form. Styles live in the "clerk" CSS
// layer (declared in globals.css) so these Tailwind classes override Clerk's defaults.
export const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorBackground: "var(--background)",
    colorForeground: "var(--foreground)",
    colorMuted: "var(--muted)",
    colorMutedForeground: "var(--muted-foreground)",
    colorInput: "var(--background)",
    colorInputForeground: "var(--foreground)",
    colorBorder: "var(--border)",
    colorRing: "var(--ring)",
    colorDanger: "var(--destructive)",
    borderRadius: "0.625rem",
    fontFamily: "var(--font-sans)",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full border-0 shadow-none",
    card: "bg-transparent px-0 shadow-none",
    footer: "bg-none bg-transparent",
  },
};
