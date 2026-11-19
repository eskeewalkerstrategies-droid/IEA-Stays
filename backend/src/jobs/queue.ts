import { PgBoss } from "pg-boss";
import { config } from "../config.js";
import { log } from "../log.js";

/** pg-boss queues. Timed and background work for code. Claude's work lives in ops.jobs instead. */
export const Q = {
  sendDraft: "send-draft",
  instantResponse: "instant-response",
  callReminder: "call-reminder",
  callOutcomePrompt: "call-outcome-prompt",
  dailyJobs: "daily-jobs",
  inboundPoll: "inbound-poll",
  listmonkSync: "listmonk-sync",
  healthCheck: "health-check",
  metricsPull: "metrics-pull",
  wakeAgent: "wake-agent",
} as const;

let boss: PgBoss | undefined;

export async function startBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const b = new PgBoss({ connectionString: config().DATABASE_URL, schema: "pgboss" });
  b.on("error", (err) => log.error({ err }, "pg-boss error"));
  await b.start();
  for (const name of Object.values(Q)) await b.createQueue(name).catch(() => {});
  boss = b;
  return b;
}

export function getBoss(): PgBoss {
  if (!boss) throw new Error("pg-boss not started");
  return boss;
}

export async function stopBoss(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true, timeout: 5000 });
    boss = undefined;
  }
}

export interface EnqueueOptions {
  startAfter?: Date | number;
  singletonKey?: string;
  retryLimit?: number;
}

/** Enqueue a background job. When pg-boss is not running (unit tests), the call is recorded in memoryQueue. */
export const memoryQueue: Array<{ name: string; data: unknown; opts?: EnqueueOptions }> = [];

export async function enqueue(name: string, data: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<string | null> {
  if (!boss) {
    memoryQueue.push({ name, data, opts });
    return null;
  }
  return boss.send(name, data, { startAfter: opts.startAfter, singletonKey: opts.singletonKey, retryLimit: opts.retryLimit ?? 3, retryDelay: 60, retryBackoff: true });
}
