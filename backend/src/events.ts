import { db } from "./db.js";

export interface EventInput {
  type: string;
  contact_id?: string | null;
  invoice_id?: string | null;
  content_item_id?: string | null;
  job_id?: string | null;
  draft_id?: string | null;
  actor?: string;
  payload?: Record<string, unknown>;
}

/** Every thing that happens becomes one row in events. Agents read these for context. */
export async function recordEvent(e: EventInput): Promise<number> {
  const [row] = await db()`
    INSERT INTO events (type, contact_id, invoice_id, content_item_id, job_id, draft_id, actor, payload)
    VALUES (${e.type}, ${e.contact_id ?? null}, ${e.invoice_id ?? null}, ${e.content_item_id ?? null},
            ${e.job_id ?? null}, ${e.draft_id ?? null}, ${e.actor ?? "system"}, ${db().json((e.payload ?? {}) as never)})
    RETURNING id`;
  return Number(row.id);
}
