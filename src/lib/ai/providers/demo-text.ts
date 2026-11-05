import "server-only";
import { ProviderError } from "../errors";
import type { CopyRequest, ImprovePromptRequest, ProductCopy, TextProvider } from "../types";

// Offline stand-in for a writing model: assembles plausible copy from the merchant's own details so
// the Copy tool works without keys. Include "FAIL" in the SKU to exercise the failure state.

const LATENCY_MS = 1200;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Merchant details split into short facts (lines, or comma-separated). */
function facts(details: string) {
  const parts = details.includes("\n") ? details.split("\n") : details.split(/[,;]/);
  return parts.map((p) => p.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean).slice(0, 6);
}

const LENGTH_SENTENCES = { short: 1, medium: 2, long: 3 } as const;

function english(request: CopyRequest): ProductCopy {
  const points = facts(request.details);
  const name = request.productName;
  const lead = {
    professional: `The ${name} brings dependable quality to everyday use.`,
    friendly: `Meet the ${name}, made to fit right into your day.`,
    luxury: `The ${name} is crafted for those who expect more.`,
    playful: `Say hello to the ${name}, your new favourite.`,
  }[request.tone];
  const more = [
    points.length ? `Highlights include ${points.slice(0, 3).join(", ").toLowerCase()}.` : "It is designed with attention to detail.",
    "It pairs practical design with a finish that suits modern homes.",
    "Order today and enjoy it at home in the UAE and across the region.",
  ];
  return {
    title: request.channel === "social" ? `Meet the ${name}` : `${name}${points[0] ? ` – ${points[0]}` : ""}`,
    bullets: (points.length ? points : ["Thoughtful design", "Quality materials", "Easy to care for"]).map((p) => p.charAt(0).toUpperCase() + p.slice(1)),
    description: [lead, ...more.slice(0, LENGTH_SENTENCES[request.length])].join(" "),
    metaTitle: `${name} | Shop Online`.slice(0, 60),
    metaDescription: `Shop the ${name}. ${points.slice(0, 2).join(", ")}`.slice(0, 155),
    tags: [...new Set([...request.keywords, ...name.toLowerCase().split(/\s+/)])].slice(0, 8),
  };
}

function arabic(request: CopyRequest): ProductCopy {
  const points = facts(request.details);
  const name = request.productName;
  const lead = {
    professional: `يقدّم ${name} جودة موثوقة للاستخدام اليومي.`,
    friendly: `تعرّف على ${name}، المصمّم ليناسب يومك بسهولة.`,
    luxury: `صُمّم ${name} لمن يبحث عن الفخامة والتميّز.`,
    playful: `قل مرحبًا لـ ${name}، مفضّلك الجديد.`,
  }[request.tone];
  const more = ["يجمع بين التصميم العملي واللمسة العصرية التي تناسب منزلك.", "صُنع بعناية ليدوم معك طويلًا.", "اطلبه اليوم واستمتع به في منزلك في الإمارات والمنطقة."];
  return {
    title: request.channel === "social" ? `تعرّف على ${name}` : name,
    bullets: points.length ? points.map((p) => `ميزة: ${p}`) : ["تصميم مدروس", "خامات عالية الجودة", "سهل العناية"],
    description: [lead, ...more.slice(0, LENGTH_SENTENCES[request.length])].join(" "),
    metaTitle: `${name} | تسوّق أونلاين`.slice(0, 60),
    metaDescription: `تسوّق ${name} بأفضل جودة وتصميم عصري.`.slice(0, 155),
    tags: [...new Set([...request.keywords, ...name.toLowerCase().split(/\s+/)])].slice(0, 8),
  };
}

/** Brand kit offline: the brand name in the meta title and words to avoid taken out. */
function branded(copy: ProductCopy, brand: CopyRequest["brand"]): ProductCopy {
  if (!brand) return copy;
  const avoid = brand.avoidWords.map((w) => new RegExp(`\\s*${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "giu"));
  const scrub = (text: string) => avoid.reduce((t, re) => t.replace(re, ""), text).trim();
  return {
    title: scrub(copy.title),
    bullets: copy.bullets.map(scrub).filter(Boolean),
    description: scrub(copy.description),
    metaTitle: brand.name ? `${copy.metaTitle.split(" | ")[0]} | ${brand.name}`.slice(0, 60) : scrub(copy.metaTitle),
    metaDescription: scrub(copy.metaDescription),
    tags: copy.tags.filter((tag) => scrub(tag) === tag),
  };
}

const ARABIC = /[\u0600-\u06FF]/;

// Offline prompt rewrite: the merchant's text plus the tool's standard detail phrases.
const PROMPT_ADDITIONS = {
  generate: {
    en: "soft natural daylight from the side, eye-level camera, realistic contact shadows, calm uncluttered styling",
    ar: "إضاءة نهارية طبيعية ناعمة من الجانب، كاميرا بمستوى النظر، ظلال واقعية، تنسيق هادئ وبسيط",
  },
  recolor: {
    en: "change only the main material to the swatch colour; keep legs, frame, hardware, stitching and shadows exactly as they are",
    ar: "غيّر لون المادة الرئيسية فقط إلى لون العينة، مع إبقاء الأرجل والإطار والإكسسوارات والخياطة والظلال كما هي",
  },
} as const;

function improveOffline(request: ImprovePromptRequest) {
  const language = request.text ? (ARABIC.test(request.text) ? "ar" : "en") : request.language;
  const addition = PROMPT_ADDITIONS[request.tool][language];
  const base = request.text.trim().replace(/[.،,]\s*$/, "");
  return base ? `${base}${language === "ar" ? "، " : ", "}${addition}.` : `${addition[0].toUpperCase()}${addition.slice(1)}.`;
}

export const demoTextProvider: TextProvider = {
  id: "demo",
  async generateCopy(request) {
    await wait(LATENCY_MS);
    if (request.sku.toUpperCase().includes("FAIL")) throw new ProviderError("generation_failed");
    const writers = { en: english, ar: arabic };
    return {
      copy: Object.fromEntries(request.languages.map((l) => [l, branded(writers[l](request), request.brand)])),
      provider: "demo",
      model: "demo-copy-v1",
    };
  },
  async improvePrompt(request) {
    await wait(LATENCY_MS / 2);
    if (request.text.toUpperCase().includes("FAIL")) throw new ProviderError("generation_failed");
    return { text: improveOffline(request), model: "demo-prompt-v1" };
  },
};
