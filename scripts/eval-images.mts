// Image quality eval: runs a fixed test set through a real image model with the app's own prompts
// (src/lib/ai/providers/ai-sdk.ts) and writes a side-by-side review page with automatic checks.
//
//   npm run eval:images -- --provider openai [--model gpt-image-1.5] [--runs 2] [--judge] [--only id,id] [--yes]
//
// Key from OPENAI_API_KEY or GEMINI_API_KEY (your own key; calls are billed by the provider, no
// Imagine credits are used and nothing is written to the database). Test set: evals/images/cases.json,
// else cases.example.json. Output: evals/images/runs/<time>-<provider>/index.html + results.json.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import sharp from "sharp";
import { z } from "zod";
import { createAiImageProvider } from "@/lib/ai/providers/ai-sdk";
import { imageModelsFor, isImageProvider, VISION_MODELS, type ImageProviderId } from "@/lib/ai/models";
import type { AplusFeature, GeneratedImage, ImageInput, RecolorScope } from "@/lib/ai/types";
import { deltaE2000, maskedColor, maskIoU, productMask } from "@/lib/eval/image-metrics";
import { findScene } from "@/lib/catalog-presets";
import { measureSwatch } from "@/lib/image/swatch";

type Base = { id: string; product: string; category: string; aspectRatio?: string; resolution?: "HD" | "2K"; notes?: string };
type Case =
  | (Base & { tool: "generate"; scene?: string; customScene?: string; sceneImage?: string; style?: string; productSize?: string; reference?: string; instructions?: string })
  | (Base & { tool: "recolor"; swatch: string; scope?: RecolorScope })
  | (Base & { tool: "aplus"; scene?: string; style?: string; title: string; subtitle?: string; features?: AplusFeature[]; layout?: "bento" | "gallery" });

const { values: args } = parseArgs({
  options: {
    provider: { type: "string", default: "openai" },
    model: { type: "string" },
    runs: { type: "string", default: "1" },
    cases: { type: "string" },
    only: { type: "string" },
    judge: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
});

const provider = args.provider as ImageProviderId;
if (!isImageProvider(provider)) throw new Error(`--provider must be openai or gemini`);
const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY);
if (!apiKey) throw new Error(provider === "openai" ? "Set OPENAI_API_KEY" : "Set GEMINI_API_KEY");
const imageModel = args.model ?? imageModelsFor(provider, null)[0];
const visionModel = VISION_MODELS[provider][0];
const runs = Math.max(1, Number(args.runs) || 1);

const casesPath = args.cases ?? (await readFile("evals/images/cases.json").then(() => "evals/images/cases.json", () => "evals/images/cases.example.json"));
const only = args.only?.split(",").map((s) => s.trim());
const cases = (JSON.parse(await readFile(casesPath, "utf8")) as Case[]).filter((c) => !only || only.includes(c.id));

const jobs = cases.length * runs;
console.log(`${cases.length} cases × ${runs} run(s) = ${jobs} image(s) on ${provider} ${imageModel}${args.judge ? ` + ${jobs} judge call(s) on ${visionModel}` : ""}`);
console.log(`Test set: ${casesPath}`);
if (!args.yes) {
  console.log("Provider calls are billed to your key. Re-run with --yes to start.");
  process.exit(0);
}

// Record the exact prompt each job sent, read from the outgoing provider request.
let lastPrompt = "";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (init?.body instanceof FormData) lastPrompt = String(init.body.get("prompt") ?? lastPrompt);
  else if (typeof init?.body === "string" && String(input).includes("image")) {
    try {
      const body = JSON.parse(init.body) as { contents?: { parts?: { text?: string }[] }[] };
      lastPrompt = body.contents?.flatMap((c) => c.parts ?? []).map((p) => p.text).filter(Boolean).join("\n") || lastPrompt;
    } catch {}
  }
  return realFetch(input, init);
};

const image = async (file: string): Promise<ImageInput> => ({
  bytes: new Uint8Array(await readFile(file)),
  mimeType: file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg",
  name: path.basename(file),
});
// The app only accepts PNG products (the upload converts); do the same here.
const pngProduct = async (file: string): Promise<ImageInput> => ({ bytes: new Uint8Array(await sharp(await readFile(file)).png().toBuffer()), mimeType: "image/png", name: path.basename(file) });

