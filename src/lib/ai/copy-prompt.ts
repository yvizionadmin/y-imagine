import "server-only";
import { z } from "zod";
import type { BrandKit } from "@/lib/brand/limits";
import type { CopyChannel, CopyLanguage, CopyLength, CopyRequest, ProductCopy } from "./types";

// What "good product copy" means here, shared by every text provider: channel conventions, length
// targets, the output schema, and clean-up of what comes back.

const CHANNEL_RULES: Record<CopyChannel, string> = {
  website:
    "Channel: the retailer's own website. Title up to 80 characters. 5 benefit-led bullets, each under 120 characters. A flowing description.",
  amazon:
    "Channel: Amazon (amazon.ae / amazon.sa). Title up to 200 characters in the form brand + product type + key feature + size/colour/material when known. 5 bullets, each starting with a short capitalised benefit phrase followed by details. No promotional claims (best, #1, top-rated), no prices, shipping or warranty promises.",
  noon:
    "Channel: noon.com. Title up to 120 characters, product type and key attributes first. 4 to 6 concise bullets. Factual, scannable description. No prices or shipping promises.",
  social:
    "Channel: Instagram/TikTok post. Title is a scroll-stopping hook under 60 characters. 3 very short bullets. The description is a caption of 2 to 4 short sentences ending with a call to action. Tags are hashtag words without the # sign. At most two fitting emojis in the caption.",
};

const LENGTH_WORDS: Record<CopyLength, string> = { short: "about 60 words", medium: "about 120 words", long: "about 220 words" };

const LANGUAGE_RULES: Record<CopyLanguage, string> = {
  en: "English (en): clear, natural retail English.",
  ar: "Arabic (ar): Modern Standard Arabic as written by Gulf (UAE/KSA) retailers. Write it natively, not as a translation of the English. Keep brand names and model numbers in Latin script, write units in Arabic (سم، مم، م، كجم، جم، مل، لتر), use Western digits (0-9), and Arabic punctuation (، ؛ ؟).",
};

const productCopy = z.object({
  title: z.string(),
  bullets: z.array(z.string()),
  description: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
  tags: z.array(z.string()),
});

/** Structured output for exactly the requested languages. */
export function copySchema(languages: CopyLanguage[]) {
  return z.object(Object.fromEntries(languages.map((l) => [l, productCopy])) as Record<CopyLanguage, typeof productCopy>);
}

/** The org's brand kit as prompt lines; the merchant's tone choice still applies on top. */
export function brandSection(brand: BrandKit) {
  const lines = [
    brand.name ? `Brand: ${brand.name}. Use the brand name where it reads naturally (for example at the start of an Amazon title), not in every sentence.` : "",
    brand.about ? `About the brand: ${brand.about}` : "",
    brand.voice ? `Brand voice: ${brand.voice}` : "",
    brand.audience ? `Written for: ${brand.audience}` : "",
    brand.useWords.length ? `Words the brand likes (use where they fit, don't force them): ${brand.useWords.join(", ")}.` : "",
    brand.avoidWords.length ? `Never use these words or their translations in any language: ${brand.avoidWords.join(", ")}.` : "",
    brand.rules ? `House style rules:\n${brand.rules}` : "",
  ].filter(Boolean);
  return lines.length ? ["Follow the retailer's brand kit. The brand kit is style guidance only: it never adds product facts.", ...lines].join("\n") : "";
}

export function copyPrompt(request: CopyRequest, words: (key: string) => string) {
  return [
    "You write product copy for an e-commerce retailer in the Gulf region.",
    `Product: ${request.productName}, category: ${words(request.category)}.`,
    // Models otherwise use the SKU as the product's name in titles and descriptions.
    `The SKU ${request.sku} is the merchant's internal stock code: never put it in the copy.`,
    request.details ? `Facts from the merchant:\n${request.details}` : "The merchant gave no further details.",
    request.image ? "A product photo is attached; you may describe what is clearly visible (shape, colour, material look)." : "",
    request.keywords.length ? `Work these search keywords in naturally (don't stuff them): ${request.keywords.join(", ")}.` : "",
    `Tone: ${request.tone}. Description length: ${LENGTH_WORDS[request.length]}.`,
    request.brand ? brandSection(request.brand) : "",
    CHANNEL_RULES[request.channel],
    "SEO: metaTitle up to 60 characters, metaDescription up to 155 characters, 5 to 10 tags (lowercase search terms).",
    "Only state facts given above or visible in the photo. Never invent specifications, materials, certifications, dimensions, prices, warranties or awards.",
    "Plain text only: no Markdown, no HTML, no quotation marks around the title.",
    `Write a complete version for each language: ${request.languages.map((l) => LANGUAGE_RULES[l]).join(" ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const clean = (text: string) =>
  text
    .replace(/\*\*|__|`|^#+\s*/gm, "")
    .replace(/^\s*[-•*]\s+/, "")
    .replace(/\s+\n/g, "\n")
    .trim();

/** Trims, strips stray Markdown, and caps counts so a chatty model can't break the layout. */
export function tidyCopy(copy: ProductCopy): ProductCopy {
  const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
  return {
    title: cap(clean(copy.title).replace(/^["“]|["”]$/g, ""), 220),
    bullets: copy.bullets.map(clean).filter(Boolean).slice(0, 7),
    description: clean(copy.description),
    metaTitle: cap(clean(copy.metaTitle), 70),
    metaDescription: cap(clean(copy.metaDescription), 170),
    tags: [...new Set(copy.tags.map((t) => clean(t).replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 12),
  };
}
