import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/** Applies every migrations/*.sql file once, in name order. Safe to run repeatedly. */
export async function migrate(databaseUrl: string): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const applied: string[] = [];
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const [done] = await sql`SELECT 1 FROM schema_migrations WHERE name = ${file}`;
      if (done) continue;
      const body = await readFile(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      applied.push(file);
    }
  } finally {
    await sql.end();
  }
  return applied;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  migrate(url)
    .then((a) => {
      console.log(a.length ? `applied: ${a.join(", ")}` : "nothing to apply");
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