const ai = createAiImageProvider({ provider, apiKey, imageModel, visionModel });
const vision = provider === "openai" ? createOpenAI({ apiKey })(visionModel) : createGoogleGenerativeAI({ apiKey })(visionModel);

const JUDGE = z.object({
  productUnchanged: z.number().int().min(1).max(5).describe("5 = the product is identical to the original (shape, parts, logos, details)"),
  realism: z.number().int().min(1).max(5).describe("5 = indistinguishable from a real photo (lighting, shadows, edges)"),
  followsRequest: z.number().int().min(1).max(5).describe("5 = scene/style/colour exactly as requested"),
  scale: z.number().int().min(1).max(5).describe("5 = product size and placement are physically believable"),
  textAdded: z.boolean().describe("true if the model added any text, watermark or logo that is not on the original product"),
  notes: z.string().describe("one short sentence on the biggest problem, or empty"),
});

async function judge(c: Case, original: ImageInput, out: Buffer) {
  const request =
    c.tool === "generate"
      ? `a lifestyle photo, scene: ${c.sceneImage ? "the merchant's own background photo, kept unchanged" : (c.customScene ?? c.scene ?? "model's choice")}, style: ${c.style ?? "any"}${c.productSize ? `, product size ${c.productSize}` : ""}`
      : c.tool === "recolor"
        ? `a recolour of ${c.scope === "all" ? "the whole product" : "the main material only (frame, legs and hardware unchanged)"} to the swatch colour`
        : `an A+ page hero photo, scene: ${c.scene ?? "premium setting"}`;
  const { output } = await generateText({
    model: vision,
    output: Output.object({ schema: JUDGE }),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `You are a strict e-commerce photo QA reviewer. Image 1 is the original product photo. Image 2 is the AI result, which should be ${request}. Score it.` },
          { type: "file", data: original.bytes, mediaType: original.mimeType },
          { type: "file", data: out, mediaType: "image/webp" },
        ],
      },
    ],
    maxRetries: 1,
  });
  return output;
}

type Result = {
  id: string;
  tool: Case["tool"];
  run: number;
  ok: boolean;
  error?: string;
  seconds: number;
  prompt: string;
  inputs: string[];
  output?: string;
  size?: string;
  metrics: Record<string, number | string | null>;
  judge?: z.infer<typeof JUDGE> | { error: string };
};

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join("evals/images/runs", `${stamp}-${provider}-${imageModel}`);
await mkdir(outDir, { recursive: true });
const promptVersion = createHash("sha256").update(await readFile("src/lib/ai/providers/ai-sdk.ts")).digest("hex").slice(0, 8);
const results: Result[] = [];

