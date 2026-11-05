// Category presets shared by Generate, Recolor and A+. The Figma sections (furniture, electronics,
// home appliances, mobile, fashion) differ only in these values; the other template categories
// follow the same shape, so they become per-tenant
// config (DB-backed in Phase 2). Labels resolve through messages: Presets.categories / scenes /
// styles / styleLabels. Keys match the template picker's categories (features/templates).

export type ScenePreset = { key: string; image: string };

export type CategoryPreset = {
  key: string;
  skuPlaceholder: string;
  /** Heading over the style chips: the Figma variants name it per category. */
  styleLabel: "interior" | "display" | "photography";
  /** Recolor's wording for this category (Figma recolor variants): what the new colour is applied to. */
  recolorKind: "fabric" | "finish" | "product" | "device" | "garment";
  scenes: ScenePreset[];
  styles: string[];
  /**
   * Product types inside the category (Presets.subcategories). Optional for the merchant; when
   * picked, the prompt names the exact product ("sofa") instead of just the category.
   */
  subcategories: string[];
};

export const categoryPresets: CategoryPreset[] = [
  {
    key: "furniture",
    skuPlaceholder: "SOFA-12345",
    styleLabel: "interior",
    recolorKind: "fabric",
    scenes: [
      { key: "livingRoom", image: "/scenes/living-room.png" },
      { key: "minimalistStudio", image: "/scenes/minimalist-studio.png" },
      { key: "luxuryLoft", image: "/scenes/luxury-loft.png" },
    ],
    styles: ["contemporary", "scandinavian", "minimalist", "industrial"],
    subcategories: ["sofas", "armchairs", "beds", "diningTables", "coffeeTables", "wardrobes", "tvUnits", "officeChairs"],
  },
  // Figma 98:54187 (Section 4 - Home Appliances).
  {
    key: "homeAppliances",
    skuPlaceholder: "APP-45678",
    styleLabel: "interior",
    recolorKind: "finish",
    scenes: [
      { key: "modernKitchen", image: "/scenes/modern-kitchen.jpg" },
      { key: "smartHome", image: "/scenes/smart-home.jpg" },
      { key: "laundryRoom", image: "/scenes/laundry-room.jpg" },
    ],
    styles: ["contemporary", "farmhouse", "minimalist", "industrial"],
    subcategories: ["refrigerators", "washingMachines", "airConditioners", "airPurifiers", "vacuumCleaners", "waterHeaters"],
  },
  // Figma 98:10777 (Section 3, "Electronics": a blender in kitchen and showroom scenes).
  {
    key: "kitchenAppliances",
    skuPlaceholder: "ELC-78901",
    styleLabel: "display",
    recolorKind: "product",
    scenes: [
      { key: "kitchenCounter", image: "/scenes/modern-kitchen-tech.jpg" },
      { key: "smartHomeSetup", image: "/scenes/smart-home-setup.jpg" },
      { key: "techShowroom", image: "/scenes/tech-showroom.jpg" },
    ],
    styles: ["modernTech", "sleekMinimal", "cleanWhite", "premiumDark"],
    subcategories: ["blenders", "coffeeMachines", "microwaves", "toasters", "airFryers", "kettles"],
  },
  // Figma 98:43318 (Section 4 - Mobile & Accessories). The frame reused the furniture photos,
  // which didn't match the scene names; these are the closest device scenes we have.
  {
    key: "mobile",
    skuPlaceholder: "MOB-78901",
    styleLabel: "interior",
    recolorKind: "device",
    scenes: [
      { key: "techDesk", image: "/scenes/smart-home-setup.jpg" },
      { key: "cleanDisplay", image: "/scenes/minimalist-studio.png" },
      { key: "premiumShowcase", image: "/scenes/tech-showroom.jpg" },
    ],
    styles: ["modern", "futuristic", "minimalist", "urban"],
    subcategories: ["smartphones", "phoneCases", "earbuds", "chargers", "smartwatches", "powerBanks"],
  },
  // Figma 98:32391 (Section 5, apparel).
  {
    key: "fashion",
    skuPlaceholder: "DRS-78901",
    styleLabel: "photography",
    recolorKind: "garment",
    scenes: [
      { key: "studioBackdrop", image: "/scenes/studio-backdrop.jpg" },
      { key: "urbanStreet", image: "/scenes/urban-street.jpg" },
      { key: "editorialSet", image: "/scenes/editorial-set.jpg" },
    ],
    styles: ["editorial", "streetStyle", "minimalist", "highFashion"],
    subcategories: ["dresses", "tops", "handbags", "shoes", "watches", "sunglasses"],
  },
  // The remaining template categories. Scenes generated in Figma (file n2sZrjuN0QtS3mYXaPXiSz),
  // except cosmetics, which reuses the fashion studio scenes.
  {
    key: "outdoor",
    skuPlaceholder: "OUT-24680",
    styleLabel: "display",
    recolorKind: "product",
    scenes: [
      { key: "patioTerrace", image: "/scenes/patio-terrace.jpg" },
      { key: "gardenLawn", image: "/scenes/garden-lawn.jpg" },
      { key: "poolDeck", image: "/scenes/pool-deck.jpg" },
    ],
    styles: ["modern", "mediterranean", "tropical", "rustic"],
    subcategories: ["patioSets", "loungers", "umbrellas", "bbqGrills", "planters", "outdoorSofas"],
  },
  {
    key: "kidsToys",
    skuPlaceholder: "TOY-13579",
    styleLabel: "display",
    recolorKind: "product",
    scenes: [
      { key: "kidsPlayroom", image: "/scenes/kids-playroom.jpg" },
      { key: "pastelNursery", image: "/scenes/pastel-nursery.jpg" },
      { key: "activityTable", image: "/scenes/activity-table.jpg" },
    ],
    styles: ["playful", "softPastel", "colorful", "minimalist"],
    subcategories: ["buildingBlocks", "plushToys", "dolls", "puzzles", "rcToys", "learningToys"],
  },
  {
    key: "cosmetics",
    skuPlaceholder: "COS-24680",
    styleLabel: "photography",
    recolorKind: "product",
    scenes: [
      { key: "studioBackdrop", image: "/scenes/studio-backdrop.jpg" },
      { key: "minimalistStudio", image: "/scenes/minimalist-studio.png" },
      { key: "editorialSet", image: "/scenes/editorial-set.jpg" },
    ],
    styles: ["cleanWhite", "luxury", "natural", "editorial"],
    subcategories: ["skincare", "makeup", "fragrances", "haircare", "nailCare"],
  },
  {
    key: "lighting",
    skuPlaceholder: "LGT-11223",
    styleLabel: "interior",
    recolorKind: "product",
    scenes: [
      { key: "duskDining", image: "/scenes/dusk-dining.jpg" },
      { key: "eveningBedside", image: "/scenes/evening-bedside.jpg" },
      { key: "readingNook", image: "/scenes/reading-nook.jpg" },
    ],
    styles: ["contemporary", "scandinavian", "industrial", "minimalist"],
    subcategories: ["chandeliers", "pendantLights", "floorLamps", "tableLamps", "wallLights", "ledStrips"],
  },
  {
    key: "outdoorKidsToys",
    skuPlaceholder: "OKT-33445",
    styleLabel: "display",
    recolorKind: "product",
    scenes: [
      { key: "backyardPlay", image: "/scenes/backyard-play.jpg" },
      { key: "playgroundPark", image: "/scenes/playground-park.jpg" },
      { key: "sunnyBeach", image: "/scenes/sunny-beach.jpg" },
    ],
    styles: ["playful", "colorful", "softPastel", "natural"],
    subcategories: ["bicycles", "scooters", "swings", "slides", "trampolines", "kites"],
  },
  {
    key: "bathroom",
    skuPlaceholder: "BTH-55667",
    styleLabel: "interior",
    recolorKind: "product",
    scenes: [
      { key: "spaBathroom", image: "/scenes/spa-bathroom.jpg" },
      { key: "marbleVanity", image: "/scenes/marble-vanity.jpg" },
      { key: "walkInShower", image: "/scenes/walk-in-shower.jpg" },
    ],
    styles: ["spa", "contemporary", "minimalist", "industrial"],
    subcategories: ["faucets", "vanities", "showerHeads", "towelRails", "bathMats", "mirrors"],
  },
  {
    key: "decor",
    skuPlaceholder: "DEC-77889",
    styleLabel: "interior",
    recolorKind: "product",
    scenes: [
      { key: "entrywayConsole", image: "/scenes/entryway-console.jpg" },
      { key: "fireplaceMantel", image: "/scenes/fireplace-mantel.jpg" },
      { key: "openShelving", image: "/scenes/open-shelving.jpg" },
    ],
    styles: ["contemporary", "scandinavian", "bohemian", "minimalist"],
    subcategories: ["vases", "wallArt", "cushions", "rugs", "candles", "clocks"],
  },
];

