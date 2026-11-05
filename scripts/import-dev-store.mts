import { readFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";

// One-off: copies the local JSON store (.data/dev-store.json, used before Postgres) into the
// database. Idempotent: rows that already exist are skipped. Asset bytes stay in .data/assets,
// which is where the local blob store reads them from.
//   npm run db:migrate && npm run db:import-dev-store

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

type Row = Record<string, unknown>;
const file = path.join(process.cwd(), ".data", "dev-store.json");
const store = JSON.parse(await readFile(file, "utf8")) as Record<string, Row[]>;
const rows = (name: string) => store[name] ?? [];

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema, casing: "snake_case" });

const now = new Date().toISOString();
const seeded = new Set(rows("roomBackgroundsSeeded").map((r) => r.orgId));
const members = rows("members");

// Old usage events carry only the display name; recover the user id from the org's members.
const userIdFor = (e: Row) => members.find((m) => m.orgId === e.orgId && m.name === e.userName && m.userId)?.userId ?? null;

const plan: [string, PgTable, Row[]][] = [
  ["organizations", schema.organizations, rows("organizations").map((o) => ({ ...o, roomBackgroundsSeeded: seeded.has(o.id) }))],
  ["users", schema.users, rows("users")],
  ["sessions", schema.sessions, rows("sessions").filter((s) => String(s.expiresAt) > now)],
  ["platform_settings", schema.platformSettings, rows("platformSettings").slice(0, 1).map((s) => ({ ...s, id: 1 }))],
  ["members", schema.members, members],
  ["audit_log", schema.auditLog, rows("auditLog").map((e) => ({ ...e, meta: e.meta ?? null }))],
  ["usage_events", schema.usageEvents, rows("usageEvents").map((e) => ({ ...e, status: e.ok ? "ok" : "error", userId: userIdFor(e) }))],
  ["assets", schema.assets, rows("assets")],
  ["generations", schema.generations, rows("generations")],
  ["looks", schema.looks, rows("looks").map((l) => ({ ...l, mode: l.mode ?? "generated" }))],
  ["room_backgrounds", schema.roomBackgrounds, rows("roomBackgrounds")],
  ["provider_credentials", schema.providerCredentials, rows("providerCredentials")],
  ["catalog_connections", schema.catalogConnections, rows("catalogConnections")],
  ["bitly_connections", schema.bitlyConnections, rows("bitlyConnections")],
  ["short_links", schema.shortLinks, rows("shortLinks")],
];

const orgIds = new Set(rows("organizations").map((o) => o.id));
for (const [name, table, list] of plan) {
  // Tenant rows of an org that no longer exists would fail the foreign key.
  const valid = "orgId" in table && name !== "audit_log" && name !== "sessions" ? list.filter((r) => orgIds.has(r.orgId)) : list;
  const inserted = valid.length ? await db.insert(table).values(valid).onConflictDoNothing().returning() : [];
  console.log(`${name.padEnd(22)} ${inserted.length}/${list.length} imported`);
}

await client.end();
