import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getRedis } from "@/lib/redis";

// Railway health check (web service). Public, no details beyond up/down per dependency.
export async function GET() {
  await connection();
  const [database, redis] = await Promise.all([
    db.execute(sql`select 1`).then(() => "up", () => "down"),
    getRedis()?.ping().then(() => "up", () => "down") ?? Promise.resolve("not_configured"),
  ]);
  const ok = database === "up" && redis !== "down";
  return Response.json({ ok, database, redis }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
