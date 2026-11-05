import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Once per run: create the test database if needed, apply migrations, empty every table.
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/imagine_test");
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("test")) throw new Error(`Refusing to use "${name}" as the test database`);

  const admin = postgres({ ...pgOptions(url), database: "postgres", max: 1, onnotice: () => {} });
  const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists) await admin.unsafe(`create database "${name}"`);
  await admin.end();

  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  const tables = await client<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  if (tables.length) await client.unsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} cascade`);
  await client.end();
  await rm(".data/test-assets", { recursive: true, force: true });
}

function pgOptions(url: URL) {
  return { host: url.hostname, port: Number(url.port || 5432), username: decodeURIComponent(url.username) || undefined, password: decodeURIComponent(url.password) || undefined };
}
