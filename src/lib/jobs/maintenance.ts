import "server-only";
import { releaseStaleRuns } from "@/lib/agent/runs";
import { releaseStaleDirectors } from "@/lib/director/projects";
import { listAllKeyRefs, recordKeyCheck, revealProviderKey } from "@/lib/ai/provider-keys";
import { checkProviderKey } from "@/lib/ai/validate-key";
import { recordAudit } from "@/lib/audit";
import { reportError } from "@/lib/observability/report";
import { releaseStaleItems } from "@/lib/copy/batches";
import { releaseStaleImageItems } from "@/lib/image-batch/batches";
import { releaseStaleJobs } from "@/lib/usage";
import { releaseStaleVideoJobs } from "@/lib/video/jobs";
import { releaseStaleRenders } from "@/lib/editor/edits";

export { cleanupOldVideos } from "@/lib/video/storage";

// Scheduled platform jobs, run by the worker (src/worker.ts). Each returns a small summary for the log.

const KEY_CHECK_CONCURRENCY = 4;

/**
 * Re-checks every stored provider key, so a key revoked at the provider shows as invalid in Settings
 * (and stops being routed to) before a job fails on it. Only a change is audited, to keep the log readable.
 */
export async function revalidateAllKeys() {
  const refs = await listAllKeyRefs();
  const summary = { checked: 0, valid: 0, invalid: 0, unchanged: 0, failed: 0 };
  for (let i = 0; i < refs.length; i += KEY_CHECK_CONCURRENCY) {
    await Promise.all(
      refs.slice(i, i + KEY_CHECK_CONCURRENCY).map(async (ref) => {
        try {
          const key = await revealProviderKey(ref.orgId, ref.provider);
          if (!key) return;
          const check = await checkProviderKey(ref.provider, key);
          const view = await recordKeyCheck(ref.orgId, ref.provider, check);
          summary.checked++;
          summary[view?.status === "valid" ? "valid" : "invalid"]++;
          const error = check.ok ? null : check.error;
          if (view?.status === ref.status && error === ref.lastError) {
            summary.unchanged++;
            return;
          }
          await recordAudit({
            orgId: ref.orgId,
            action: "provider_key.validated",
            actor: "Imagine AI",
            target: ref.provider,
            meta: { result: check.ok ? "valid" : check.error, via: "scheduled" },
          });
        } catch (error) {
          summary.failed++;
          reportError("key re-validation failed", error, { orgId: ref.orgId, provider: ref.provider });
        }
      }),
    );
  }
  return summary;
}

export async function closeStaleJobs() {
  return {
    closed: await releaseStaleJobs(),
    batchItems: await releaseStaleItems(),
    imageItems: await releaseStaleImageItems(),
    videoJobs: await releaseStaleVideoJobs(),
    editRenders: await releaseStaleRenders(),
    agentRuns: await releaseStaleRuns(),
    directors: await releaseStaleDirectors(),
  };
}