for (const c of cases) {
  for (let run = 1; run <= runs; run++) {
    const label = `${c.id} #${run}`;
    const product = await pngProduct(c.product);
    const inputs = [c.product, ...("swatch" in c ? [c.swatch] : []), ...("reference" in c && c.reference ? [c.reference] : []), ...("sceneImage" in c && c.sceneImage ? [c.sceneImage] : [])].map((p) => path.relative(outDir, p));
    const result: Result = { id: c.id, tool: c.tool, run, ok: false, seconds: 0, prompt: "", inputs, metrics: {} };
    const started = Date.now();
    lastPrompt = "";
    try {
      let generated: GeneratedImage;
      const common = { sku: c.id, product, category: c.category, aspectRatio: c.aspectRatio ?? "1:1", resolution: c.resolution ?? "HD" };
      if (c.tool === "generate") {
        generated = await ai.generateLifestyle({
          ...common,
          reference: c.reference ? await image(c.reference) : null,
          scene: c.customScene || c.sceneImage ? null : (c.scene ?? null),
          customScene: c.sceneImage ? null : (c.customScene ?? null),
          sceneUpload: c.sceneImage ? await image(c.sceneImage) : null,
          style: c.style ?? null,
          productSize: c.productSize ?? "",
          instructions: c.instructions ?? "",
        });
      } else if (c.tool === "recolor") {
        const swatch = await image(c.swatch);
        const { hex } = await measureSwatch(swatch);
        const recolored = await ai.recolor({ ...common, swatch, hex, scope: c.scope ?? "main", notes: c.notes ?? "" });
        generated = recolored.image;
        result.metrics.swatchHex = hex;
        result.metrics.preservedByVision = recolored.preserved.join(", ") || null;
      } else {
        generated = await ai.generateAplus({
          ...common,
          reference: { kind: "library", layout: c.layout ?? "bento" },
          // A+ takes the scene's image path; cases name scenes by library key like Generate.
          scene: c.scene ? (findScene(c.scene)?.image ?? null) : null,
          style: c.style ?? null,
          title: c.title,
          subtitle: c.subtitle ?? "",
          features: c.features ?? [],
        });
      }
      result.seconds = Math.round((Date.now() - started) / 100) / 10;
      result.prompt = lastPrompt;
      const out = Buffer.from(generated.url.split(",")[1], "base64");
      const file = `${c.id}-${run}.webp`;
      await writeFile(path.join(outDir, file), out);
      Object.assign(result, { ok: true, output: file, size: `${generated.width}×${generated.height}` });

      if (c.tool === "recolor") {
        // Same camera and background, so the outlines should match and the colour should move to the swatch.
        const { width, height } = generated;
        const before = await productMask(product.bytes, width, height);
        const after = await productMask(out, width, height);
        result.metrics.shapeIoU = Math.round(maskIoU(before, after) * 1000) / 1000;
        const originalColor = await maskedColor(product.bytes, before, width, height);
        const newColor = await maskedColor(out, after, width, height);
        const target = result.metrics.swatchHex as string;
        result.metrics.productColor = newColor;
        result.metrics.deltaE = newColor ? Math.round(deltaE2000(target, newColor) * 10) / 10 : null;
        result.metrics.deltaEBefore = originalColor ? Math.round(deltaE2000(target, originalColor) * 10) / 10 : null;
      }
      if (args.judge) result.judge = await judge(c, product, out).catch((e: unknown) => ({ error: String(e instanceof Error ? e.message : e) }));
    } catch (error) {
      result.seconds = Math.round((Date.now() - started) / 100) / 10;
      result.prompt = lastPrompt;
      result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    results.push(result);
    const m = result.metrics;
    console.log(
      `${result.ok ? "✓" : "✗"} ${label.padEnd(28)} ${String(result.seconds).padStart(5)}s` +
        (m.deltaE != null ? `  ΔE ${m.deltaEBefore}→${m.deltaE}` : "") +
        (m.shapeIoU != null ? `  shape ${m.shapeIoU}` : "") +
        (result.judge && "realism" in result.judge ? `  judge ${result.judge.productUnchanged}/${result.judge.realism}/${result.judge.followsRequest}/${result.judge.scale}${result.judge.textAdded ? " TEXT" : ""}` : "") +
        (result.error ? `  ${result.error}` : ""),
    );
  }
}

const meta = { provider, imageModel, visionModel: args.judge ? visionModel : null, promptVersion, casesPath, runs, at: new Date().toISOString() };
await writeFile(path.join(outDir, "results.json"), JSON.stringify({ meta, results }, null, 2));
await writeFile(path.join(outDir, "index.html"), reviewPage(meta, results));

const avg = (xs: (number | null | undefined)[]) => {
  const ns = xs.filter((x): x is number => typeof x === "number");
  return ns.length ? Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 100) / 100 : "–";
};
console.log(`\nSucceeded ${results.filter((r) => r.ok).length}/${results.length}, prompt version ${promptVersion}`);
for (const tool of ["generate", "recolor", "aplus"] as const) {
  const rs = results.filter((r) => r.tool === tool && r.ok);
  if (!rs.length) continue;
  const j = rs.map((r) => (r.judge && "realism" in r.judge ? r.judge : null));
  console.log(
    `${tool.padEnd(9)} avg ${avg(rs.map((r) => r.seconds))}s` +
      (tool === "recolor" ? `  ΔE ${avg(rs.map((r) => r.metrics.deltaE as number))}  shape ${avg(rs.map((r) => r.metrics.shapeIoU as number))}` : "") +
      (args.judge ? `  unchanged ${avg(j.map((x) => x?.productUnchanged))}  realism ${avg(j.map((x) => x?.realism))}  request ${avg(j.map((x) => x?.followsRequest))}  scale ${avg(j.map((x) => x?.scale))}  text ${j.filter((x) => x?.textAdded).length}` : ""),
  );
}
console.log(`\nReview page: ${path.join(outDir, "index.html")}`);

