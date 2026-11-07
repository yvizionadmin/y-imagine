import "server-only";
import { jobCost, planAllows } from "@/lib/credits";
import { monthlyAllowance } from "@/lib/platform/credit-adjustments";
import { getOrganization } from "@/lib/platform/organizations";
import { getPlatformSettings } from "@/lib/platform/settings";
import { reportError } from "@/lib/observability/report";
import { hit, LIMITS } from "@/lib/rate-limit";
import { startOfMonth } from "@/lib/time";
import { finishJob, startJob } from "@/lib/usage";
import { ProviderError, type ProviderErrorCode } from "./errors";
import { getModelPreference } from "./model-preferences";
import {
  IMAGE_PROVIDERS,
  imageModelsFor,
  isImageFeature,
  isTextFeature,
  pickModel,
  TEXT_PROVIDERS,
  textModelsFor,
  type TextProviderId,
  VIDEO_PROVIDERS,
  videoModelsFor,
  VISION_MODELS,
  type ImageProviderId,
  type ModelFeature,
  type TextFeature,
  type VideoProviderId,
} from "./models";
import { loadProviderKey, recordKeyCheck } from "./provider-keys";
import { createAiImageProvider } from "./providers/ai-sdk";
import { createAiTextProvider } from "./providers/ai-sdk-text";
import { createAiVideoProvider } from "./providers/ai-sdk-video";
import { createByteplusVideoProvider } from "./providers/byteplus-video";
import { demoVideoProvider } from "./providers/demo-video";
import { demoProvider } from "./providers/demo";
import { demoTextProvider } from "./providers/demo-text";
import type { AiProviderId } from "./providers-info";
import type { Feature, GeneratedImage, ImageProvider, ProviderId, TextProvider, VideoProvider } from "./types";
import { measureSwatch } from "@/lib/image/swatch";

/**
 * Who a job runs for. Passed explicitly (not read from the request) so the same code works from a
 * server action and from the background worker. A Workspace satisfies it.
 */
export type JobActor = { orgId: string; user: { id: string; name: string } };

const demoMode = () => process.env.IMAGINE_DEMO === "1";

/**
 * Single entry points for resolving an org's provider per tool: the tool's model preference when
 * its key is still valid, otherwise "Automatic" (the first connected provider that can serve the
 * tool, best model the key can call). With IMAGINE_DEMO=1, orgs without a usable key (or with an
 * offline `demo-…` key) get the built-in demo provider. Callers must not import providers directly.
 */
export async function getImageProvider(actor: JobActor, feature: Feature): Promise<ImageProvider> {
  const resolved = await resolveImageProvider(actor.orgId, feature);
  return resolved.ok ? withUsage(resolved.provider, actor, feature) : unavailable(resolved.code);
}

export async function getTextProvider(actor: JobActor, feature: TextFeature): Promise<TextProvider> {
  const resolved = await resolveTextProvider(actor.orgId, feature);
  if (!resolved.ok) {
    const refuse = async (): Promise<never> => {
      throw new ProviderError(resolved.code);
    };
    return { id: "demo", generateCopy: refuse, improvePrompt: refuse };
  }
  const provider = resolved.provider;
  return {
    id: provider.id,
    generateCopy: (request) => runJob(actor, feature, provider.id, () => provider.generateCopy(request), (r) => r.model),
    // A helper step (no credit, no usage event), so it gets its own per-user limit instead of the job limits.
    improvePrompt: async (request) => {
      if (!(await hit("prompt-rewrites", actor.user.id, LIMITS.promptRewritesPerUser)).ok) throw new ProviderError("rate_limited");
      return provider.improvePrompt(request);
    },
  };
}

/**
 * The org's video provider. `credits` is the job's cost (videoCost: length × resolution), reserved
 * when the job starts like every tool's. Called from the worker, which runs video jobs.
 */
export async function getVideoProvider(actor: JobActor, credits: number): Promise<VideoProvider> {
  const resolved = await resolveVideoProvider(actor.orgId);
  if (!resolved.ok) {
    return {
      id: "demo",
      model: "",
      generateVideo: async () => {
        throw new ProviderError(resolved.code);
      },
    };
  }
  const provider = resolved.provider;
  return {
    id: provider.id,
    model: provider.model,
    generateVideo: (request) => runJob(actor, "video", provider.id, () => provider.generateVideo(request), (r) => r.model, credits),
  };
}

