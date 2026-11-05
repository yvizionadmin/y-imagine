import "server-only";
import { and, eq, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

// Postgres connection (Railway Postgres in production, brew postgresql@17 locally). Tenant data is
// read and written through db.forOrg(orgId), which adds `org_id = orgId` to every statement, so a
// repository can't forget the tenant filter. Platform tables use `db` directly.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// One pool per process; dev HMR re-evaluates modules, so reuse it across reloads.
const globalForDb = globalThis as unknown as { imaginePg?: postgres.Sql };
const client = (globalForDb.imaginePg ??= postgres(url, {
  max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  // Timestamps come back as text; UTC keeps them in one shape for the ISO conversion in the schema.
  connection: { TimeZone: "UTC" },
}));

const base = drizzle(client, { schema, casing: "snake_case" });

export type Db = typeof base;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

type OrgTable = PgTable & { orgId: AnyPgColumn };
type Row<T extends OrgTable> = T["$inferSelect"];
type NewRow<T extends OrgTable> = Omit<T["$inferInsert"], "orgId">;
type Order = (AnyPgColumn | SQL)[];

/** Tenant-scoped queries: every statement is limited to `orgId`, and inserts get it set. */
function forOrg(orgId: string, executor: Executor = base) {
  const scope = (table: OrgTable, where?: SQL) => and(eq(table.orgId, orgId), where)!;
  return {
    orgId,
    async select<T extends OrgTable>(table: T, where?: SQL, options: { orderBy?: Order; limit?: number } = {}): Promise<Row<T>[]> {
      let query = executor
        .select()
        .from(table as PgTable)
        .where(scope(table, where))
        .$dynamic();
      if (options.orderBy) query = query.orderBy(...options.orderBy);
      if (options.limit) query = query.limit(options.limit);
      return (await query) as Row<T>[];
    },
    async first<T extends OrgTable>(table: T, where?: SQL): Promise<Row<T> | null> {
      const [row] = await this.select(table, where, { limit: 1 });
      return row ?? null;
    },
    async insert<T extends OrgTable>(table: T, values: NewRow<T> | NewRow<T>[]): Promise<Row<T>[]> {
      const rows = (Array.isArray(values) ? values : [values]).map((v) => ({ ...v, orgId }));
      if (rows.length === 0) return [];
      return (await executor.insert(table).values(rows as T["$inferInsert"][]).returning()) as Row<T>[];
    },
    async update<T extends OrgTable>(table: T, set: Partial<NewRow<T>>, where?: SQL): Promise<Row<T>[]> {
      return (await executor
        .update(table)
        .set(set as never)
        .where(scope(table, where))
        .returning()) as Row<T>[];
    },
    async delete<T extends OrgTable>(table: T, where?: SQL): Promise<Row<T>[]> {
      return (await executor.delete(table).where(scope(table, where)).returning()) as Row<T>[];
    },
  };
}

export type OrgScope = ReturnType<typeof forOrg>;

export const db = Object.assign(base, { forOrg });
export { schema };
