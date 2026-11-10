import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "@/lib/db";
import { getGenerations, imageApprovalRequired, updateGenerations } from "@/lib/generations";
import { reportError } from "@/lib/observability/report";
import { readAsset } from "@/lib/storage/assets";
import { loadConnection } from "./connections";
import { canPublish, createConnector } from "./registry";
import { CatalogError, type CatalogErrorCode } from "./types";

// History → Upload to Website (B8): one queued job per image, like the other bulk work. The click
// claims the images (`publishing`), each job uploads one through the org's default store connection
// and records the store's media id, so a retried job never uploads the same image twice.

export type PublishOutcome = "done" | "failed" | "retry" | "skipped";

/** Longest edge sent to a store (Shopify's limit is 5000 px; most themes show far less). */
const MAX_EDGE = 4096;
/** An upload still `publishing` this long after it started was lost (crash, deploy). */
export const STALE_PUBLISH_MS = 30 * 60_000;

const { generations } = schema;

/** The image as a store expects it: JPEG (PNG only when it has transparency), at most MAX_EDGE. */
export async function storeImage(bytes: Uint8Array) {
  const image = sharp(bytes).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
  const { hasAlpha } = await sharp(bytes).metadata();
  return hasAlpha
    ? { bytes: new Uint8Array(await image.png().toBuffer()), mimeType: "image/png", ext: "png" }
    : { bytes: new Uint8Array(await image.jpeg({ quality: 90, mozjpeg: true }).toBuffer()), mimeType: "image/jpeg", ext: "jpg" };
}

/** Takes images for upload (pending or failed ones only); returns the ids this click owns. */
export async function claimForPublish(orgId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .forOrg(orgId)
    .update(
      generations,
      { status: "publishing", publishError: null, publishStartedAt: new Date().toISOString() },
      and(inArray(generations.id, ids), inArray(generations.status, ["pending", "failed"])),
    );
  return rows.map((r) => r.id);
}

export async function runPublish(orgId: string, generationId: string): Promise<PublishOutcome> {
  const [generation] = await getGenerations(orgId, [generationId]);
  if (!generation || generation.status !== "publishing") return "skipped";
  const fail = async (code: CatalogErrorCode | "not_approved" | "no_target") => {
    await updateGenerations(orgId, [generation.id], { status: "failed", publishError: code, publishStartedAt: null });
    return "failed" as const;
  };

  // Already on the store (a retry after the upload went through): just record it.
  if (generation.publishRef) {
    await updateGenerations(orgId, [generation.id], { status: "uploaded", publishStartedAt: null });
    return "done";
  }
  // The publish gate is checked again here: approvals can change while the job waits.
  if ((await imageApprovalRequired(orgId)) && generation.reviewStatus !== "approved") return fail("not_approved");
  const loaded = await loadConnection(orgId);
  if (!loaded || !canPublish(loaded.connection.type)) return fail("no_target");

  try {
    const image = await storeImage(new Uint8Array(await readAsset(orgId, generation.assetId, generation.mimeType)));
    const { ref } = await createConnector(loaded.connection.type, loaded.settings).publishImage!(generation.sku, {
      bytes: image.bytes,
      mimeType: image.mimeType,
      filename: `${generation.sku.replace(/[^A-Za-z0-9_-]/g, "_")}_${generation.mode}_${generation.id.slice(0, 8)}.${image.ext}`,
      alt: generation.title || generation.sku,
    });
    await updateGenerations(orgId, [generation.id], {
      status: "uploaded",
      publishedTo: loaded.connection.name,
      publishedAt: new Date().toISOString(),
      publishError: null,
      publishRef: ref ?? `uploaded-${Date.now()}`,
      publishStartedAt: null,
    });
    return "done";
  } catch (error) {
    if (error instanceof CatalogError && error.code === "rate_limited") return "retry";
    if (!(error instanceof CatalogError)) reportError("store upload failed", error, { orgId, connector: loaded.connection.type });
    return fail(error instanceof CatalogError ? error.code : "bad_response");
  }
}

/** Platform maintenance: fails uploads stuck in `publishing` (their job was lost). Returns how many. */
export async function releaseStalePublishes() {
  const rows = await db
    .update(generations)
    .set({ status: "failed", publishError: "unreachable", publishStartedAt: null })
    .where(and(eq(generations.status, "publishing"), lt(generations.publishStartedAt, new Date(Date.now() - STALE_PUBLISH_MS).toISOString())))
    .returning({ id: generations.id });
  return rows.length;
}
