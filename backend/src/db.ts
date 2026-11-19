import postgres, { type Sql } from "postgres";
import { config } from "./config.js";

let client: Sql | undefined;

/** One shared postgres client. Tests call closeDb() between suites. */
export function db(): Sql {
  if (!client) {
    client = postgres(config().DATABASE_URL, {
      max: 10,
      onnotice: () => {},
      transform: { undefined: null },
      // Keep SQL date columns as YYYY-MM-DD strings; only timestamptz becomes a JS Date.
      types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
    });
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
  }
}

export async function getSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  const [row] = await db()`SELECT value FROM settings WHERE key = ${key}`;
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db()`INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${db().json(value as never)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}
