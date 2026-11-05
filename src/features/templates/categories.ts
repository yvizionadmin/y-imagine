// Template categories shown by the "+" (new job) picker, in the Figma order (frame 19:3, "Explore
// Available Templates"). Labels resolve through messages: Templates.categories. Images are the
// AI-generated ones from that frame, resized to 384px.

export type TemplateCategory = { key: string; image: string };

export const templateCategories: TemplateCategory[] = [
  { key: "furniture", image: "/templates/furniture.jpg" },
  { key: "outdoor", image: "/templates/outdoor.jpg" },
  { key: "homeAppliances", image: "/templates/homeAppliances.jpg" },
  { key: "fashion", image: "/templates/fashion.jpg" },
  { key: "kidsToys", image: "/templates/kidsToys.jpg" },
  { key: "cosmetics", image: "/templates/cosmetics.jpg" },
  { key: "kitchenAppliances", image: "/templates/kitchenAppliances.jpg" },
  { key: "mobile", image: "/templates/mobile.jpg" },
  { key: "lighting", image: "/templates/lighting.jpg" },
  { key: "outdoorKidsToys", image: "/templates/outdoorKidsToys.jpg" },
  { key: "bathroom", image: "/templates/bathroom.jpg" },
  { key: "decor", image: "/templates/decor.jpg" },
];
