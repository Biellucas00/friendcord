import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./db.js";
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");
await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, run_at TIMESTAMPTZ DEFAULT now())");
for (const name of (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort()) {
  const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]);
  if (!exists.rowCount) { const client = await pool.connect(); try { await client.query("BEGIN"); await client.query(await readFile(join(migrationsDir, name), "utf8")); await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]); await client.query("COMMIT"); console.log(`Aplicada: ${name}`); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
await pool.end();
