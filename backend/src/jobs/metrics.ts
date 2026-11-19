import { config } from "../config.js";
import { db } from "../db.js";
import { recordEvent } from "../events.js";
import { log } from "../log.js";
import { addDays, indiaDate } from "../time.js";

/**
 * Phase 3 data sources. Pulls yesterday's numbers into content_metrics. Umami and Search Console each run only
 * when their credentials are set; the shapes below follow the public APIs and need one live check on install.
 */
async function upsertMetric(source: string, day: string, metric: string, value: number, dims: Record<string, unknown>, contentItemId: string | null = null): Promise<void> {
  await db()`INSERT INTO content_metrics (source, day, metric, value, dims, content_item_id)
    VALUES (${source}, ${day}, ${metric}, ${value}, ${db().json(dims as never)}, ${contentItemId})
    ON CONFLICT (source, day, metric, dims) DO UPDATE SET value = EXCLUDED.value, content_item_id = coalesce(EXCLUDED.content_item_id, content_metrics.content_item_id)`;
}

async function contentItemForPath(path: string): Promise<string | null> {
  const slug = path.replace(/^\/+|\/+$/g, "").split("/").pop();
  if (!slug) return null;
  const [row] = await db()`SELECT id FROM content_items WHERE slug = ${slug} OR published_url LIKE ${`%${path}`} LIMIT 1`;
  return row?.id ?? null;
}

export async function pullUmami(day: string = addDays(indiaDate(), -1)): Promise<number> {
  const c = config();
  if (!c.UMAMI_API_URL || !c.UMAMI_API_TOKEN || !c.UMAMI_WEBSITE_ID) return 0;
  const start = new Date(`${day}T00:00:00+05:30`).getTime();
  const end = new Date(`${day}T23:59:59+05:30`).getTime();
  const headers = { Authorization: `Bearer ${c.UMAMI_API_TOKEN}` };
  const base = `${c.UMAMI_API_URL.replace(/\/$/, "")}/api/websites/${c.UMAMI_WEBSITE_ID}`;
  let n = 0;
  const stats = await fetch(`${base}/stats?startAt=${start}&endAt=${end}`, { headers }).then((r) => r.json() as Promise<{ pageviews?: { value: number }; visitors?: { value: number } }>);
  await upsertMetric("umami", day, "pageviews", stats.pageviews?.value ?? 0, { scope: "site" });
  await upsertMetric("umami", day, "visitors", stats.visitors?.value ?? 0, { scope: "site" });
  n += 2;
  const pages = await fetch(`${base}/metrics?startAt=${start}&endAt=${end}&type=url&limit=200`, { headers }).then((r) => r.json() as Promise<Array<{ x: string; y: number }>>);
  for (const p of pages) {
    await upsertMetric("umami", day, "pageviews", p.y, { path: p.x }, await contentItemForPath(p.x));
    n++;
  }
  return n;
}

export async function pullSearchConsole(day: string = addDays(indiaDate(), -3)): Promise<number> {
  const c = config();
  if (!c.GSC_SERVICE_ACCOUNT_JSON || !c.GSC_SITE_URL) return 0;
  const token = await googleAccessToken(JSON.parse(c.GSC_SERVICE_ACCOUNT_JSON) as { client_email: string; private_key: string }, "https://www.googleapis.com/auth/webmasters.readonly");
  const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(c.GSC_SITE_URL)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: day, endDate: day, dimensions: ["query", "page"], rowLimit: 1000 }),
  });
  if (!res.ok) throw new Error(`Search Console: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; position: number }> };
  let n = 0;
  for (const r of data.rows ?? []) {
    const [query, page] = r.keys;
    const path = new URL(page).pathname;
    const item = await contentItemForPath(path);
    await upsertMetric("gsc", day, "clicks", r.clicks, { query, page: path }, item);
    await upsertMetric("gsc", day, "impressions", r.impressions, { query, page: path }, item);
    await upsertMetric("gsc", day, "position", r.position, { query, page: path }, item);
    n += 3;
  }
  return n;
}

/** Service-account JWT exchange for a Google access token. */
async function googleAccessToken(sa: { client_email: string; private_key: string }, scope: string): Promise<string> {
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Google token: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function pullMetrics(): Promise<void> {
  const results: Record<string, number | string> = {};
  for (const [name, fn] of [["umami", pullUmami], ["gsc", pullSearchConsole]] as const) {
    try {
      results[name] = await fn();
    } catch (err) {
      log.warn({ err, name }, "metrics pull failed");
      results[name] = `error: ${String(err).slice(0, 200)}`;
    }
  }
  await recordEvent({ type: "metrics_pulled", payload: results });
}
