import { db } from "./db.js";
import { recordEvent } from "./events.js";
import { isStage, type Stage } from "./twenty/fields.js";
import * as twenty from "./twenty/client.js";
import { indiaDate } from "./time.js";

export interface Contact {
  id: string;
  twenty_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  company_twenty_id: string | null;
  stage: Stage;
  lead_source: string | null;
  lead_score: number | null;
  email_consent: boolean;
  consent_at: Date | null;
  next_follow_up_at: string | null;
  last_contact_at: Date | null;
  follow_up_count: number;
  owner: string | null;
  tool_used: string | null;
  need: string | null;
  unsubscribed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}


export function fullName(c: Pick<Contact, "first_name" | "last_name">): string {
  return `${c.first_name} ${c.last_name}`.trim() || "there";
}

export function splitName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/);
  return { first_name: parts.shift() ?? "", last_name: parts.join(" ") };
}

export async function getContact(id: string): Promise<Contact | null> {
  const [row] = await db()<Contact[]>`SELECT * FROM contacts WHERE id = ${id} AND deleted_at IS NULL`;
  return row ?? null;
}

export async function findContactByEmail(email: string): Promise<Contact | null> {
  const [row] = await db()<Contact[]>`SELECT * FROM contacts WHERE lower(email) = lower(${email}) AND deleted_at IS NULL`;
  return row ?? null;
}

export async function findContactByTwentyId(twentyId: string): Promise<Contact | null> {
  const [row] = await db()<Contact[]>`SELECT * FROM contacts WHERE twenty_id = ${twentyId}`;
  return row ?? null;
}

export async function searchContacts(query: string, limit = 10): Promise<Contact[]> {
  const q = `%${query.trim()}%`;
  return db()<Contact[]>`
    SELECT * FROM contacts
    WHERE deleted_at IS NULL AND (
      email ILIKE ${q} OR first_name ILIKE ${q} OR last_name ILIKE ${q} OR company_name ILIKE ${q}
      OR (first_name || ' ' || last_name) ILIKE ${q}
    )
    ORDER BY updated_at DESC LIMIT ${limit}`;
}

export type ContactPatch = Partial<
  Pick<
    Contact,
    | "first_name" | "last_name" | "email" | "phone" | "company_name" | "company_twenty_id" | "stage" | "lead_source"
    | "lead_score" | "email_consent" | "consent_at" | "next_follow_up_at" | "last_contact_at" | "follow_up_count"
    | "owner" | "tool_used" | "need" | "unsubscribed_at" | "twenty_id"
  >
>;

export async function updateContact(id: string, patch: ContactPatch): Promise<Contact> {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length === 0) return (await getContact(id))!;
  const [row] = await db()<Contact[]>`UPDATE contacts SET ${db()(clean as never)}, updated_at = now() WHERE id = ${id} RETURNING *`;
  return row;
}

/** Writes a patch to Twenty when configured. Failures become events, never exceptions. */
export async function syncContactToTwenty(contact: Contact, patch: ContactPatch, actor = "system"): Promise<void> {
  if (!twenty.twentyEnabled()) return;
  const input: twenty.TwentyPersonInput = {};
  if (patch.first_name !== undefined || patch.last_name !== undefined) {
    input.firstName = patch.first_name ?? contact.first_name;
    input.lastName = patch.last_name ?? contact.last_name;
  }
  if (patch.email !== undefined) input.email = patch.email;
  if (patch.phone !== undefined) input.phone = patch.phone;
  if (patch.stage !== undefined) input.stage = patch.stage;
  if (patch.lead_source !== undefined) input.leadSource = patch.lead_source;
  if (patch.lead_score !== undefined) input.leadScore = patch.lead_score;
  if (patch.email_consent !== undefined) input.emailConsent = patch.email_consent;
  if (patch.consent_at !== undefined) input.consentDate = patch.consent_at ? indiaDate(patch.consent_at) : null;
  if (patch.next_follow_up_at !== undefined) input.nextFollowUpAt = patch.next_follow_up_at;
  if (patch.last_contact_at !== undefined) input.lastContactAt = patch.last_contact_at ? indiaDate(patch.last_contact_at) : null;
  if (patch.tool_used !== undefined) input.toolUsed = patch.tool_used;
  if (Object.keys(input).length === 0) return;

  let ok: boolean;
  if (contact.twenty_id) {
    ok = await twenty.tryTwenty("updatePerson", () => twenty.updatePerson(contact.twenty_id!, input));
  } else {
    ok = await twenty.tryTwenty("createPerson", async () => {
      const existing = contact.email ? await twenty.findPersonByEmail(contact.email) : null;
      const id = existing ? (await twenty.updatePerson(existing.id, input), existing.id) : (await twenty.createPerson({
        firstName: contact.first_name,
        lastName: contact.last_name,
        email: contact.email,
        phone: contact.phone,
        ...input,
      })).id;
      await db()`UPDATE contacts SET twenty_id = ${id} WHERE id = ${contact.id} AND twenty_id IS NULL`;
    });
  }
  if (!ok) await recordEvent({ type: "twenty_sync_failed", contact_id: contact.id, actor, payload: { patch: input } });
}

