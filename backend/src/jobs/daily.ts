import { db } from "../db.js";
import { recordEvent } from "../events.js";
import { createJob } from "./agentJobs.js";
import { setStage, type Contact } from "../contacts.js";
import { updateInvoice, type Invoice } from "../invoices/invoices.js";
import { addDays, daysBetween, indiaDate } from "../time.js";
import { log } from "../log.js";

/**
 * Runs every morning before the agents wake. Creates the day's jobs:
 * - a follow_up job for each contact whose next follow-up date is today or earlier,
 * - invoice_reminder jobs at 3 days before due, on the due date, and 7 and 14 days after,
 * - moves unpaid invoices past due to Overdue (and the contact's stage),
 * - moves silent leads to Dormant after 30 days and completed clients after 90.
 * Returns counts so the health check can report them.
 */
export interface DailySummary {
  follow_ups: number;
  invoice_reminders: number;
  overdue: number;
  dormant: number;
  day: string;
}

const REMINDER_OFFSETS: Array<{ key: string; days: number }> = [
  { key: "before_3", days: -3 },
  { key: "due", days: 0 },
  { key: "after_7", days: 7 },
  { key: "after_14", days: 14 },
];

export async function runDailyJobs(today: string = indiaDate()): Promise<DailySummary> {
  const sql = db();
  const summary: DailySummary = { follow_ups: 0, invoice_reminders: 0, overdue: 0, dormant: 0, day: today };

  // 1. Follow-ups due.
  const due = await sql<Contact[]>`
    SELECT * FROM contacts
    WHERE deleted_at IS NULL AND unsubscribed_at IS NULL AND email_consent = true
      AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= ${today}
      AND stage IN ('New lead','Qualified','Call booked','Proposal sent','Active client','Completed')`;
  for (const c of due) {
    const job = await createJob({ type: "follow_up", contact_id: c.id, payload: { due_date: c.next_follow_up_at, follow_up_count: c.follow_up_count } });
    if (job) summary.follow_ups++;
  }

  // 2. Invoice reminders and overdue.
  const open = await sql<Invoice[]>`SELECT * FROM invoices WHERE status IN ('Sent','Overdue') AND due_date IS NOT NULL`;
  for (const inv of open) {
    const delta = daysBetween(inv.due_date!, today); // positive when past due
    if (delta >= 1 && inv.status === "Sent") {
      await updateInvoice(inv.id, { status: "Overdue" }, "system");
      if (inv.contact_id) await setStage(inv.contact_id, "Overdue", "system", `invoice ${inv.number} past due`).catch((e) => log.warn({ e }, "stage"));
      summary.overdue++;
    }
    for (const r of REMINDER_OFFSETS) {
      const reminderDay = addDays(inv.due_date!, r.days);
      if (reminderDay === today && !(inv.reminders_sent ?? []).includes(r.key)) {
        const job = await createJob({ type: "invoice_reminder", contact_id: inv.contact_id, invoice_id: inv.id, payload: { reminder: r.key, invoice_number: inv.number, due_date: inv.due_date } });
        if (job) summary.invoice_reminders++;
      }
    }
  }

  // 3. Dormancy.
  const stale = await sql<Contact[]>`
    SELECT * FROM contacts
    WHERE deleted_at IS NULL AND (
      (stage IN ('New lead','Qualified','Proposal sent') AND coalesce(last_contact_at, created_at) < now() - interval '30 days' AND follow_up_count >= 3)
      OR (stage = 'Completed' AND coalesce(last_contact_at, updated_at) < now() - interval '90 days')
    )`;
  for (const c of stale) {
    await setStage(c.id, "Dormant", "system", "no contact for the dormancy period");
    summary.dormant++;
  }

  await recordEvent({ type: "daily_jobs_ran", payload: summary as unknown as Record<string, unknown> });
  log.info(summary, "daily jobs");
  return summary;
}
