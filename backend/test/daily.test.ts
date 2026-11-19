import { describe, it, expect } from "vitest";
import { useTestDb, seedContact } from "./setup.js";
import { runDailyJobs } from "../src/jobs/daily.js";
import { db } from "../src/db.js";
import { createInvoice } from "../src/invoices/invoices.js";
import { addDays, addWorkingDays, financialYear, daysBetween } from "../src/time.js";

useTestDb();

describe("daily job creator", () => {
  it("creates a follow_up job for each consenting contact due today, once", async () => {
    const due = await seedContact({ next_follow_up_at: "2026-11-19" });
    const later = await seedContact({ next_follow_up_at: "2026-11-25" });
    const noConsent = await seedContact({ next_follow_up_at: "2026-11-18", email_consent: false });
    const s1 = await runDailyJobs("2026-11-19");
    expect(s1.follow_ups).toBe(1);
    const jobs = await db()`SELECT contact_id, type, status FROM jobs`;
    expect(jobs).toEqual([{ contact_id: due.id, type: "follow_up", status: "queued" }]);
    void later;
    void noConsent;
    const s2 = await runDailyJobs("2026-11-19");
    expect(s2.follow_ups).toBe(0);
  });

  it("schedules invoice reminders at -3, 0, +7, +14 days and flags overdue", async () => {
    const c = await seedContact({ stage: "Invoice sent" });
    const inv = await createInvoice({ contact_id: c.id, amount: 50000, gst: 9000, issue_date: "2026-11-01", due_date: "2026-11-20", status: "Sent", actor: "test" });
    expect(inv.number).toBe(`EWS/INV/${financialYear("2026-11-01")}/001`);

    expect((await runDailyJobs("2026-11-17")).invoice_reminders).toBe(1);
    let [job] = await db()`SELECT payload FROM jobs WHERE invoice_id = ${inv.id} ORDER BY created_at DESC`;
    expect(job.payload.reminder).toBe("before_3");

    expect((await runDailyJobs("2026-11-20")).invoice_reminders).toBe(1);
    [job] = await db()`SELECT payload FROM jobs WHERE invoice_id = ${inv.id} ORDER BY created_at DESC`;
    expect(job.payload.reminder).toBe("due");

    const s = await runDailyJobs("2026-11-21");
    expect(s.overdue).toBe(1);
    const [after] = await db()`SELECT status FROM invoices WHERE id = ${inv.id}`;
    expect(after.status).toBe("Overdue");
    const [contact] = await db()`SELECT stage FROM contacts WHERE id = ${c.id}`;
    expect(contact.stage).toBe("Overdue");

    expect((await runDailyJobs("2026-11-27")).invoice_reminders).toBe(1);
    expect((await runDailyJobs("2026-12-04")).invoice_reminders).toBe(1);
    const all = await db()`SELECT payload->>'reminder' AS r FROM jobs WHERE invoice_id = ${inv.id} ORDER BY created_at`;
    expect(all.map((x) => x.r)).toEqual(["before_3", "due", "after_7", "after_14"]);
  });

  it("moves silent leads to Dormant after 30 days and three follow-ups", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    const stale = await seedContact({ last_contact_at: old, follow_up_count: 3 });
    const fresh = await seedContact({ last_contact_at: old, follow_up_count: 1 });
    const s = await runDailyJobs();
    expect(s.dormant).toBe(1);
    const [a] = await db()`SELECT stage FROM contacts WHERE id = ${stale.id}`;
    const [b] = await db()`SELECT stage FROM contacts WHERE id = ${fresh.id}`;
    expect(a.stage).toBe("Dormant");
    expect(b.stage).toBe("Qualified");
  });

  it("date helpers follow India working days", () => {
    expect(addWorkingDays("2026-11-20", 2)).toBe("2026-11-23"); // Fri + 2 working days (Sat counts) = Mon
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(daysBetween("2026-11-20", "2026-11-27")).toBe(7);
    expect(financialYear("2026-03-31")).toBe("25-26");
    expect(financialYear("2026-04-01")).toBe("26-27");
  });
});
