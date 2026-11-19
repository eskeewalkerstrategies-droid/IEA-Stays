import { config } from "./config.js";
import { getBoss, Q } from "./jobs/queue.js";
import { sendDraft } from "./senders/index.js";
import { postNewLeadAlert, sendInstantResponse } from "./jobs/instantResponse.js";
import { postCallOutcomePrompt, sendCallReminder } from "./jobs/reminders.js";
import { runDailyJobs } from "./jobs/daily.js";
import { pollInbox } from "./inbound/imap.js";
import { syncContactsToListmonk } from "./listmonk/sync.js";
import { runHealthCheck } from "./jobs/health.js";
import { pullMetrics } from "./jobs/metrics.js";
import { log } from "./log.js";

/** Registers every pg-boss worker and the timed schedules (India time). */
export async function startWorkers(): Promise<void> {
  const boss = getBoss();
  const c = config();

  await boss.work<{ draft_id: string }>(Q.sendDraft, async ([job]) => {
    const r = await sendDraft(job.data.draft_id);
    log.info({ draft: job.data.draft_id, r }, "send-draft");
  });

  await boss.work<{ contact_id: string }>(Q.instantResponse, async ([job]) => {
    await sendInstantResponse(job.data.contact_id);
    await postNewLeadAlert(job.data.contact_id);
  });

  await boss.work<{ contact_id: string; start: string; hours_before: number; join_url: string | null }>(Q.callReminder, async ([job]) => {
    await sendCallReminder(job.data.contact_id, job.data.start, job.data.hours_before, job.data.join_url);
  });

  await boss.work<{ contact_id: string; uid: string }>(Q.callOutcomePrompt, async ([job]) => {
    await postCallOutcomePrompt(job.data.contact_id, job.data.uid);
  });

  await boss.work(Q.dailyJobs, async () => {
    await runDailyJobs();
  });

  await boss.work(Q.inboundPoll, async () => {
    await pollInbox();
  });

  await boss.work(Q.listmonkSync, async () => {
    await syncContactsToListmonk();
  });

  await boss.work(Q.healthCheck, async () => {
    await runHealthCheck();
  });

  await boss.work(Q.metricsPull, async () => {
    await pullMetrics();
  });

  await boss.work<{ agent: string; contact_id?: string }>(Q.wakeAgent, async ([job]) => {
    if (!c.AGENT_WAKE_URL) return;
    await fetch(c.AGENT_WAKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(c.AGENT_WAKE_TOKEN ? { Authorization: `Bearer ${c.AGENT_WAKE_TOKEN}` } : {}) },
      body: JSON.stringify({ agent: job.data.agent }),
    }).catch((err) => log.warn({ err }, "agent wake failed"));
  });

  const tz = c.TZ_NAME;
  await boss.schedule(Q.dailyJobs, "0 8 * * *", null, { tz }); // 08:00 India, before the 08:40 follow-up agent
  await boss.schedule(Q.healthCheck, "15 8 * * *", null, { tz });
  await boss.schedule(Q.inboundPoll, "*/2 * * * *", null, { tz });
  await boss.schedule(Q.listmonkSync, "30 2 * * *", null, { tz });
  await boss.schedule(Q.metricsPull, "0 5 * * *", null, { tz });
  log.info("workers and schedules registered");
}
