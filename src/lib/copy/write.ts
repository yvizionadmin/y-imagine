import "server-only";
import { getTextProvider, type JobActor } from "@/lib/ai/registry";
import type { ImageInput } from "@/lib/ai/types";
import { getBrandKit } from "@/lib/brand/brand-kit";
import { insertCopy, type CopySettings, type SavedCopy } from "./copies";

/** Writes one product's copy through the org's text provider (one credit) and saves it. Throws ProviderError. */
export async function writeCopy(actor: JobActor, input: { sku: string; productName: string; settings: CopySettings; image: ImageInput | null }): Promise<SavedCopy> {
  const { brandVoice = true, ...style } = input.settings;
  const provider = await getTextProvider(actor, "copy");
  const kit = brandVoice ? await getBrandKit(actor.orgId) : null;
  const brand = kit && { name: kit.name, about: kit.about, voice: kit.voice, audience: kit.audience, useWords: kit.useWords, avoidWords: kit.avoidWords, rules: kit.rules };
  const result = await provider.generateCopy({ sku: input.sku, productName: input.productName, image: input.image, ...style, brand });
  return insertCopy({
    orgId: actor.orgId,
    sku: input.sku,
    productName: input.productName,
    settings: { ...style, brandVoice },
    copy: result.copy,
    provider: result.provider,
    model: result.model,
    createdBy: actor.user.name,
    createdById: actor.user.id,
  });
}
