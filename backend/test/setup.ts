import { beforeAll, afterAll, beforeEach } from "vitest";
import { migrate } from "../src/migrate.js";
import { resetConfig } from "../src/config.js";
import { db, closeDb } from "../src/db.js";
import { mailOutbox } from "../src/senders/email.js";
import { memoryOutbox } from "../src/slack/client.js";
import { memoryQueue } from "../src/jobs/queue.js";
import { resetRateLimits } from "../src/http/leads.js";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://ops:ops@localhost:5432/ops_test";

export function useTestDb(): void {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.MAIL_TRANSPORT = "log";
    process.env.OPS_MCP_TOKENS = "tester:t0ken,agent-followup:agent-token";
    process.env.PUBLIC_URL = "http://test.local";
    process.env.FILES_DIR = "/tmp/ew-ops-test-files";
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.TWENTY_API_URL;
    delete process.env.ANTHROPIC_API_KEY;
    resetConfig();
    await migrate(TEST_DB);
  });
  beforeEach(async () => {
    const sql = db();
    await sql`TRUNCATE events, approvals, messages, consents, drafts, jobs, tool_runs, content_metrics, content_assets, content_items, invoices, contacts, sequence_counters RESTART IDENTITY CASCADE`;
    await sql`UPDATE settings SET value = 'false' WHERE key = 'sends_paused'`;
    await sql`UPDATE settings SET value = '[]' WHERE key = 'safe_send_types'`;
    await sql`UPDATE settings SET value = '60' WHERE key = 'daily_send_cap'`;
    mailOutbox.length = 0;
    memoryOutbox.length = 0;
    memoryQueue.length = 0;
    resetRateLimits();
  });
  afterAll(async () => {
    await closeDb();
  });
}

export async function seedContact(over: Record<string, unknown> = {}): Promise<{ id: string; email: string }> {
  const sql = db();
  const base = {
    first_name: "Asha",
    last_name: "Mehta",
    email: `asha.${Math.random().toString(36).slice(2, 8)}@example.com`,
    stage: "Qualified",
    email_consent: true,
    consent_at: new Date(),
    lead_source: "website_form",
    ...over,
  };
  const [row] = await sql`INSERT INTO contacts ${sql(base as never)} RETURNING id, email`;
  return row as { id: string; email: string };
}