function reviewPage(meta: Record<string, unknown>, results: Result[]) {
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const criteria = ["Product unchanged", "Scale & placement", "Realism", "Follows request", "Recolor parts / A+ title area"];
  const cards = results
    .map((r) => {
      const metrics = Object.entries(r.metrics).filter(([, v]) => v !== null).map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`).join("");
      const judged = r.judge && "realism" in r.judge
        ? `<span><b>judge</b> unchanged ${r.judge.productUnchanged} · realism ${r.judge.realism} · request ${r.judge.followsRequest} · scale ${r.judge.scale}${r.judge.textAdded ? " · <em>text added</em>" : ""}</span><span>${esc(r.judge.notes)}</span>`
        : r.judge ? `<span><b>judge</b> ${esc(r.judge.error)}</span>` : "";
      const key = `${r.id}#${r.run}`;
      return `<article data-key="${esc(key)}">
  <h2>${esc(r.id)} <small>${esc(r.tool)} · run ${r.run} · ${r.seconds}s${r.size ? ` · ${esc(r.size)}` : ""}</small></h2>
  <div class="imgs">${r.inputs.map((i) => `<figure><img src="${esc(i)}" alt=""><figcaption>input</figcaption></figure>`).join("")}${r.output ? `<figure class="out"><img src="${esc(r.output)}" alt=""><figcaption>result</figcaption></figure>` : `<p class="err">${esc(r.error)}</p>`}</div>
  <div class="metrics">${metrics}${judged}</div>
  <div class="scores">${criteria.map((c, i) => `<label>${c}<select data-i="${i}"><option></option>${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("")}</select></label>`).join("")}<label class="note">Note<input data-i="note"></label></div>
  <details><summary>Prompt sent</summary><pre>${esc(r.prompt)}</pre></details>
</article>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Image Eval</title>
<style>
:root{--bg:#f7f7f8;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#2563eb;--bad:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--card:#151821;--text:#e5e7eb;--muted:#9ca3af;--line:#262a36;--accent:#60a5fa;--bad:#f87171}}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,sans-serif;padding:16px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
h1{font-size:18px;margin:0} header p{margin:0;color:var(--muted)}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
h2{font-size:15px;margin:0 0 10px} small{color:var(--muted);font-weight:400}
.imgs{display:flex;gap:10px;overflow-x:auto} figure{margin:0;flex:0 0 auto} figure img{height:260px;max-width:100%;border-radius:8px;border:1px solid var(--line);background:#fff}
.out img{height:340px} figcaption{color:var(--muted);font-size:12px}
.metrics{display:flex;flex-wrap:wrap;gap:6px 16px;margin:10px 0;font-size:13px} .err{color:var(--bad)}
.scores{display:flex;flex-wrap:wrap;gap:8px 14px} .scores label{display:flex;flex-direction:column;font-size:12px;color:var(--muted)}
select,input{margin-top:2px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text)} .note{flex:1;min-width:200px}
pre{white-space:pre-wrap;font-size:12px;color:var(--muted)}
@media (max-width:600px){figure img,.out img{height:160px}}
</style></head><body>
<header><div><h1>Image eval · ${esc(meta.provider)} ${esc(meta.imageModel)}</h1><p>prompt ${esc(meta.promptVersion)} · ${esc(meta.at)} · score each result 1–5 (saved in this browser)</p></div><button id="csv">Download scores CSV</button></header>
${cards}
<script>
const store = "eval-scores:${esc(meta.at)}";
let saved = {}; try { saved = JSON.parse(localStorage.getItem(store) || "{}"); } catch {}
document.querySelectorAll("article").forEach((a) => {
  const key = a.dataset.key;
  a.querySelectorAll("[data-i]").forEach((el) => {
    el.value = saved[key]?.[el.dataset.i] ?? "";
    el.addEventListener("change", () => { saved[key] = { ...saved[key], [el.dataset.i]: el.value }; try { localStorage.setItem(store, JSON.stringify(saved)); } catch {} });
  });
});
document.getElementById("csv").onclick = () => {
  const head = ["case", ${criteria.map((c) => JSON.stringify(c)).join(", ")}, "note"];
  const rows = [...document.querySelectorAll("article")].map((a) => [a.dataset.key, ...[0,1,2,3,4,"note"].map((i) => a.querySelector('[data-i="' + i + '"]').value)]);
  const csv = [head, ...rows].map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "scores.csv"; link.click();
};
</script></body></html>`;
}