/** The video model the org would use now (for the Studio's options), or why there is none. */
export async function videoModelFor(orgId: string): Promise<{ ok: true; model: string } | { ok: false; code: ProviderErrorCode }> {
  const resolved = await resolveVideoProvider(orgId);
  return resolved.ok ? { ok: true, model: resolved.provider.model } : resolved;
}

async function resolveVideoProvider(orgId: string): Promise<Resolved<VideoProvider>> {
  const { preference, order } = await providerOrder<VideoProviderId>(orgId, "video", VIDEO_PROVIDERS);
  for (const provider of order) {
    const stored = await loadProviderKey(orgId, provider);
    if (!stored || stored.status !== "valid") continue;
    const models = videoModelsFor(provider, stored.models);
    // The chosen model when its key can still call it, else the provider's best (Automatic).
    const model = preference?.provider === provider && models.includes(preference.model) ? preference.model : models[0];
    if (!model) continue;
    // An offline demo key keeps its provider's model, so the Studio shows that model's options.
    if (demoMode() && stored.key.startsWith("demo-")) return { ok: true, provider: provider === "byteplus" ? { ...demoVideoProvider, model } : demoVideoProvider };
    const onKeyRejected = keyRejected(orgId, provider);
    return {
      ok: true,
      provider:
        provider === "byteplus"
          ? createByteplusVideoProvider({ apiKey: stored.key, model, onKeyRejected })
          : createAiVideoProvider({ provider, apiKey: stored.key, model, onKeyRejected }),
    };
  }
  return demoMode() ? { ok: true, provider: demoVideoProvider } : { ok: false, code: "no_provider" };
}

/** Why no text provider can serve the tool right now, or null when one can (checked before queuing bulk work). */
export async function textProviderProblem(orgId: string, feature: TextFeature): Promise<ProviderErrorCode | null> {
  const resolved = await resolveTextProvider(orgId, feature);
  return resolved.ok ? null : resolved.code;
}

/** Why no image provider can serve the tool right now, or null when one can (checked before queuing bulk work). */
export async function imageProviderProblem(orgId: string, feature: Feature): Promise<ProviderErrorCode | null> {
  const resolved = await resolveImageProvider(orgId, feature);
  return resolved.ok ? null : resolved.code;
}

type Resolved<P> = { ok: true; provider: P } | { ok: false; code: ProviderErrorCode };

/** The tool's preferred provider first, then the rest in "Automatic" order. */
async function providerOrder<P extends AiProviderId>(orgId: string, feature: ModelFeature, all: readonly P[]) {
  const preference = await getModelPreference(orgId, feature);
  const preferred = preference && (all as readonly string[]).includes(preference.provider) ? (preference.provider as P) : null;
  return { preference, order: preferred ? [preferred, ...all.filter((p) => p !== preferred)] : [...all] };
}

const keyRejected = (orgId: string, provider: AiProviderId) => async () => void (await recordKeyCheck(orgId, provider, { ok: false, error: "invalid_key" }));

async function resolveImageProvider(orgId: string, feature: Feature): Promise<Resolved<ImageProvider>> {
  if (!isImageFeature(feature)) return { ok: false, code: "unsupported" };
  const { preference, order } = await providerOrder<ImageProviderId>(orgId, feature, IMAGE_PROVIDERS);

  for (const provider of order) {
    const stored = await loadProviderKey(orgId, provider);
    if (!stored || stored.status !== "valid") continue;
    if (demoMode() && stored.key.startsWith("demo-")) return { ok: true, provider: demoProvider };
    const models = imageModelsFor(provider, stored.models);
    const imageModel = preference?.provider === provider && models.includes(preference.model) ? preference.model : models[0];
    if (!imageModel) continue;
    return {
      ok: true,
      provider: createAiImageProvider({
        provider,
        apiKey: stored.key,
        imageModel,
        visionModel: pickModel(VISION_MODELS[provider], stored.models),
        onKeyRejected: keyRejected(orgId, provider),
      }),
    };
  }
  return demoMode() ? { ok: true, provider: demoProvider } : { ok: false, code: "no_provider" };
}

