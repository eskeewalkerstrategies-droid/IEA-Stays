import { describe, it, expect } from "vitest";
import { useTestDb, seedContact } from "./setup.js";
import { applyPersonWebhook, applyInvoiceWebhook, parseWebhook } from "../src/twenty/mirror.js";
import { db } from "../src/db.js";
import { createJob } from "../src/jobs/agentJobs.js";

useTestDb();

describe("twenty mirror", () => {
  it("creates and updates a contact from person webhooks and records stage changes", async () => {
    const rec = { id: "tw-1", name: { firstName: "Dev", lastName: "Patel" }, emails: { primaryEmail: "Dev@Patel.io" }, stage: "New lead", leadSource: "referral", emailConsent: true };
    const created = await applyPersonWebhook("created", rec);
    expect(created?.twenty_id).toBe("tw-1");
    expect(created?.email).toBe("dev@patel.io");
    const updated = await applyPersonWebhook("updated", { ...rec, stage: "Qualified", leadScore: 72 });
    expect(updated?.stage).toBe("Qualified");
    expect(updated?.lead_score).toBe(72);
    const events = await db()`SELECT type, payload FROM events WHERE contact_id = ${created!.id} ORDER BY id`;
    expect(events.map((e) => e.type)).toEqual(["contact_created", "stage_changed"]);
    expect(events[1].payload).toMatchObject({ from: "New lead", to: "Qualified" });
    const [{ count }] = await db()`SELECT count(*)::int AS count FROM contacts`;
    expect(count).toBe(1);
  });

  it("marking a project Completed creates an invoice_create job", async () => {
    const c = await seedContact({ twenty_id: "tw-2", stage: "Active client" });
    await applyPersonWebhook("updated", { id: "tw-2", name: { firstName: "Asha", lastName: "Mehta" }, emails: { primaryEmail: c.email }, stage: "Completed" });
    const jobs = await db()`SELECT type FROM jobs WHERE contact_id = ${c.id}`;
    expect(jobs).toEqual([{ type: "invoice_create" }]);
  });

  it("an invoice marked Paid in Twenty cancels reminder jobs and completes the contact", async () => {
    const c = await seedContact({ twenty_id: "tw-3", stage: "Overdue" });
    const inv = await applyInvoiceWebhook("created", { id: "inv-1", number: "EWS/INV/26-27/009", personId: "tw-3", amount: { amountMicros: 50_000_000_000, currencyCode: "INR" }, dueDate: "2026-11-10", status: "Sent" });
    expect(inv?.amount).toBe("50000.00");
    expect(inv?.contact_id).toBe(c.id);
    await createJob({ type: "invoice_reminder", contact_id: c.id, invoice_id: inv!.id, payload: { reminder: "after_7" } });
    await applyInvoiceWebhook("updated", { id: "inv-1", status: "Paid", paidDate: "2026-11-19" });
    const jobs = await db()`SELECT status FROM jobs WHERE invoice_id = ${inv!.id}`;
    expect(jobs).toEqual([{ status: "cancelled" }]);
    const [contact] = await db()`SELECT stage FROM contacts WHERE id = ${c.id}`;
    expect(contact.stage).toBe("Completed");
    const paid = await db()`SELECT 1 FROM events WHERE type = 'invoice_paid' AND invoice_id = ${inv!.id}`;
    expect(paid).toHaveLength(1);
  });

  it("parses both webhook shapes", () => {
    expect(parseWebhook({ eventName: "person.updated", record: { id: "1" } })?.action).toBe("updated");
    expect(parseWebhook({ event: "invoice.created", data: { id: "2" } })?.object).toBe("invoice");
    expect(parseWebhook({})).toBeNull();
  });
});