export const findCategory = (key: string) => categoryPresets.find((c) => c.key === key);

/** The subcategory key when it belongs to the category, else null. */
export const findSubcategory = (category: string, key: string | null | undefined) =>
  key && findCategory(category)?.subcategories.includes(key) ? key : null;

/** The template picker's photo for a product type: generated with Figma AI (file n2sZrjuN0QtS3mYXaPXiSz), 384px. */
export const subcategoryImage = (key: string) => `/templates/subcategories/${key}.jpg`;

/**
 * Every preset scene once, with the categories that recommend it: the "Browse all" library.
 * Categories share a scene by reusing its key, so a scene key always means the same photo.
 */
export const sceneLibrary: (ScenePreset & { categories: string[] })[] = [];
for (const c of categoryPresets) {
  for (const s of c.scenes) {
    const known = sceneLibrary.find((l) => l.key === s.key);
    if (known) known.categories.push(c.key);
    else sceneLibrary.push({ ...s, categories: [c.key] });
  }
}

/** Longest scene description a merchant can write in place of a library scene. */
export const CUSTOM_SCENE_MAX = 500;
/** Longest product size the merchant can type for Generate, e.g. "220 × 95 × 85 cm". */
export const PRODUCT_SIZE_MAX = 80;

export const findScene = (key: string) => sceneLibrary.find((s) => s.key === key);
