import { db } from "./db.js";
import { recordEvent } from "./events.js";
import { findContactByEmail, splitName, syncContactToTwenty, updateContact, type Contact } from "./contacts.js";
import { createJob } from "./jobs/agentJobs.js";
import { enqueue, Q } from "./jobs/queue.js";
import type { LeadSource } from "./twenty/fields.js";

export interface LeadInput {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  need?: string | null;
  email_consent: boolean;
  consent_wording: string;
  source: LeadSource;
  tool_used?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  payload?: Record<string, unknown>;
}

export interface LeadResult {
  contact: Contact;
  created: boolean;
  intake_job_id: string | null;
}

/**
 * The one path every new lead takes, from the website form, a free tool, or a manual entry:
 * contact (create or update) + consent row with the exact wording shown + lead_created event +
 * intake job + instant response + Slack alert. Twenty gets the contact too when configured.
 */
export async function captureLead(input: LeadInput): Promise<LeadResult> {
  const email = input.email.trim().toLowerCase();
  const { first_name, last_name } = splitName(input.name);
  const existing = await findContactByEmail(email);
  const consentAt = input.email_consent ? new Date() : null;

  let contact: Contact;
  let created = false;
  if (existing) {
    const patch = {
      first_name: existing.first_name || first_name,
      last_name: existing.last_name || last_name,
      phone: input.phone ?? existing.phone,
      company_name: input.company ?? existing.company_name,
      need: input.need ?? existing.need,
      email_consent: existing.email_consent || input.email_consent,
      consent_at: existing.consent_at ?? consentAt,
      tool_used: input.tool_used ?? existing.tool_used,
      lead_source: existing.lead_source ?? input.source,
      // A dormant, lost or completed contact who fills the form again is a live lead.
      stage: ["Dormant", "Lost", "Completed", "Prospect"].includes(existing.stage) ? ("New lead" as const) : existing.stage,
      unsubscribed_at: input.email_consent ? null : existing.unsubscribed_at,
    };
    contact = await updateContact(existing.id, patch);
    await syncContactToTwenty(contact, patch);
  } else {
    const [row] = await db()<Contact[]>`
      INSERT INTO contacts (first_name, last_name, email, phone, company_name, need, stage, lead_source, email_consent, consent_at, tool_used)
      VALUES (${first_name}, ${last_name}, ${email}, ${input.phone ?? null}, ${input.company ?? null}, ${input.need ?? null}, 'New lead',
              ${input.source}, ${input.email_consent}, ${consentAt}, ${input.tool_used ?? null})
      RETURNING *`;
    contact = row;
    created = true;
    await syncContactToTwenty(contact, {
      first_name, last_name, email, phone: input.phone ?? null, stage: "New lead", lead_source: input.source,
      email_consent: input.email_consent, consent_at: consentAt, tool_used: input.tool_used ?? null,
    });
  }

  await db()`INSERT INTO consents (contact_id, email, channel, granted, source, wording, ip, user_agent)
    VALUES (${contact.id}, ${email}, 'email', ${input.email_consent}, ${input.source}, ${input.consent_wording}, ${input.ip ?? null}, ${input.user_agent ?? null})`;
  await recordEvent({
    type: created ? "lead_created" : "lead_returned",
    contact_id: contact.id,
    payload: { source: input.source, tool_used: input.tool_used ?? null, need: input.need ?? null, email_consent: input.email_consent, ...(input.payload ?? {}) },
  });

  const job = await createJob({ type: "intake", contact_id: contact.id, payload: { source: input.source, tool_used: input.tool_used ?? null, need: input.need ?? null } });
  await enqueue(Q.instantResponse, { contact_id: contact.id }, { singletonKey: `instant:${contact.id}:${Date.now()}` });
  await enqueue(Q.wakeAgent, { agent: "intake", contact_id: contact.id }, { singletonKey: `wake:intake:${Math.floor(Date.now() / 300_000)}` });
  return { contact, created, intake_job_id: job?.id ?? null };
}

export async function unsubscribeContact(contactId: string, source: string): Promise<Contact | null> {
  const [c] = await db()<Contact[]>`UPDATE contacts SET unsubscribed_at = now(), email_consent = false, next_follow_up_at = NULL, updated_at = now() WHERE id = ${contactId} RETURNING *`;
  if (!c) return null;
  await db()`INSERT INTO consents (contact_id, email, channel, granted, source, wording) VALUES (${c.id}, ${c.email}, 'email', false, ${source}, 'unsubscribed')`;
  await recordEvent({ type: "unsubscribed", contact_id: c.id, payload: { source } });
  await syncContactToTwenty(c, { email_consent: false });
  return c;
}