export async function setStage(contactId: string, stage: string, actor: string, reason?: string): Promise<Contact> {
  if (!isStage(stage)) throw new Error(`Unknown stage: ${stage}`);
  const before = await getContact(contactId);
  if (!before) throw new Error("Contact not found");
  if (before.stage === stage) return before;
  const after = await updateContact(contactId, { stage });
  await recordEvent({ type: "stage_changed", contact_id: contactId, actor, payload: { from: before.stage, to: stage, reason: reason ?? null } });
  await syncContactToTwenty(after, { stage }, actor);
  return after;
}

export async function addNote(contactId: string, note: string, actor: string): Promise<void> {
  await recordEvent({ type: "note_added", contact_id: contactId, actor, payload: { note } });
}

export async function setNextFollowUp(contactId: string, ymd: string | null, actor: string, reason?: string): Promise<Contact> {
  const after = await updateContact(contactId, { next_follow_up_at: ymd });
  await recordEvent({ type: "next_follow_up_set", contact_id: contactId, actor, payload: { date: ymd, reason: reason ?? null } });
  await syncContactToTwenty(after, { next_follow_up_at: ymd }, actor);
  return after;
}

export interface ContactHistory {
  contact: Contact;
  events: Array<{ id: number; type: string; actor: string; payload: unknown; created_at: Date }>;
  messages: Array<{ id: string; channel: string; direction: string; message_type: string | null; subject: string | null; body: string | null; classification: string | null; occurred_at: Date }>;
  drafts: Array<{ id: string; channel: string; message_type: string; subject: string | null; body: string; status: string; created_at: Date }>;
  invoices: Array<{ id: string; number: string | null; amount: string; gst: string; due_date: string | null; status: string; paid_at: string | null; pdf_link: string | null }>;
  consents: Array<{ channel: string; granted: boolean; source: string; wording: string; created_at: Date }>;
  open_jobs: Array<{ id: string; type: string; status: string; due_at: Date }>;
}

/** Everything Claude needs before writing to someone. */
export async function contactHistory(contactId: string, limit = 40): Promise<ContactHistory | null> {
  const contact = await getContact(contactId);
  if (!contact) return null;
  const sql = db();
  const [events, messages, drafts, invoices, consents, open_jobs] = await Promise.all([
    sql`SELECT id, type, actor, payload, created_at FROM events WHERE contact_id = ${contactId} ORDER BY created_at DESC LIMIT ${limit}`,
    sql`SELECT id, channel, direction, message_type, subject, body, classification, occurred_at FROM messages WHERE contact_id = ${contactId} ORDER BY occurred_at DESC LIMIT ${limit}`,
    sql`SELECT id, channel, message_type, subject, body, status, created_at FROM drafts WHERE contact_id = ${contactId} ORDER BY created_at DESC LIMIT 10`,
    sql`SELECT id, number, amount, gst, due_date, status, paid_at, pdf_link FROM invoices WHERE contact_id = ${contactId} ORDER BY created_at DESC`,
    sql`SELECT channel, granted, source, wording, created_at FROM consents WHERE contact_id = ${contactId} ORDER BY created_at DESC`,
    sql`SELECT id, type, status, due_at FROM jobs WHERE contact_id = ${contactId} AND status IN ('queued','taken') ORDER BY due_at`,
  ]);
  return { contact, events, messages, drafts, invoices, consents, open_jobs } as unknown as ContactHistory;
}

/** May this contact be emailed right now? Consent and unsubscribe decide, never the prompt. */
export function canEmail(c: Contact): { ok: boolean; reason?: string } {
  if (!c.email) return { ok: false, reason: "no email address" };
  if (c.unsubscribed_at) return { ok: false, reason: "unsubscribed" };
  if (!c.email_consent) return { ok: false, reason: "no email consent" };
  return { ok: true };
}
