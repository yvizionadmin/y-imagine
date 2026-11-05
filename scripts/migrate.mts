import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Applies pending migrations from ./drizzle. Runs as Railway's pre-deploy command and locally via
// `npm run db:migrate`. Uses its own single connection, separate from the app pool.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
await client.end();
console.log("migrations applied");
