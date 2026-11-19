import { db } from "../db.js";
import { recordEvent } from "../events.js";
import { findContactByTwentyId, findContactByEmail, type Contact } from "../contacts.js";
import { isStage } from "./fields.js";
import { createJob } from "../jobs/agentJobs.js";
import { markReminderSent, type Invoice } from "../invoices/invoices.js";

/**
 * Keeps ops.contacts and ops.invoices in step with Twenty from its webhooks. Every change becomes an event,
 * which is what gives agents their history. Payload shapes vary by Twenty version, so this reads defensively.
 */
export interface TwentyWebhook {
  eventName?: string; // e.g. person.updated
  event?: string;
  objectMetadata?: { nameSingular?: string };
  record?: Record<string, unknown>;
  data?: Record<string, unknown>;
  updatedFields?: string[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function currency(v: unknown): number {
  if (v && typeof v === "object" && "amountMicros" in (v as object)) return Number((v as { amountMicros: unknown }).amountMicros ?? 0) / 1_000_000;
  return num(v) ?? 0;
}

export function parseWebhook(body: TwentyWebhook): { object: string; action: string; record: Record<string, unknown> } | null {
  const name = body.eventName ?? body.event ?? "";
  const [object, action] = name.split(".");
  const record = body.record ?? body.data ?? null;
  if (!object || !action || !record) return null;
  return { object, action, record };
}

export async function applyPersonWebhook(action: string, r: Record<string, unknown>, actor = "twenty"): Promise<Contact | null> {
  const twentyId = str(r.id);
  if (!twentyId) return null;
  if (action === "deleted") {
    const [c] = await db()<Contact[]>`UPDATE contacts SET deleted_at = now(), updated_at = now() WHERE twenty_id = ${twentyId} RETURNING *`;
    if (c) await recordEvent({ type: "contact_deleted", contact_id: c.id, actor });
    return c ?? null;
  }
  const name = (r.name ?? {}) as { firstName?: string; lastName?: string };
  const emails = (r.emails ?? {}) as { primaryEmail?: string };
  const phones = (r.phones ?? {}) as { primaryPhoneNumber?: string };
  const email = str(emails.primaryEmail)?.toLowerCase() ?? null;
  const stage = isStage(r.stage) ? r.stage : null;
  const patch = {
    twenty_id: twentyId,
    first_name: name.firstName ?? "",
    last_name: name.lastName ?? "",
    email,
    phone: str(phones.primaryPhoneNumber),
    company_twenty_id: str(r.companyId),
    lead_source: str(r.leadSource),
    lead_score: num(r.leadScore),
    email_consent: typeof r.emailConsent === "boolean" ? r.emailConsent : undefined,
    consent_at: str(r.consentDate) ? new Date(r.consentDate as string) : undefined,
    next_follow_up_at: str(r.nextFollowUpAt)?.slice(0, 10) ?? null,
    last_contact_at: str(r.lastContactAt) ? new Date(r.lastContactAt as string) : undefined,
    tool_used: str(r.toolUsed),
    ...(stage ? { stage } : {}),
  };
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));

  const existing = (await findContactByTwentyId(twentyId)) ?? (email ? await findContactByEmail(email) : null);
  if (existing) {
    const [after] = await db()<Contact[]>`UPDATE contacts SET ${db()(clean as never)}, updated_at = now() WHERE id = ${existing.id} RETURNING *`;
    if (stage && stage !== existing.stage) {
      await recordEvent({ type: "stage_changed", contact_id: existing.id, actor, payload: { from: existing.stage, to: stage, reason: "changed in Twenty" } });
      await onStageFromCrm(after, existing.stage);
    } else {
      await recordEvent({ type: "contact_updated", contact_id: existing.id, actor, payload: { fields: Object.keys(clean) } });
    }
    return after;
  }
  const [created] = await db()<Contact[]>`INSERT INTO contacts ${db()({ stage: "New lead", ...clean } as never)} RETURNING *`;
  await recordEvent({ type: "contact_created", contact_id: created.id, actor, payload: { source: "twenty" } });
  return created;
}

/** Side effects of a stage change made by hand in the CRM. */
async function onStageFromCrm(c: Contact, from: string): Promise<void> {
  if (c.stage === "Active client" && from !== "Active client") {
    // nothing automatic yet; the Invoice agent runs when the project is marked complete
  }
  if (c.stage === "Completed" && from === "Active client") {
    await createJob({ type: "invoice_create", contact_id: c.id, payload: { reason: "project marked complete in Twenty" }, actor: "twenty" });
  }
}

export async function applyInvoiceWebhook(action: string, r: Record<string, unknown>, actor = "twenty"): Promise<Invoice | null> {
  const twentyId = str(r.id);
  if (!twentyId) return null;
  const person = str(r.personId);
  const contact = person ? await findContactByTwentyId(person) : null;
  const patch = {
    twenty_id: twentyId,
    number: str(r.number),
    contact_id: contact?.id ?? undefined,
    amount: currency(r.amount),
    gst: currency(r.gst),
    issue_date: str(r.issueDate)?.slice(0, 10) ?? null,
    due_date: str(r.dueDate)?.slice(0, 10) ?? null,
    status: str(r.status) ?? "Draft",
    paid_at: str(r.paidDate)?.slice(0, 10) ?? null,
    pdf_link: (r.pdfLink as { primaryLinkUrl?: string } | undefined)?.primaryLinkUrl ?? str(r.pdfLink),
  };
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const [existing] = await db()<Invoice[]>`SELECT * FROM invoices WHERE twenty_id = ${twentyId} OR (number IS NOT NULL AND number = ${patch.number})`;
  let inv: Invoice;
  if (existing) {
    [inv] = await db()<Invoice[]>`UPDATE invoices SET ${db()(clean as never)}, updated_at = now() WHERE id = ${existing.id} RETURNING *`;
  } else {
    [inv] = await db()<Invoice[]>`INSERT INTO invoices ${db()(clean as never)} RETURNING *`;
  }
  await recordEvent({ type: existing ? "invoice_updated" : "invoice_created", contact_id: inv.contact_id, invoice_id: inv.id, actor, payload: { status: inv.status, number: inv.number } });
  if (inv.status === "Paid" && existing?.status !== "Paid") {
    await onInvoicePaid(inv, actor);
  }
  return inv;
}

/** Marking an invoice paid stops reminders and moves the contact to Completed. */
export async function onInvoicePaid(inv: Invoice, actor: string): Promise<void> {
  await db()`UPDATE jobs SET status = 'cancelled', completed_at = now(), result = '{"reason":"invoice paid"}' WHERE invoice_id = ${inv.id} AND status IN ('queued','taken')`;
  await db()`UPDATE drafts SET status = 'rejected', updated_at = now() WHERE message_type = 'invoice_reminder' AND status IN ('draft','pending_approval','approved','queued') AND contact_id = ${inv.contact_id}`;
  await markReminderSent(inv.id, "paid");
  await recordEvent({ type: "invoice_paid", contact_id: inv.contact_id, invoice_id: inv.id, actor, payload: { number: inv.number } });
  if (inv.contact_id) {
    const { setStage } = await import("../contacts.js");
    const [other] = await db()`SELECT 1 FROM invoices WHERE contact_id = ${inv.contact_id} AND status IN ('Sent','Overdue') AND id <> ${inv.id} LIMIT 1`;
    if (!other) await setStage(inv.contact_id, "Completed", actor, `invoice ${inv.number} paid`);
  }
}
