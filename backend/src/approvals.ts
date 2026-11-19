import { db, getSetting } from "./db.js";
import { recordEvent } from "./events.js";
import { getDraft, updateDraft, type Draft } from "./drafts.js";
import { canEmail, getContact, type Contact } from "./contacts.js";
import * as slack from "./slack/client.js";
import { enqueue, Q } from "./jobs/queue.js";

export type SendRequestOutcome =
  | { outcome: "queued_for_send"; draft: Draft }
  | { outcome: "pending_approval"; draft: Draft }
  | { outcome: "refused"; reason: string; draft: Draft };

/**
 * The one rule the MCP server enforces: Claude never sends. request_send either queues the draft for
 * approval in Slack, or, for message types listed in settings.safe_send_types, hands it to the sender.
 * Consent and unsubscribe are checked here, in code, before either path.
 */
export async function requestSend(draftId: string, actor: string): Promise<SendRequestOutcome> {
  const draft = await getDraft(draftId);
  if (!draft) throw new Error("Draft not found");
  if (draft.status !== "draft" && draft.status !== "rejected") {
    return { outcome: "refused", reason: `draft is ${draft.status}`, draft };
  }
  const contact = draft.contact_id ? await getContact(draft.contact_id) : null;

  if (draft.channel === "email") {
    if (!contact) return { outcome: "refused", reason: "email drafts need a contact", draft };
    const gate = canEmail(contact);
    if (!gate.ok) {
      await recordEvent({ type: "send_refused", contact_id: contact.id, draft_id: draft.id, actor, payload: { reason: gate.reason } });
      return { outcome: "refused", reason: gate.reason!, draft };
    }
    if (!draft.to_address) await updateDraft(draft.id, { to_address: contact.email });
  }
  if (draft.channel === "note") return { outcome: "refused", reason: "notes are not sent", draft };

  const safeTypes = await getSetting<string[]>("safe_send_types", []);
  if (safeTypes.includes(draft.message_type)) {
    const d = await updateDraft(draft.id, { status: "approved" });
    await db()`INSERT INTO approvals (draft_id, decision, decided_by, note) VALUES (${draft.id}, 'auto', 'policy:safe_send_types', ${"message type is marked safe"})`;
    await recordEvent({ type: "draft_auto_approved", contact_id: draft.contact_id, draft_id: draft.id, actor, payload: { message_type: draft.message_type } });
    await queueSend(d);
    return { outcome: "queued_for_send", draft: (await getDraft(draft.id))! };
  }

  const posted = await slack.postDraftForApproval({ ...draft, to_address: draft.to_address ?? contact?.email ?? null }, contact);
  const d = await updateDraft(draft.id, { status: "pending_approval", slack_channel: posted.channel, slack_ts: posted.ts });
  await recordEvent({ type: "draft_pending_approval", contact_id: draft.contact_id, draft_id: draft.id, actor, payload: { message_type: draft.message_type } });
  return { outcome: "pending_approval", draft: d };
}

export async function queueSend(draft: Draft): Promise<void> {
  await updateDraft(draft.id, { status: "queued" });
  await enqueue(Q.sendDraft, { draft_id: draft.id }, { singletonKey: `send:${draft.id}`, startAfter: draft.send_after ?? undefined });
}

export async function approveDraft(draftId: string, decidedBy: string, edits?: { body?: string; subject?: string; note?: string }): Promise<Draft> {
  const draft = await getDraft(draftId);
  if (!draft) throw new Error("Draft not found");
  if (draft.status !== "pending_approval" && draft.status !== "draft") throw new Error(`Draft is ${draft.status}`);
  const edited = Boolean(edits?.body && edits.body !== draft.body) || Boolean(edits?.subject && edits.subject !== draft.subject);
  await db()`INSERT INTO approvals (draft_id, decision, decided_by, note, original_body, edited_body)
    VALUES (${draft.id}, ${edited ? "edited" : "approved"}, ${decidedBy}, ${edits?.note ?? null}, ${draft.body}, ${edited ? (edits?.body ?? draft.body) : null})`;
  const updated = await updateDraft(draft.id, {
    status: "approved",
    body: edits?.body ?? draft.body,
    subject: edits?.subject ?? draft.subject,
  });
  await recordEvent({
    type: edited ? "draft_edited_and_approved" : "draft_approved",
    contact_id: draft.contact_id,
    draft_id: draft.id,
    actor: decidedBy,
    payload: { message_type: draft.message_type, note: edits?.note ?? null, edited },
  });
  const contact = draft.contact_id ? await getContact(draft.contact_id) : null;
  await slack.markDraftMessage(updated, contact, edited ? `✏️ Edited and approved by ${decidedBy}. Sending.` : `✅ Approved by ${decidedBy}. Sending.`);
  await queueSend(updated);
  return updated;
}

export async function rejectDraft(draftId: string, decidedBy: string, note?: string): Promise<Draft> {
  const draft = await getDraft(draftId);
  if (!draft) throw new Error("Draft not found");
  await db()`INSERT INTO approvals (draft_id, decision, decided_by, note, original_body) VALUES (${draft.id}, 'rejected', ${decidedBy}, ${note ?? null}, ${draft.body})`;
  const updated = await updateDraft(draft.id, { status: "rejected" });
  await recordEvent({ type: "draft_rejected", contact_id: draft.contact_id, draft_id: draft.id, actor: decidedBy, payload: { note: note ?? null } });
  const contact = draft.contact_id ? await getContact(draft.contact_id) : null;
  await slack.markDraftMessage(updated, contact, `❌ Rejected by ${decidedBy}${note ? `: ${note}` : ""}`);
  return updated;
}

export async function contactForDraft(draft: Draft): Promise<Contact | null> {
  return draft.contact_id ? getContact(draft.contact_id) : null;
}
