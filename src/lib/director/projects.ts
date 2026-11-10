import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { DirectorScene, DirectorSettings, DirectorStatus, DirectorStep } from "./limits";

// AI Director projects (director_projects). Tenant data through db.forOrg, except the scheduled
// stale-project sweep, which spans orgs like the other maintenance jobs.

const { directorProjects } = schema;

export type DirectorProject = typeof directorProjects.$inferSelect;

/** How long one worker holds a project while it advances it (the longest step is a few image calls). */
const LOCK_MS = 5 * 60_000;
/** A project in a working step that hasn't changed for this long is closed (a lost job). */
export const STALE_DIRECTOR_MS = 2 * 60 * 60_000;
const WORKING: DirectorStatus[] = ["planning", "storyboard", "filming", "assembling"];

export async function insertDirector(input: { orgId: string; idea: string; settings: DirectorSettings; createdBy: string; createdById: string }) {
  const { orgId, ...values } = input;
  const [row] = await db.forOrg(orgId).insert(directorProjects, { ...values, id: randomUUID(), status: "planning" });
  return row;
}

export async function getDirector(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return db.forOrg(orgId).first(directorProjects, eq(directorProjects.id, id));
}

export async function listDirectors(orgId: string, limit = 50) {
  return db.forOrg(orgId).select(directorProjects, undefined, { orderBy: [desc(directorProjects.updatedAt)], limit });
}

export async function countDirectors(orgId: string) {
  return (await db.forOrg(orgId).select(directorProjects)).length;
}

export async function updateDirector(
  orgId: string,
  id: string,
  patch: Partial<Pick<DirectorProject, "title" | "scenes" | "status" | "failedStep" | "error" | "voiceAssetId" | "editId">>,
) {
  const [row] = await db.forOrg(orgId).update(directorProjects, { ...patch, updatedAt: new Date().toISOString() }, eq(directorProjects.id, id));
  return row ?? null;
}

export async function saveScenes(orgId: string, id: string, scenes: DirectorScene[]) {
  return updateDirector(orgId, id, { scenes });
}

/** Takes the project for one worker; null when another holds it (it will look again when done). */
export async function lockDirector(orgId: string, id: string) {
  const now = new Date();
  const [row] = await db
    .forOrg(orgId)
    .update(
      directorProjects,
      { lockedUntil: new Date(now.getTime() + LOCK_MS).toISOString() },
      and(eq(directorProjects.id, id), or(isNull(directorProjects.lockedUntil), lt(directorProjects.lockedUntil, now.toISOString()))),
    );
  return row ?? null;
}

export async function unlockDirector(orgId: string, id: string) {
  await db.forOrg(orgId).update(directorProjects, { lockedUntil: null }, eq(directorProjects.id, id));
}

/** The project whose finished video is this editor project, if any. */
export async function directorForEdit(orgId: string, editId: string) {
  return db.forOrg(orgId).first(directorProjects, eq(directorProjects.editId, editId));
}

/** Sends a failed project back to the step it stopped in; scenes that failed start over. */
export async function resumeDirector(orgId: string, id: string, step: DirectorStep, scenes: DirectorScene[]) {
  const [row] = await db
    .forOrg(orgId)
    .update(
      directorProjects,
      { status: step, failedStep: null, error: null, scenes, updatedAt: new Date().toISOString() },
      and(eq(directorProjects.id, id), eq(directorProjects.status, "failed")),
    );
  return row ?? null;
}

export async function deleteDirector(orgId: string, id: string) {
  const [row] = await db.forOrg(orgId).delete(directorProjects, eq(directorProjects.id, id));
  return row ?? null;
}

/** Platform maintenance: fails projects stuck in a working step (their job was lost). Returns how many. */
export async function releaseStaleDirectors() {
  const cutoff = new Date(Date.now() - STALE_DIRECTOR_MS).toISOString();
  const stuck = await db
    .select({ id: directorProjects.id, orgId: directorProjects.orgId, status: directorProjects.status })
    .from(directorProjects)
    .where(and(inArray(directorProjects.status, WORKING), lt(directorProjects.updatedAt, cutoff)));
  for (const row of stuck) {
    await db
      .update(directorProjects)
      .set({ status: "failed", failedStep: row.status as DirectorStep, error: "timed_out", lockedUntil: null, updatedAt: new Date().toISOString() })
      .where(and(eq(directorProjects.id, row.id), eq(directorProjects.status, row.status)));
  }
  return stuck.length;
}
