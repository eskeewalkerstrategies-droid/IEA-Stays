import { db } from "../db.js";
import { recordEvent } from "../events.js";
import { findContactByEmail, fullName, setStage, updateContact, syncContactToTwenty, type Contact } from "../contacts.js";
import { cancelOpenJobs, createJob } from "../jobs/agentJobs.js";
import { cancelOpenDrafts } from "../drafts.js";
import { unsubscribeContact } from "../leads.js";
import { classifyReply, type Classification } from "./classify.js";
import * as slack from "../slack/client.js";
import { unsubscribeInListmonk } from "../listmonk/client.js";

export interface InboundEmail {
  messageId: string;
  from: string;
  fromName?: string | null;
  to?: string | null;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  receivedAt: Date;
}

/** Strips quoted history so the classifier sees only what the person wrote. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:$/.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line) || /^From: .+/.test(line) && out.length > 0 || /^>/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export interface InboundResult {
  stored: boolean;
  contact_id: string | null;
  classification: Classification | null;
  action: string;
}

/**
 * Every inbound email: store it, match the contact, stop running sequences, act on unsubscribe at once,
 * classify the rest and hand it to the Reply agent as a job. Also posts a short Slack note.
 */
export async function handleInbound(mail: InboundEmail): Promise<InboundResult> {
  const from = mail.from.toLowerCase();
  const contact = await findContactByEmail(from);
  const [dupe] = await db()`SELECT 1 FROM messages WHERE channel = 'email' AND external_id = ${mail.messageId}`;
  if (dupe) return { stored: false, contact_id: contact?.id ?? null, classification: null, action: "duplicate" };

  const body = stripQuoted(mail.text);
  const [msg] = await db()`INSERT INTO messages (contact_id, channel, direction, message_type, from_address, to_address, subject, body, external_id, in_reply_to, occurred_at, meta)
    VALUES (${contact?.id ?? null}, 'email', 'in', 'reply', ${from}, ${mail.to ?? null}, ${mail.subject}, ${body || mail.text}, ${mail.messageId}, ${mail.inReplyTo ?? null}, ${mail.receivedAt}, ${db().json({ from_name: mail.fromName ?? null })})
    RETURNING id`;

  if (!contact) {
    await recordEvent({ type: "inbound_unmatched", payload: { from, subject: mail.subject, message_id: msg.id } });
    return { stored: true, contact_id: null, classification: null, action: "unmatched" };
  }
  await recordEvent({ type: "reply_received", contact_id: contact.id, payload: { subject: mail.subject, message_id: msg.id } });

  // A reply stops any running sequence for that contact, whatever it says.
  await cancelOpenJobs(contact.id, ["follow_up", "rebooking", "intake"], "inbound", "contact replied");
  await cancelOpenDrafts(contact.id, "inbound", "contact replied");
  await db()`UPDATE contacts SET next_follow_up_at = NULL, last_contact_at = ${mail.receivedAt}, updated_at = now() WHERE id = ${contact.id}`;

  const [lastOut] = await db()`SELECT body FROM messages WHERE contact_id = ${contact.id} AND direction = 'out' AND channel = 'email' ORDER BY occurred_at DESC LIMIT 1`;
  const cls = await classifyReply(body || mail.text, { contactName: fullName(contact), stage: contact.stage, lastOutbound: lastOut?.body ?? null });
  await db()`UPDATE messages SET classification = ${cls.classification}, meta = meta || ${db().json({ confidence: cls.confidence, summary: cls.summary })} WHERE id = ${msg.id}`;
  await recordEvent({ type: "reply_classified", contact_id: contact.id, payload: { classification: cls.classification, confidence: cls.confidence, summary: cls.summary, message_id: msg.id } });

  let action = cls.classification as string;
  switch (cls.classification) {
    case "unsubscribe":
      await unsubscribeContact(contact.id, "reply");
      await unsubscribeInListmonk(contact.email!).catch(() => {});
      await slack.alert(`🚫 ${fullName(contact)} asked to stop emails. Done, no reply will be sent.`);
      return { stored: true, contact_id: contact.id, classification: cls, action: "unsubscribed" };
    case "out_of_office": {
      const resume = new Date(mail.receivedAt.getTime() + 5 * 86_400_000).toISOString().slice(0, 10);
      await updateContact(contact.id, { next_follow_up_at: resume });
      await syncContactToTwenty(contact, { next_follow_up_at: resume });
      return { stored: true, contact_id: contact.id, classification: cls, action: "out_of_office_rescheduled" };
    }
    case "not_interested":
      if (!["Active client", "Invoice sent", "Overdue", "Completed"].includes(contact.stage)) await setStage(contact.id, "Lost", "inbound", cls.summary);
      break;
    case "interested":
      if (["New lead", "Dormant", "Lost", "Prospect"].includes(contact.stage)) await setStage(contact.id, "Qualified", "inbound", cls.summary);
      break;
    default:
      break;
  }
  await createJob({ type: "reply", contact_id: contact.id, payload: { message_id: msg.id, classification: cls.classification, summary: cls.summary }, actor: "inbound" });
  await slack.alert(`✉️ Reply from ${fullName(contact)} (${cls.classification}): ${cls.summary}. The Reply agent will draft an answer.`);
  return { stored: true, contact_id: contact.id, classification: cls, action };
}

export type { Contact };
