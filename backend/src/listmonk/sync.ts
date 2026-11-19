import { config } from "../config.js";
import { db } from "../db.js";
import { recordEvent } from "../events.js";
import type { Contact } from "../contacts.js";
import * as lm from "./client.js";
import { log } from "../log.js";

/**
 * Nightly: every consenting contact goes to a listmonk list by stage. Leads (New lead, Qualified, Call booked,
 * Proposal sent) go to the leads list, clients (Active, Invoice sent, Overdue, Completed) to the clients list.
 * Everyone with consent is on the newsletter list. Unsubscribed or Lost contacts are blocklisted.
 */
export async function syncContactsToListmonk(): Promise<{ synced: number; removed: number }> {
  if (!lm.warnIfDisabled("sync")) return { synced: 0, removed: 0 };
  const c = config();
  const leadList = c.LISTMONK_LIST_LEADS;
  const clientList = c.LISTMONK_LIST_CLIENTS;
  const newsletterList = c.LISTMONK_LIST_NEWSLETTER;
  let synced = 0;
  let removed = 0;

  const contacts = await db()<Contact[]>`SELECT * FROM contacts WHERE deleted_at IS NULL AND email IS NOT NULL`;
  for (const ct of contacts) {
    try {
      if (ct.unsubscribed_at || !ct.email_consent || ct.stage === "Lost") {
        await lm.unsubscribeInListmonk(ct.email!);
        removed++;
        continue;
      }
      const lists: number[] = [];
      if (newsletterList) lists.push(newsletterList);
      if (leadList && ["New lead", "Qualified", "Call booked", "Proposal sent"].includes(ct.stage)) lists.push(leadList);
      if (clientList && ["Active client", "Invoice sent", "Overdue", "Completed"].includes(ct.stage)) lists.push(clientList);
      await lm.upsertSubscriber(ct.email!, `${ct.first_name} ${ct.last_name}`.trim(), lists, { stage: ct.stage, company: ct.company_name, contact_id: ct.id });
      // Keep list membership exact: a client should not stay on the leads sequence.
      const off: number[] = [];
      if (leadList && !lists.includes(leadList)) off.push(leadList);
      if (clientList && !lists.includes(clientList)) off.push(clientList);
      if (off.length) await lm.removeFromLists(ct.email!, off);
      synced++;
    } catch (err) {
      log.warn({ err, email: ct.email }, "listmonk sync failed for contact");
    }
  }
  await recordEvent({ type: "listmonk_synced", payload: { synced, removed } });
  return { synced, removed };
}

/**
 * listmonk webhook for bounces and unsubscribes (Settings, Bounces, webhook, and the subscriber webhook).
 * Any unsubscribe there flips consent here, so the Follow-up agent stops too.
 */
export interface ListmonkWebhook {
  email?: string;
  subscriber?: { email?: string };
  type?: string; // bounce type: hard | soft | complaint
  source?: string;
  event?: string; // unsubscribe
}

export async function handleListmonkWebhook(body: ListmonkWebhook): Promise<{ handled: boolean }> {
  const email = (body.email ?? body.subscriber?.email ?? "").toLowerCase();
  if (!email) return { handled: false };
  const [contact] = await db()<Contact[]>`SELECT * FROM contacts WHERE lower(email) = ${email} AND deleted_at IS NULL`;
  const isHard = body.type === "hard" || body.type === "complaint" || body.event === "unsubscribe";
  if (contact) {
    await recordEvent({ type: body.event === "unsubscribe" ? "newsletter_unsubscribed" : "email_bounced", contact_id: contact.id, payload: { type: body.type ?? body.event ?? null, source: body.source ?? null } });
    if (isHard) {
      const { unsubscribeContact } = await import("../leads.js");
      await unsubscribeContact(contact.id, body.event === "unsubscribe" ? "listmonk_unsubscribe" : `bounce_${body.type}`);
    }
  } else {
    await recordEvent({ type: "email_bounced", payload: { email, type: body.type ?? null, unmatched: true } });
  }
  return { handled: true };
}
