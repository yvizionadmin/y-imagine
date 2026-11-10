import "server-only";
import { reportError } from "@/lib/observability/report";
import { directorForEdit } from "./projects";

// Tells a Director project that something it waits on has finished: one of its scene videos, or the
// render of its editor project. Imported lazily by those runners so they don't load the Director.

export async function sceneVideoFinished(orgId: string, directorId: string | undefined) {
  if (!directorId) return;
  const { dispatchDirector } = await import("./queue");
  await dispatchDirector(orgId, directorId).catch((error) => reportError("director notify failed", error, { orgId }));
}

export async function editRenderFinished(orgId: string, editId: string) {
  const director = await directorForEdit(orgId, editId);
  if (!director) return;
  const { dispatchDirector } = await import("./queue");
  await dispatchDirector(orgId, director.id).catch((error) => reportError("director notify failed", error, { orgId }));
}
