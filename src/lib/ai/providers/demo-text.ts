import "server-only";
import { ProviderError } from "../errors";
import type { AgentEvent, AgentRequest, CameraMove, ChatRequest, DirectorPlanRequest, CopyRequest, ImprovePromptRequest, ProductCopy, TextProvider } from "../types";

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

/** Offline assistant: a short canned reply in the user's language that echoes what they asked. */
function demoReply(request: ChatRequest) {
  const asked = request.messages.at(-1)?.content.trim() ?? "";
  const topic = asked.length > 80 ? `${asked.slice(0, 80)}…` : asked;
  return ARABIC.test(asked)
    ? `هذا رد تجريبي من المساعد (وضع العرض).\n\nسألت: «${topic}»\n\n- اربط مفتاح OpenAI أو Anthropic أو Gemini أو OpenRouter في الإعدادات ← مفاتيح API للحصول على إجابات حقيقية.\n- يمكنني مساعدتك في أوصاف المنتجات والعناوين والأفكار التسويقية.`
    : `This is a demo reply from the assistant (offline mode).\n\nYou asked: "${topic}"\n\n- Connect an OpenAI, Anthropic, Gemini or OpenRouter key in Settings → API Keys for real answers.\n- I can help with product descriptions, titles and campaign ideas.`;
}

const STOP_WORDS = new Set(
  "the a an and or for with our your this that from into find write make create generate image images photo picture lifestyle copy product products description title arabic english then also please some new one two for its".split(" "),
);

/** Catalog searches the offline agent tries, best first: SKU-like tokens, then the goal's longer words. */
export function demoSearchTerms(goal: string): string[] {
  const tokens = goal.split(/[\s,.;:!?"'()«»،]+/).filter(Boolean);
  const skus = tokens.filter((w) => /\d/.test(w) && /^[A-Za-z0-9-]{4,}$/.test(w));
  const words = tokens.map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/\d/.test(w));
  const singular = words.map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
  return [...new Set([...skus, ...singular])].slice(0, 3);
}

/**
 * Offline agent: the same tools a real model would call, in a fixed order (search the catalog, write
 * copy for the first product, make an image of it), then a short summary. Exercises the run screen,
 * the tools and their credits without keys. "FAIL" in the goal fails the run before any tool.
 */
async function* demoAgent(request: AgentRequest): AsyncGenerator<AgentEvent> {
  const arabic = ARABIC.test(request.prompt);
  const say = (en: string, ar: string): AgentEvent => ({ type: "text", text: arabic ? ar : en });
  await wait(LATENCY_MS / 4);
  if (request.prompt.toUpperCase().includes("FAIL")) throw new ProviderError("generation_failed");
  const byName = new Map(request.tools.map((t) => [t.name, t]));
  let calls = 0;

  async function* call(name: string, input: Record<string, unknown>): AsyncGenerator<AgentEvent, unknown> {
    const tool = byName.get(name);
    if (!tool || request.signal?.aborted) return undefined;
    const id = `demo-call-${++calls}`;
    yield { type: "tool-call", id, name, input };
    try {
      const output = await tool.execute(tool.input.parse(input));
      yield { type: "tool-result", id, name, output };
      return output;
    } catch (error) {
      yield { type: "tool-error", id, name, error };
      return undefined;
    }
  }

  yield say("I'll look for the product in your catalog first.\n", "سأبحث عن المنتج في الكتالوج أولًا.\n");
  let product: { sku: string; name: string } | undefined;
  for (const query of demoSearchTerms(request.prompt)) {
    if (calls >= request.maxSteps - 1) break;
    const found = (yield* call("search_catalog", { query })) as { products?: { sku: string; name: string }[] } | undefined;
    product = found?.products?.[0];
    if (product) break;
  }
  if (!product) {
    yield say("I couldn't find a matching product. Try its SKU or a word from its name.", "لم أجد منتجًا مطابقًا. جرّب رمز المنتج أو كلمة من اسمه.");
    return;
  }
  const wantsArabic = arabic || /arabic|عرب/i.test(request.prompt);
  const copy = (yield* call("write_copy", { sku: product.sku, languages: wantsArabic ? ["en", "ar"] : ["en"], tone: "professional", channel: "website", details: "" })) as { title?: string } | undefined;
  const image = yield* call("generate_image", { sku: product.sku, scene: "", aspectRatio: "1:1" });
  if (request.signal?.aborted) return;
  yield say(
    `Done. I found "${product.name}" (${product.sku})${copy ? `, wrote its copy ("${copy.title}")` : ""}${image ? " and made a lifestyle image, saved to History" : ""}.`,
    `تم. وجدت «${product.name}» (${product.sku})${copy ? "، وكتبت وصفه" : ""}${image ? "، وأنشأت صورة له محفوظة في السجل" : ""}.`,
  );
}

const DEMO_CAMERAS: CameraMove[] = ["pushIn", "orbit", "tracking", "pullOut", "pan", "static"];
const DEMO_BEATS = {
  en: ["Here it is.", "Made for everyday life.", "Every detail matters.", "Built to last.", "Feel the difference.", "Find yours today."],
  ar: ["ها هو.", "صُمّم لحياتك اليومية.", "كل تفصيل مهم.", "صُنع ليدوم.", "اشعر بالفرق.", "اكتشفه اليوم."],
};
const DEMO_SHOTS = [
  "Opening wide shot of the product in a bright, modern room, soft morning light",
  "Close-up of the product's texture and finish, shallow depth of field",
  "The product in use by a relaxed person at home, warm natural light",
  "Detail shot of the craftsmanship, slow camera move, gentle shadows",
  "The product styled with matching decor, calm and uncluttered",
  "Closing hero shot of the product, centred, clean background",
];

/** Offline script: scenes built from the idea, narration in the requested language. "FAIL" fails. */
function demoPlan(request: DirectorPlanRequest) {
  const idea = request.idea.replace(/\s+/g, " ").trim();
  const title = idea.length > 60 ? `${idea.slice(0, 59).trimEnd()}…` : idea;
  return {
    title,
    scenes: Array.from({ length: request.scenes }, (_, i) => ({
      visual: `${DEMO_SHOTS[i % DEMO_SHOTS.length]}. Subject: ${idea.slice(0, 120)}.`,
      narration: DEMO_BEATS[request.language][i % DEMO_BEATS.en.length],
      camera: DEMO_CAMERAS[i % DEMO_CAMERAS.length],
    })),
  };
}

export const demoTextProvider: TextProvider = {
  id: "demo",
  model: "demo-chat-v1",
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
  async *streamChat(request) {
    const asked = request.messages.at(-1)?.content ?? "";
    await wait(LATENCY_MS / 4);
    if (asked.toUpperCase().includes("FAIL")) throw new ProviderError("generation_failed");
    // Word by word, like a real stream, so the UI's typing state and Stop button can be exercised.
    for (const piece of demoReply(request).split(/(?<=\s)/)) {
      if (request.signal?.aborted) return;
      await wait(15);
      yield piece;
    }
  },
  runAgent: demoAgent,
  async planVideo(request) {
    await wait(LATENCY_MS / 2);
    if (request.idea.toUpperCase().includes("FAIL")) throw new ProviderError("generation_failed");
    return { plan: demoPlan(request), model: "demo-director-v1" };
  },
  async improvePrompt(request) {
    await wait(LATENCY_MS / 2);
    if (request.text.toUpperCase().includes("FAIL")) throw new ProviderError("generation_failed");
    return { text: improveOffline(request), model: "demo-prompt-v1" };
  },
};
