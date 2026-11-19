import { db } from "../db.js";
import { recordEvent } from "../events.js";
import { contactHistory, type ContactHistory } from "../contacts.js";

/** Work waiting for Claude. These are the rows in ops.jobs, not pg-boss jobs. */
export const JOB_TYPES = [
  "intake",
  "follow_up",
  "rebooking",
  "invoice_create",
  "invoice_reminder",
  "reply",
  "research",
  "write",
  "repurpose",
  "seo_audit",
  "analyst_report",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export interface Job {
  id: string;
  type: JobType;
  status: "queued" | "taken" | "done" | "failed" | "cancelled";
  contact_id: string | null;
  invoice_id: string | null;
  content_item_id: string | null;
  payload: Record<string, unknown>;
  due_at: Date;
  taken_at: Date | null;
  taken_by: string | null;
  completed_at: Date | null;
  result: unknown;
  attempts: number;
  created_at: Date;
}

export interface CreateJobInput {
  type: JobType;
  contact_id?: string | null;
  invoice_id?: string | null;
  content_item_id?: string | null;
  payload?: Record<string, unknown>;
  due_at?: Date;
  actor?: string;
}

/** Creates a job unless an open one of the same type already exists for that contact or invoice reminder. */
export async function createJob(input: CreateJobInput): Promise<Job | null> {
  const sql = db();
  const rows = await sql<Job[]>`
    INSERT INTO jobs (type, contact_id, invoice_id, content_item_id, payload, due_at)
    VALUES (${input.type}, ${input.contact_id ?? null}, ${input.invoice_id ?? null}, ${input.content_item_id ?? null},
            ${sql.json((input.payload ?? {}) as never)}, ${input.due_at ?? new Date()})
    ON CONFLICT DO NOTHING
    RETURNING *`;
  const job = rows[0];
  if (!job) return null;
  await recordEvent({
    type: "job_created",
    contact_id: job.contact_id,
    invoice_id: job.invoice_id,
    content_item_id: job.content_item_id,
    job_id: job.id,
    actor: input.actor ?? "system",
    payload: { type: job.type, due_at: job.due_at },
  });
  return job;
}

export async function getJob(id: string): Promise<Job | null> {
  const [row] = await db()<Job[]>`SELECT * FROM jobs WHERE id = ${id}`;
  return row ?? null;
}

export async function listJobs(opts: { status?: string; type?: string; limit?: number } = {}): Promise<Job[]> {
  const sql = db();
  return sql<Job[]>`
    SELECT * FROM jobs
    WHERE (${opts.status ?? null}::text IS NULL OR status = ${opts.status ?? null})
      AND (${opts.type ?? null}::text IS NULL OR type = ${opts.type ?? null})
    ORDER BY due_at ASC LIMIT ${opts.limit ?? 50}`;
}

export interface TakenJob {
  job: Job;
  history: ContactHistory | null;
}

/** Claims the next due job of a type for an agent. Uses SKIP LOCKED so two agents never take the same job. */
export async function takeNextJob(type: JobType, actor: string): Promise<TakenJob | null> {
  const sql = db();
  const rows = await sql<Job[]>`
    UPDATE jobs SET status = 'taken', taken_at = now(), taken_by = ${actor}, attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE type = ${type} AND due_at <= now()
        AND (status = 'queued' OR (status = 'taken' AND taken_at < now() - interval '2 hours'))
      ORDER BY due_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
    RETURNING *`;
  const job = rows[0];
  if (!job) return null;
  await recordEvent({ type: "job_taken", contact_id: job.contact_id, invoice_id: job.invoice_id, content_item_id: job.content_item_id, job_id: job.id, actor });
  const history = job.contact_id ? await contactHistory(job.contact_id) : null;
  return { job, history };
}

export async function completeJob(id: string, actor: string, result?: Record<string, unknown>): Promise<Job> {
  const sql = db();
  const [job] = await sql<Job[]>`
    UPDATE jobs SET status = 'done', completed_at = now(), result = ${sql.json((result ?? {}) as never)}
    WHERE id = ${id} AND status IN ('queued','taken') RETURNING *`;
  if (!job) throw new Error("Job not open");
  await recordEvent({ type: "job_done", contact_id: job.contact_id, invoice_id: job.invoice_id, content_item_id: job.content_item_id, job_id: job.id, actor, payload: result ?? {} });
  return job;
}

export async function failJob(id: string, actor: string, reason: string): Promise<Job> {
  const sql = db();
  const [job] = await sql<Job[]>`
    UPDATE jobs SET status = 'failed', completed_at = now(), result = ${sql.json({ reason })}
    WHERE id = ${id} AND status IN ('queued','taken') RETURNING *`;
  if (!job) throw new Error("Job not open");
  await recordEvent({ type: "job_failed", contact_id: job.contact_id, job_id: job.id, actor, payload: { reason } });
  return job;
}

/** Cancels open jobs for a contact, for example when they reply or unsubscribe. */
export async function cancelOpenJobs(contactId: string, types: readonly string[] | null, actor: string, reason: string): Promise<number> {
  const sql = db();
  const rows = await sql<Job[]>`
    UPDATE jobs SET status = 'cancelled', completed_at = now(), result = ${sql.json({ reason })}
    WHERE contact_id = ${contactId} AND status IN ('queued','taken')
      AND (${types === null} OR type = ANY(${types ?? []}))
    RETURNING id, type`;
  for (const j of rows) await recordEvent({ type: "job_cancelled", contact_id: contactId, job_id: j.id, actor, payload: { type: j.type, reason } });
  return rows.length;
}
