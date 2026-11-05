# Image quality eval

Measures how well the image tools (Generate, Recolor, A+) keep products accurate, on a fixed test set,
so models and prompt changes can be compared with numbers instead of impressions.

```bash
OPENAI_API_KEY=sk-... npm run eval:images -- --provider openai --runs 2 --judge        # prints the plan
OPENAI_API_KEY=sk-... npm run eval:images -- --provider openai --runs 2 --judge --yes  # runs it
GEMINI_API_KEY=...    npm run eval:images -- --provider gemini --model gemini-2.5-flash-image --yes
```

- Calls go straight to the provider with **your key** and are billed there. No Imagine credits are used and
  nothing is saved to the database. Without `--yes` it only prints how many images it would make.
- Prompts are the app's own (`src/lib/ai/providers/ai-sdk.ts`); each run records the exact prompt sent and a
  `promptVersion` hash of that file, so two runs show whether a prompt change helped.
- Output: `evals/images/runs/<time>-<provider>-<model>/index.html` (inputs and result side by side, metrics,
  1–5 score boxes, Download scores CSV) and `results.json`. Runs are git-ignored.
- `--only id1,id2` runs a subset; `--cases file.json` picks another test set.

## The test set

`cases.example.json` uses the demo photos. For a real exercise, copy it to `cases.json` and point it at about
20 real catalog photos (2–3 per category): easy items (a plain sofa) and hard ones (glass, chrome, printed text,
patterns, mixed materials, thin legs and cords). For Recolor add 3–4 swatches per product (solid, textured,
dark, light). Keep the set fixed so runs stay comparable.

Fields: `id`, `tool` (`generate` | `recolor` | `aplus`), `product`, `category`, optional `aspectRatio`,
`resolution`. Generate: `scene` (library key), `customScene` or `sceneImage` (your own background photo), `style`, `productSize`, `reference`,
`instructions`. Recolor: `swatch`, `scope` (`main` | `all`), `notes`. A+: `title`, `subtitle`, `features`,
`scene`, `style`, `layout`.

## What the checks mean

| Check | Tool | Good | Meaning |
|---|---|---|---|
| `deltaE` (before → after) | Recolor | < 5 (< 2 excellent) | CIEDE2000 distance between the swatch colour and the product's mid-tone colour in the result. `deltaEBefore` is the original's distance, for reference. |
| `shapeIoU` | Recolor | > 0.95 | Overlap of the product outline before and after (1 = identical). Low = the model reshaped or moved it. Needs a plain studio background. |
| judge (`--judge`) | all | 4–5 | A vision model scores product unchanged / realism / follows request / scale and flags added text. A hint for triage, not a replacement for people. |
| your 1–5 scores | all | ≥ 4 | The real verdict. "Product unchanged" below 4 means the image is not usable. |

Both automatic checks are approximate (shadows, a recoloured "main material only" sofa keeps original legs).
Use them to compare runs on the same set, not as absolute grades.

## The loop

1. Run the baseline: both providers, `--runs 2`, score the page, download the CSV.
2. Change **one** thing (a prompt line, a model, a new option), run again.
3. Keep the change only if scores go up without the "product unchanged" score going down.
