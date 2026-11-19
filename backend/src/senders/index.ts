import { config } from "../config.js";
import { db, getSetting } from "../db.js";
import { recordEvent } from "../events.js";
import { getDraft, updateDraft, type Draft } from "../drafts.js";
import { canEmail, getContact, updateContact, syncContactToTwenty } from "../contacts.js";
import { sendEmail } from "./email.js";
import { postToLinkedIn } from "./linkedin.js";
import { indiaDate, nextSendSlot, withinSendWindow } from "../time.js";
import { log } from "../log.js";
import { enqueue, Q } from "../jobs/queue.js";

export type SendResult = { status: "sent"; message_id: string } | { status: "deferred"; until: Date } | { status: "skipped"; reason: string };

/**
 * Carries an approved draft out on its channel. Runs as the pg-boss "send-draft" worker.
 * Checks, in order: pause switch, draft status, consent, send window, daily cap. Records a messages row.
 */
export async function sendDraft(draftId: string, opts: { ignoreWindow?: boolean } = {}): Promise<SendResult> {
  const draft = await getDraft(draftId);
  if (!draft) return { status: "skipped", reason: "draft missing" };
  if (draft.status !== "queued" && draft.status !== "approved") return { status: "skipped", reason: `draft is ${draft.status}` };

  if (await getSetting<boolean>("sends_paused", false)) {
    const until = new Date(Date.now() + 30 * 60_000);
    await enqueue(Q.sendDraft, { draft_id: draft.id }, { singletonKey: `send:${draft.id}:${until.getTime()}`, startAfter: until });
    return { status: "deferred", until };
  }

  const needsWindow = draft.channel === "email" && !opts.ignoreWindow && draft.message_type !== "instant_response" && draft.message_type !== "call_reminder";
  if (needsWindow && !withinSendWindow()) {
    const until = nextSendSlot();
    await enqueue(Q.sendDraft, { draft_id: draft.id }, { singletonKey: `send:${draft.id}:${until.getTime()}`, startAfter: until });
    return { status: "deferred", until };
  }

  const cap = await getSetting<number>("daily_send_cap", 60);
  const [{ count }] = await db()`SELECT count(*)::int AS count FROM messages WHERE direction = 'out' AND channel = 'email' AND occurred_at::date = current_date`;
  if (draft.channel === "email" && Number(count) >= cap) {
    const until = new Date(Date.now() + 60 * 60_000);
    await enqueue(Q.sendDraft, { draft_id: draft.id }, { singletonKey: `send:${draft.id}:${until.getTime()}`, startAfter: until });
    await recordEvent({ type: "send_deferred_cap", draft_id: draft.id, contact_id: draft.contact_id, payload: { cap } });
    return { status: "deferred", until };
  }

  const contact = draft.contact_id ? await getContact(draft.contact_id) : null;
  try {
    let externalId = "";
    if (draft.channel === "email") {
      if (!contact) throw new Error("email draft without contact");
      const gate = canEmail(contact);
      if (!gate.ok) {
        await updateDraft(draft.id, { status: "failed" });
        await recordEvent({ type: "send_refused", contact_id: contact.id, draft_id: draft.id, payload: { reason: gate.reason } });
        return { status: "skipped", reason: gate.reason! };
      }
      const to = draft.to_address ?? contact.email!;
      const lastInbound = await db()`SELECT external_id FROM messages WHERE contact_id = ${contact.id} AND direction = 'in' AND channel = 'email' ORDER BY occurred_at DESC LIMIT 1`;
      const sent = await sendEmail({
        to,
        subject: draft.subject ?? "(no subject)",
        text: withSignature(draft.body),
        inReplyTo: lastInbound[0]?.external_id ?? undefined,
        references: lastInbound[0]?.external_id ?? undefined,
        attachments: draft.attachments.filter((a) => a.path).map((a) => ({ filename: a.filename, path: a.path, contentType: a.content_type })),
        listUnsubscribe: `${config().PUBLIC_URL}/unsubscribe?c=${contact.id}`,
      });
      externalId = sent.messageId;
      await db()`INSERT INTO messages (contact_id, draft_id, channel, direction, message_type, from_address, to_address, subject, body, external_id, occurred_at)
        VALUES (${contact.id}, ${draft.id}, 'email', 'out', ${draft.message_type}, ${sent.from}, ${to}, ${sent.subject}, ${sent.text}, ${externalId}, now())`;
    } else if (draft.channel === "linkedin") {
      const meta = (draft.attachments[0] ?? {}) as { url?: string; filename?: string };
      const res = await postToLinkedIn(draft.body, { articleUrl: meta.url, title: meta.filename });
      externalId = res.id;
      await db()`INSERT INTO messages (contact_id, draft_id, channel, direction, message_type, body, external_id, occurred_at)
        VALUES (${draft.contact_id}, ${draft.id}, 'linkedin', 'out', ${draft.message_type}, ${draft.body}, ${externalId}, now())`;
    } else {
      throw new Error(`No sender for channel ${draft.channel}`);
    }

    await updateDraft(draft.id, { status: "sent" });
    await recordEvent({ type: "message_sent", contact_id: draft.contact_id, draft_id: draft.id, content_item_id: draft.content_item_id, payload: { channel: draft.channel, message_type: draft.message_type, external_id: externalId } });
    if (contact) {
      const isFollowUp = ["follow_up", "intake_first_message", "rebooking"].includes(draft.message_type);
      const patch = { last_contact_at: new Date(), follow_up_count: isFollowUp ? contact.follow_up_count + 1 : contact.follow_up_count };
      const after = await updateContact(contact.id, patch);
      await syncContactToTwenty(after, { last_contact_at: patch.last_contact_at });
    }
    return { status: "sent", message_id: externalId };
  } catch (err) {
    log.error({ err, draftId }, "send failed");
    await updateDraft(draft.id, { status: "failed" });
    await recordEvent({ type: "send_failed", contact_id: draft.contact_id, draft_id: draft.id, payload: { error: String(err) } });
    throw err;
  }
}

export function withSignature(body: string): string {
  const sig = config().MAIL_SIGNATURE;
  const trimmed = body.trimEnd();
  if (sig && !trimmed.endsWith(sig.split("\n")[0]) && !trimmed.includes(sig)) return `${trimmed}\n\n${sig}`;
  return trimmed;
}

export { indiaDate };
