import { db } from "./db.js";
import { recordEvent } from "./events.js";

export type Channel = "email" | "linkedin" | "newsletter" | "note";
export type DraftStatus = "draft" | "pending_approval" | "approved" | "rejected" | "queued" | "sent" | "failed";

export interface Draft {
  id: string;
  job_id: string | null;
  contact_id: string | null;
  content_item_id: string | null;
  channel: Channel;
  message_type: string;
  to_address: string | null;
  subject: string | null;
  body: string;
  attachments: Array<{ filename: string; path?: string; url?: string; content_type?: string }>;
  status: DraftStatus;
  author: string | null;
  slack_channel: string | null;
  slack_ts: string | null;
  send_after: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDraftInput {
  job_id?: string | null;
  contact_id?: string | null;
  content_item_id?: string | null;
  channel: Channel;
  message_type: string;
  to_address?: string | null;
  subject?: string | null;
  body: string;
  attachments?: Draft["attachments"];
  author: string;
  send_after?: Date | null;
}

export async function createDraft(input: CreateDraftInput): Promise<Draft> {
  const sql = db();
  const [draft] = await sql<Draft[]>`
    INSERT INTO drafts (job_id, contact_id, content_item_id, channel, message_type, to_address, subject, body, attachments, author, send_after)
    VALUES (${input.job_id ?? null}, ${input.contact_id ?? null}, ${input.content_item_id ?? null}, ${input.channel}, ${input.message_type},
            ${input.to_address ?? null}, ${input.subject ?? null}, ${input.body}, ${sql.json((input.attachments ?? []) as never)},
            ${input.author}, ${input.send_after ?? null})
    RETURNING *`;
  await recordEvent({
    type: "draft_saved",
    contact_id: draft.contact_id,
    content_item_id: draft.content_item_id,
    job_id: draft.job_id,
    draft_id: draft.id,
    actor: input.author,
    payload: { channel: draft.channel, message_type: draft.message_type, subject: draft.subject },
  });
  return draft;
}

export async function getDraft(id: string): Promise<Draft | null> {
  const [row] = await db()<Draft[]>`SELECT * FROM drafts WHERE id = ${id}`;
  return row ?? null;
}

export async function updateDraft(id: string, patch: Partial<Pick<Draft, "body" | "subject" | "status" | "slack_channel" | "slack_ts" | "send_after" | "to_address">>): Promise<Draft> {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const [row] = await db()<Draft[]>`UPDATE drafts SET ${db()(clean as never)}, updated_at = now() WHERE id = ${id} RETURNING *`;
  return row;
}

export async function listDrafts(status: DraftStatus, limit = 50): Promise<Draft[]> {
  return db()<Draft[]>`SELECT * FROM drafts WHERE status = ${status} ORDER BY created_at DESC LIMIT ${limit}`;
}

/** Drops unsent drafts for a contact (for example after they reply or unsubscribe). */
export async function cancelOpenDrafts(contactId: string, actor: string, reason: string): Promise<number> {
  const rows = await db()<Draft[]>`
    UPDATE drafts SET status = 'rejected', updated_at = now()
    WHERE contact_id = ${contactId} AND status IN ('draft','pending_approval','approved','queued')
    RETURNING id`;
  for (const d of rows) await recordEvent({ type: "draft_cancelled", contact_id: contactId, draft_id: d.id, actor, payload: { reason } });
  return rows.length;
}
