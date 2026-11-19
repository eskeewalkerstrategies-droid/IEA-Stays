import { readFile } from "node:fs/promises";
import os from "node:os";
import { statfs } from "node:fs/promises";
import { config } from "../config.js";
import { db, getSetting } from "../db.js";
import * as slack from "../slack/client.js";
import { linkedInDaysLeft } from "../senders/linkedin.js";

/**
 * Morning health check posted to Slack. A quiet morning with no message means the check itself failed,
 * so treat silence as an alarm.
 */
export interface Health {
  agents_ran: Array<{ actor: string; jobs_done: number }>;
  jobs_waiting: number;
  jobs_stale: number;
  drafts_pending: number;
  sends_failed_24h: number;
  sends_out_24h: number;
  inbound_24h: number;
  sends_paused: boolean;
  safe_send_types: string[];
  memory_free_mb: number;
  disk_free_gb: number | null;
  backup_age_hours: number | null;
  linkedin_days_left: number | null;
}

export async function collectHealth(): Promise<Health> {
  const sql = db();
  const [agents, waiting, stale, pending, failed, out, inbound] = await Promise.all([
    sql`SELECT actor, count(*)::int AS jobs_done FROM events WHERE type = 'job_done' AND created_at > now() - interval '24 hours' GROUP BY actor ORDER BY actor`,
    sql`SELECT count(*)::int AS n FROM jobs WHERE status = 'queued' AND due_at <= now()`,
    sql`SELECT count(*)::int AS n FROM jobs WHERE status = 'taken' AND taken_at < now() - interval '2 hours'`,
    sql`SELECT count(*)::int AS n FROM drafts WHERE status = 'pending_approval'`,
    sql`SELECT count(*)::int AS n FROM events WHERE type = 'send_failed' AND created_at > now() - interval '24 hours'`,
    sql`SELECT count(*)::int AS n FROM messages WHERE direction = 'out' AND occurred_at > now() - interval '24 hours'`,
    sql`SELECT count(*)::int AS n FROM messages WHERE direction = 'in' AND occurred_at > now() - interval '24 hours'`,
  ]);
  let disk: number | null = null;
  try {
    const s = await statfs(config().FILES_DIR).catch(() => statfs("/"));
    disk = Math.round((Number(s.bavail) * Number(s.bsize)) / 1e9 * 10) / 10;
  } catch {
    disk = null;
  }
  let backupAge: number | null = null;
  if (config().BACKUP_STATUS_FILE) {
    try {
      const stamp = (await readFile(config().BACKUP_STATUS_FILE!, "utf8")).trim();
      backupAge = Math.round((Date.now() - new Date(stamp).getTime()) / 3_600_000);
    } catch {
      backupAge = null;
    }
  }
  return {
    agents_ran: agents as never,
    jobs_waiting: waiting[0].n,
    jobs_stale: stale[0].n,
    drafts_pending: pending[0].n,
    sends_failed_24h: failed[0].n,
    sends_out_24h: out[0].n,
    inbound_24h: inbound[0].n,
    sends_paused: await getSetting<boolean>("sends_paused", false),
    safe_send_types: await getSetting<string[]>("safe_send_types", []),
    memory_free_mb: Math.round(os.freemem() / 1e6),
    disk_free_gb: disk,
    backup_age_hours: backupAge,
    linkedin_days_left: await linkedInDaysLeft(),
  };
}

export function formatHealth(h: Health): string {
  const warn: string[] = [];
  if (h.sends_failed_24h > 0) warn.push(`${h.sends_failed_24h} failed sends`);
  if (h.jobs_stale > 0) warn.push(`${h.jobs_stale} jobs stuck in "taken"`);
  if (h.backup_age_hours != null && h.backup_age_hours > 36) warn.push(`last backup ${h.backup_age_hours}h ago`);
  if (h.backup_age_hours == null && config().BACKUP_STATUS_FILE) warn.push("backup status unknown");
  if (h.linkedin_days_left != null && h.linkedin_days_left <= 7) warn.push(`LinkedIn token expires in ${h.linkedin_days_left} days: open /auth/linkedin`);
  if (h.disk_free_gb != null && h.disk_free_gb < 5) warn.push(`disk low: ${h.disk_free_gb} GB free`);
  if (h.sends_paused) warn.push("sends are PAUSED");
  const agents = h.agents_ran.length ? h.agents_ran.map((a) => `${a.actor} (${a.jobs_done})`).join(", ") : "none in the last 24h";
  return [
    `*Morning health check*`,
    `Agents that completed jobs: ${agents}`,
    `Jobs waiting: ${h.jobs_waiting}   Drafts awaiting approval: ${h.drafts_pending}`,
    `Sent (24h): ${h.sends_out_24h}   Received (24h): ${h.inbound_24h}   Failed: ${h.sends_failed_24h}`,
    `Safe to send without approval: ${h.safe_send_types.length ? h.safe_send_types.join(", ") : "nothing yet"}`,
    `Server: ${h.memory_free_mb} MB free memory${h.disk_free_gb != null ? `, ${h.disk_free_gb} GB free disk` : ""}${h.backup_age_hours != null ? `, last backup ${h.backup_age_hours}h ago` : ""}`,
    h.linkedin_days_left != null ? `LinkedIn token: ${h.linkedin_days_left} days left` : null,
    warn.length ? `⚠️ ${warn.join(" · ")}` : "✅ No warnings",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runHealthCheck(): Promise<Health> {
  const h = await collectHealth();
  await slack.alert(formatHealth(h));
  return h;
}