async function resolveTextProvider(orgId: string, feature: TextFeature): Promise<Resolved<TextProvider>> {
  if (!isTextFeature(feature)) return { ok: false, code: "unsupported" };
  const { preference, order } = await providerOrder<TextProviderId>(orgId, feature, TEXT_PROVIDERS);

  for (const provider of order) {
    const stored = await loadProviderKey(orgId, provider);
    if (!stored || stored.status !== "valid") continue;
    if (demoMode() && stored.key.startsWith("demo-")) return { ok: true, provider: demoTextProvider };
    const models = textModelsFor(provider, stored.models);
    const model = preference?.provider === provider && models.includes(preference.model) ? preference.model : models[0];
    if (!model) continue;
    return { ok: true, provider: createAiTextProvider({ provider, apiKey: stored.key, model, onKeyRejected: keyRejected(orgId, provider) }) };
  }
  return demoMode() ? { ok: true, provider: demoTextProvider } : { ok: false, code: "no_provider" };
}

/**
 * Stand-in when no provider can serve the tool: every job fails with `code` before reaching a
 * provider, so it isn't a usage event and costs no credit. Swatch analysis needs no provider.
 */
function unavailable(code: ProviderErrorCode): ImageProvider {
  const refuse = async (): Promise<never> => {
    throw new ProviderError(code);
  };
  return { id: "demo", createImage: refuse, generateLifestyle: refuse, analyzeSwatch: measureSwatch, recolor: refuse, generateAplus: refuse, generateLook: refuse, upscale: refuse };
}

// Methods that produce a job (one credit). analyzeSwatch is a helper step of Recolor, not a job.
const JOB_METHODS = ["createImage", "generateLifestyle", "recolor", "generateAplus", "generateLook", "upscale"] as const;

/**
 * Platform controls checked before a job reaches the provider: a feature switched off by a super
 * admin, a tool the org's plan doesn't include, per-user and per-org rate limits (bursts, scripts),
 * and the org's monthly credits: the tool's cost from Admin → Credits is reserved atomically, so
 * parallel jobs can't overshoot.
 * Blocked jobs are not usage events. Returns the usage event id of the reserved job.
 */
async function reserveJob(actor: JobActor, feature: Feature, provider: ProviderId, credits?: number) {
  const [settings, org] = await Promise.all([getPlatformSettings(), getOrganization(actor.orgId)]);
  if (settings.disabledFeatures.includes(feature)) throw new ProviderError("feature_disabled");
  if (!org) throw new ProviderError("generation_failed");
  if (!planAllows(settings.creditRules, org.plan, feature)) throw new ProviderError("not_in_plan");
  const [perUser, perOrg] = await Promise.all([hit("jobs-user", actor.user.id, LIMITS.jobsPerUser), hit("jobs-org", actor.orgId, LIMITS.jobsPerOrg)]);
  if (!perUser.ok || !perOrg.ok) throw new ProviderError("rate_limited");
  const jobId = await startJob({
    orgId: actor.orgId,
    feature,
    userId: actor.user.id,
    userName: actor.user.name,
    provider,
    quota: await monthlyAllowance(org, settings.creditRules),
    since: startOfMonth(),
    credits: credits ?? jobCost(settings.creditRules, feature),
  });
  if (!jobId) throw new ProviderError("quota_exceeded");
  return jobId;
}

/** Reserves a credit, runs the job, and records the outcome (user, model, error, duration). */
async function runJob<T>(actor: JobActor, feature: Feature, provider: ProviderId, call: () => Promise<T>, modelOf: (result: T) => string | null, credits?: number): Promise<T> {
  const jobId = await reserveJob(actor, feature, provider, credits);
  const started = performance.now();
  const finish = (ok: boolean, error: string | null, model: string | null) =>
    finishJob(actor.orgId, jobId, { ok, error, model, durationMs: Math.round(performance.now() - started) }).catch((e) =>
      reportError("finishJob failed", e, { orgId: actor.orgId, feature }),
    );
  try {
    const result = await call();
    await finish(true, null, modelOf(result));
    return result;
  } catch (error) {
    await finish(false, error instanceof ProviderError ? error.code : "generation_failed", null);
    throw error;
  }
}

function withUsage(provider: ImageProvider, actor: JobActor, feature: Feature): ImageProvider {
  const wrapped = { ...provider };
  for (const method of JOB_METHODS) {
    const call = provider[method].bind(provider) as (request: unknown) => Promise<GeneratedImage | { image: GeneratedImage }>;
    (wrapped as Record<string, unknown>)[method] = (request: unknown) =>
      runJob(actor, feature, provider.id, () => call(request), (result) => ("image" in result ? result.image : result).model);
  }
  return wrapped;
}
