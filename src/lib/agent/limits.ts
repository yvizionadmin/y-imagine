import { categoryPresets } from "@/lib/catalog-presets";

// Agent limits, run shapes and pure helpers, shared by the server and the agent screen (client-safe).

/** Longest goal a user can give. */
export const AGENT_GOAL_MAX = 1000;
/** Most model steps in one run (each one answers or calls tools). */
export const AGENT_MAX_STEPS = 8;
/** Runs shown in the list. */
export const AGENT_RUNS_SHOWN = 30;

export const AGENT_TOOLS = ["search_catalog", "write_copy", "generate_image"] as const;
export type AgentToolName = (typeof AGENT_TOOLS)[number];
export const isAgentTool = (value: unknown): value is AgentToolName => (AGENT_TOOLS as readonly unknown[]).includes(value);

/** Most calls of each tool in one run, so one goal can't spend a month of credits. */
export const AGENT_TOOL_CALLS: Record<AgentToolName, number> = { search_catalog: 5, write_copy: 3, generate_image: 3 };

/** Why a tool call failed: the tool's own codes, or a job code from the registry (quota, plan…). */
export type AgentToolErrorCode = "no_connection" | "catalog_error" | "sku_not_found" | "no_image" | "limit" | "invalid_input" | (string & {});

export type FoundProduct = { sku: string; name: string; nameAr: string | null; category: string | null; image: string | null };

/** What a finished tool call shows on the run screen (also what the model is told, minus nothing secret). */
export type AgentToolOutput =
  | { tool: "search_catalog"; query: string; products: FoundProduct[] }
  | { tool: "write_copy"; copyId: string; sku: string; productName: string; title: string; languages: string[] }
  | { tool: "generate_image"; generationId: string; sku: string; productName: string; url: string; width: number; height: number };

/** One block of a run, in order: the agent's words, or a tool call with its outcome. */
export type AgentStep =
  | { id: string; kind: "text"; text: string }
  | {
      id: string;
      kind: "tool";
      tool: AgentToolName;
      status: "running" | "ok" | "failed";
      /** The call's short description: the search words or the SKU. */
      label: string;
      output: AgentToolOutput | null;
      error: AgentToolErrorCode | null;
    };

export type AgentRunStatus = "running" | "ok" | "failed" | "stopped";

export type AgentRun = {
  id: string;
  goal: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type AgentRunSummary = Pick<AgentRun, "id" | "goal" | "status" | "createdAt">;

/** What the run screen receives while an agent works (one JSON object per line). */
export type AgentStreamEvent =
  | { type: "run"; run: AgentRun }
  | { type: "text"; stepId: string; text: string }
  | { type: "step"; step: AgentStep }
  /** The run as saved: `ok`, `stopped`, or `failed` with its code in `error`. */
  | { type: "done"; run: AgentRun }
  /** Nothing was done, so nothing was kept: the goal can be sent again. */
  | { type: "error"; code: string };

/** A goal as typed: trimmed, null when empty or too long. */
export function cleanGoal(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n/g, "\n").trim();
  return text && text.length <= AGENT_GOAL_MAX ? text : null;
}

const words = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
const singular = (w: string) => (w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("es") && /(ch|sh|x|s)es$/.test(w) ? w.slice(0, -2) : w.endsWith("s") ? w.slice(0, -1) : w);

/**
 * The preset category a catalog product most likely belongs to, from its catalog path and name
 * (a product type like "Sofas" or a category word). Falls back to the first preset.
 */
export function guessCategory(text: string): string {
  const seen = new Set(words(text).map(singular));
  let best = { key: categoryPresets[0].key, score: 0 };
  for (const preset of categoryPresets) {
    const types = preset.subcategories.map((s) => words(s).map(singular).join(" "));
    const score =
      types.filter((t) => t.split(" ").every((w) => seen.has(w))).length * 2 + (words(preset.key).map(singular).every((w) => seen.has(w)) ? 1 : 0);
    if (score > best.score) best = { key: preset.key, score };
  }
  return best.key;
}

/** Joins a text piece onto the run's last step when that is text, else starts a text step. */
export function appendText(steps: AgentStep[], text: string, newId: () => string): { steps: AgentStep[]; stepId: string } {
  const last = steps.at(-1);
  if (last?.kind === "text") return { steps: [...steps.slice(0, -1), { ...last, text: last.text + text }], stepId: last.id };
  const step: AgentStep = { id: newId(), kind: "text", text };
  return { steps: [...steps, step], stepId: step.id };
}
