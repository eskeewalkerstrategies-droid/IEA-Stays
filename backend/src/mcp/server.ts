import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db, getSetting } from "../db.js";
import { contactHistory, getContact, searchContacts, setStage, addNote, setNextFollowUp, updateContact, syncContactToTwenty, canEmail, type Contact } from "../contacts.js";
import { STAGES } from "../twenty/fields.js";
import { createJob, completeJob, failJob, listJobs, takeNextJob, JOB_TYPES } from "../jobs/agentJobs.js";
import { createDraft, getDraft, updateDraft } from "../drafts.js";
import { requestSend } from "../approvals.js";
import { createInvoice, getInvoice, listInvoices, updateInvoice } from "../invoices/invoices.js";
import { nextDocumentNumber } from "../invoices/numbering.js";
import { indiaDate, addWorkingDays } from "../time.js";
import { recordEvent } from "../events.js";
import * as lm from "../listmonk/client.js";
import { storeFile } from "../files.js";
import { captureLead } from "../leads.js";
import { LEAD_CONSENT_WORDING } from "../http/leads.js";

/**
 * The Ops MCP server: Claude's one door. Every tool is documented in docs/mcp.md.
 * Rules enforced here, not in prompts: Claude can read and draft freely; request_send never sends directly;
 * consent and the safe-types list decide what happens next.
 */
const text = (s: unknown) => ({ content: [{ type: "text" as const, text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });
const err = (s: string) => ({ isError: true, content: [{ type: "text" as const, text: s }] });

function publicContact(c: Contact) {
  return {
    id: c.id,
    name: `${c.first_name} ${c.last_name}`.trim(),
    email: c.email,
    phone: c.phone,
    company: c.company_name,
    stage: c.stage,
    lead_source: c.lead_source,
    lead_score: c.lead_score,
    email_consent: c.email_consent,
    can_email: canEmail(c),
    next_follow_up_at: c.next_follow_up_at,
    last_contact_at: c.last_contact_at,
    follow_up_count: c.follow_up_count,
    tool_used: c.tool_used,
    need: c.need,
    created_at: c.created_at,
  };
}

export function buildMcpServer(actor: string): McpServer {
  const server = new McpServer({ name: "eskeewalker-ops", version: "0.1.0" });

  server.registerTool(
    "find_contact",
    { title: "Find a contact", description: "Search contacts by name, email or company. Returns up to 10 matches with stage, score and consent.", inputSchema: { query: z.string().min(1) } },
    async ({ query }) => text((await searchContacts(query)).map(publicContact)),
  );

  server.registerTool(
    "contact_history",
    { title: "Read a contact's full history", description: "Everything about one contact: record, events, messages in and out, drafts, invoices, consent records, open jobs. Read this before writing to anyone.", inputSchema: { contact_id: z.string().uuid(), limit: z.number().int().min(5).max(200).default(40) } },
    async ({ contact_id, limit }) => {
      const h = await contactHistory(contact_id, limit);
      if (!h) return err("Contact not found");
      return text({ ...h, contact: publicContact(h.contact), rules: { can_email: canEmail(h.contact) } });
    },
  );

  server.registerTool(
    "due_followups",
    { title: "List contacts due a follow-up", description: "Contacts whose next follow-up date is on or before a date (default today, India time), with consent and stage.", inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() } },
    async ({ date }) => {
      const d = date ?? indiaDate();
      const rows = await db()<Contact[]>`SELECT * FROM contacts WHERE deleted_at IS NULL AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= ${d} ORDER BY next_follow_up_at`;
      return text({ date: d, contacts: rows.map(publicContact) });
    },
  );

  server.registerTool(
    "list_jobs",
    { title: "List jobs", description: "Jobs waiting for Claude, by type and status.", inputSchema: { type: z.enum(JOB_TYPES).optional(), status: z.enum(["queued", "taken", "done", "failed", "cancelled"]).default("queued"), limit: z.number().int().max(100).default(30) } },
    async ({ type, status, limit }) => text(await listJobs({ type, status, limit })),
  );

  server.registerTool(
    "take_next_job",
    { title: "Take the next job", description: "Claims the next due job of a type for this agent and returns it with the contact's full history. Returns null when nothing is due. Finish with complete_job or fail_job.", inputSchema: { type: z.enum(JOB_TYPES) } },
    async ({ type }) => {
      const taken = await takeNextJob(type, actor);
      if (!taken) return text({ job: null, message: `No ${type} job is due.` });
      return text({ job: taken.job, history: taken.history ? { ...taken.history, contact: publicContact(taken.history.contact), rules: { can_email: canEmail(taken.history.contact) } } : null });
    },
  );

  server.registerTool(
    "complete_job",
    { title: "Mark a job done", description: "Closes a job with a short result: what was decided (wrote, waited, flagged) and why.", inputSchema: { job_id: z.string().uuid(), decision: z.enum(["wrote", "waited", "flagged", "done"]), reason: z.string().max(1000), draft_ids: z.array(z.string().uuid()).optional() } },
    async ({ job_id, decision, reason, draft_ids }) => text(await completeJob(job_id, actor, { decision, reason, draft_ids: draft_ids ?? [] })),
  );

  server.registerTool(
    "fail_job",
    { title: "Mark a job failed", description: "Use when the job cannot be done (missing data, contradiction). Say why in one line; it shows in the morning health check.", inputSchema: { job_id: z.string().uuid(), reason: z.string().max(1000) } },
    async ({ job_id, reason }) => text(await failJob(job_id, actor, reason)),
  );

  server.registerTool(
    "save_draft",
    {
      title: "Save a draft",
      description: "Saves what you wrote, linked to the job and contact. Does not send. Channels: email (needs subject), linkedin (body is the post; put an article URL in attachment_url), note (internal). Returns the draft id for request_send.",
      inputSchema: {
        contact_id: z.string().uuid().optional(),
        job_id: z.string().uuid().optional(),
        content_item_id: z.string().uuid().optional(),
        channel: z.enum(["email", "linkedin", "note"]),
        message_type: z.string().min(2).max(60),
        subject: z.string().max(200).optional(),
        body: z.string().min(1).max(20000),
        attachment_url: z.string().url().optional(),
        attachment_title: z.string().max(200).optional(),
        send_after: z.string().datetime().optional(),
      },
    },
    async (a) => {
      if (a.channel === "email" && !a.subject) return err("Email drafts need a subject");
      if (a.channel === "email" && !a.contact_id) return err("Email drafts need a contact_id");
      const d = await createDraft({
        contact_id: a.contact_id ?? null,
        job_id: a.job_id ?? null,
        content_item_id: a.content_item_id ?? null,
        channel: a.channel,
        message_type: a.message_type,
        subject: a.subject ?? null,
        body: a.body,
        attachments: a.attachment_url ? [{ filename: a.attachment_title ?? a.attachment_url, url: a.attachment_url }] : [],
        author: actor,
        send_after: a.send_after ? new Date(a.send_after) : null,
      });
      return text({ draft_id: d.id, status: d.status });
    },
  );

  server.registerTool(
    "update_draft",
    { title: "Update a draft", description: "Change the subject or body of a draft that has not been sent.", inputSchema: { draft_id: z.string().uuid(), subject: z.string().max(200).optional(), body: z.string().max(20000).optional() } },
    async ({ draft_id, subject, body }) => {
      const d = await getDraft(draft_id);
      if (!d) return err("Draft not found");
      if (!["draft", "rejected"].includes(d.status)) return err(`Draft is ${d.status}; it cannot be edited here`);
      return text(await updateDraft(draft_id, { subject, body, status: "draft" }));
    },
  );

  server.registerTool(
    "request_send",
    {
      title: "Request a send",
      description: "Asks the backend to send a draft. Never sends directly: the draft goes to Slack for approval, or, for message types marked safe, to the sender. Refused when the contact has no email consent or has unsubscribed.",
      inputSchema: { draft_id: z.string().uuid() },
    },
    async ({ draft_id }) => {
      const r = await requestSend(draft_id, actor);
      return text({ outcome: r.outcome, reason: "reason" in r ? r.reason : undefined, draft_id: r.draft.id, status: r.draft.status });
    },
  );

  server.registerTool(
    "change_stage",
    { title: "Change a contact's stage", description: `Moves a contact to a stage and records why. Stages: ${STAGES.join(", ")}.`, inputSchema: { contact_id: z.string().uuid(), stage: z.enum(STAGES), reason: z.string().max(500) } },
    async ({ contact_id, stage, reason }) => text(publicContact(await setStage(contact_id, stage, actor, reason))),
  );

  server.registerTool(
    "add_note",
    { title: "Add a note", description: "Adds an internal note to a contact's history. Use it for research findings and decisions, not for message text.", inputSchema: { contact_id: z.string().uuid(), note: z.string().min(1).max(5000) } },
    async ({ contact_id, note }) => {
      await addNote(contact_id, note, actor);
      return text({ ok: true });
    },
  );

  server.registerTool(
    "set_next_followup",
    { title: "Set the next follow-up date", description: "Sets when the Follow-up agent should look at this contact again (YYYY-MM-DD, India). Use null to stop follow-ups. working_days_from_today is a shortcut.", inputSchema: { contact_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), working_days_from_today: z.number().int().min(0).max(60).optional(), reason: z.string().max(300).optional() } },
    async ({ contact_id, date, working_days_from_today, reason }) => {
      const d = working_days_from_today != null ? addWorkingDays(indiaDate(), working_days_from_today) : (date ?? null);
      return text(publicContact(await setNextFollowUp(contact_id, d, actor, reason)));
    },
  );

  server.registerTool(
    "update_lead",
    { title: "Update lead fields", description: "Sets the lead score (0 to 100), lead source or company name after research. Scores 70+ trigger the call-now alert.", inputSchema: { contact_id: z.string().uuid(), lead_score: z.number().int().min(0).max(100).optional(), company_name: z.string().max(160).optional(), lead_source: z.string().max(40).optional(), phone: z.string().max(40).optional() } },
    async ({ contact_id, ...patch }) => {
      const before = await getContact(contact_id);
      if (!before) return err("Contact not found");
      const after = await updateContact(contact_id, patch);
      await recordEvent({ type: "lead_updated", contact_id, actor, payload: patch });
      await syncContactToTwenty(after, patch, actor);
      if (patch.lead_score != null && patch.lead_score >= 70 && (before.lead_score ?? 0) < 70) {
        const { postNewLeadAlert } = await import("../jobs/instantResponse.js");
        await postNewLeadAlert(contact_id);
      }
      return text(publicContact(after));
    },
  );

  server.registerTool(
    "create_contact",
    { title: "Create a contact by hand", description: "Adds a contact (for example from a referral). Records consent only if you state that the person agreed, with the wording used.", inputSchema: { name: z.string().min(2), email: z.string().email(), phone: z.string().optional(), company: z.string().optional(), need: z.string().optional(), source: z.enum(["referral", "linkedin", "manual", "outbound"]).default("manual"), email_consent: z.boolean().default(false), consent_wording: z.string().optional() } },
    async (a) => {
      const r = await captureLead({ name: a.name, email: a.email, phone: a.phone ?? null, company: a.company ?? null, need: a.need ?? null, email_consent: a.email_consent, consent_wording: a.consent_wording ?? (a.email_consent ? LEAD_CONSENT_WORDING : "no consent recorded"), source: a.source });
      return text({ contact: publicContact(r.contact), created: r.created, intake_job_id: r.intake_job_id });
    },
  );

  // Invoices
  server.registerTool(
    "list_invoices",
    { title: "List invoices", description: "Invoices by status (Draft, Sent, Paid, Overdue) with due dates and reminders already sent.", inputSchema: { status: z.enum(["Draft", "Sent", "Paid", "Overdue"]).optional() } },
    async ({ status }) => text(await listInvoices(status)),
  );

  server.registerTool(
    "next_invoice_number",
    { title: "Peek the next invoice number", description: "Returns the number the next invoice will get (EWS/INV/YY-YY/NNN) without reserving it. create_invoice reserves it.", inputSchema: {} },
    async () => {
      const fy = (await import("../time.js")).financialYear();
      const [row] = await db()`SELECT value FROM sequence_counters WHERE name = ${`INV/${fy}`}`;
      return text({ next: `EWS/INV/${fy}/${String((row?.value ?? 0) + 1).padStart(3, "0")}` });
    },
  );

  server.registerTool(
    "create_invoice",
    {
      title: "Create an invoice record",
      description: "Reserves the next invoice number and stores the invoice (ops and Twenty). Attach the PDF as base64 and the backend stores it and returns the link. Amount and GST in rupees, ex GST amount in amount.",
      inputSchema: { contact_id: z.string().uuid(), amount: z.number().positive(), gst: z.number().min(0).default(0), issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), pdf_base64: z.string().max(4_000_000).optional(), pdf_filename: z.string().max(120).optional(), mark_sent: z.boolean().default(false) },
    },
    async (a) => {
      const issue = a.issue_date ?? indiaDate();
      const inv = await createInvoice({ contact_id: a.contact_id, amount: a.amount, gst: a.gst, issue_date: issue, due_date: a.due_date, status: a.mark_sent ? "Sent" : "Draft", actor });
      let pdf_link: string | null = null;
      if (a.pdf_base64) {
        const name = a.pdf_filename ?? `${inv.number!.replace(/\//g, "-")}.pdf`;
        pdf_link = await storeFile("invoices", name, Buffer.from(a.pdf_base64, "base64"));
        await updateInvoice(inv.id, { pdf_link }, actor);
      }
      if (a.mark_sent) await setStage(a.contact_id, "Invoice sent", actor, `invoice ${inv.number} sent`);
      return text({ ...(await getInvoice(inv.id)), pdf_link });
    },
  );

  server.registerTool(
    "update_invoice",
    { title: "Update an invoice", description: "Set status (Sent, Paid, Overdue) or the PDF link. Marking Paid stops reminders and moves the contact to Completed.", inputSchema: { invoice_id: z.string().uuid(), status: z.enum(["Draft", "Sent", "Paid", "Overdue"]).optional(), paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), pdf_link: z.string().url().optional() } },
    async ({ invoice_id, status, paid_at, pdf_link }) => {
      const before = await getInvoice(invoice_id);
      if (!before) return err("Invoice not found");
      const inv = await updateInvoice(invoice_id, { status, paid_at: status === "Paid" ? (paid_at ?? indiaDate()) : paid_at, pdf_link }, actor);
      if (status === "Paid" && before.status !== "Paid") {
        const { onInvoicePaid } = await import("../twenty/mirror.js");
        await onInvoicePaid(inv, actor);
      } else if (status === "Sent" && inv.contact_id) {
        await setStage(inv.contact_id, "Invoice sent", actor, `invoice ${inv.number} sent`);
      }
      return text(await getInvoice(invoice_id));
    },
  );

  server.registerTool(
    "reserve_document_number",
    { title: "Reserve a quotation, report or letter number", description: "Reserves and returns the next EWS/QT, EWS/RP or EWS/LT number for the current financial year.", inputSchema: { kind: z.enum(["QT", "RP", "LT"]) } },
    async ({ kind }) => text({ number: await nextDocumentNumber(kind) }),
  );

  // Content (Phase 3)
  server.registerTool(
    "create_content_item",
    { title: "Create a content item", description: "Starts a content item (article) with its brief. Status begins at 'brief'.", inputSchema: { title: z.string().min(3).max(200), slug: z.string().regex(/^[a-z0-9-]+$/).optional(), pillar: z.string().max(80).optional(), brief: z.record(z.string(), z.unknown()) } },
    async ({ title, slug, pillar, brief }) => {
      const s = slug ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
      const [row] = await db()`INSERT INTO content_items (title, slug, pillar, status, brief) VALUES (${title}, ${s}, ${pillar ?? null}, 'brief', ${db().json(brief as never)}) RETURNING *`;
      await recordEvent({ type: "content_item_created", content_item_id: row.id, actor, payload: { title, pillar } });
      return text(row);
    },
  );

  server.registerTool(
    "list_content_items",
    { title: "List content items", description: "Content items by status: idea, brief, drafting, review, published, indexed, repurposed.", inputSchema: { status: z.string().optional(), limit: z.number().int().max(100).default(30) } },
    async ({ status, limit }) => text(await db()`SELECT ci.*, (SELECT json_agg(json_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'scheduled_for', a.scheduled_for, 'published_url', a.published_url)) FROM content_assets a WHERE a.content_item_id = ci.id) AS assets FROM content_items ci WHERE (${status ?? null}::text IS NULL OR status = ${status ?? null}) ORDER BY updated_at DESC LIMIT ${limit}`),
  );

  server.registerTool(
    "update_content_item",
    { title: "Update a content item", description: "Set status, article path, published URL, indexed date or merge data into meta.", inputSchema: { content_item_id: z.string().uuid(), status: z.string().optional(), article_path: z.string().optional(), published_url: z.string().url().optional(), indexed: z.boolean().optional(), meta: z.record(z.string(), z.unknown()).optional() } },
    async ({ content_item_id, status, article_path, published_url, indexed, meta }) => {
      const [row] = await db()`UPDATE content_items SET
          status = coalesce(${status ?? null}, status),
          article_path = coalesce(${article_path ?? null}, article_path),
          published_url = coalesce(${published_url ?? null}, published_url),
          published_at = CASE WHEN ${published_url ?? null}::text IS NOT NULL AND published_at IS NULL THEN now() ELSE published_at END,
          indexed_at = CASE WHEN ${indexed ?? false} THEN now() ELSE indexed_at END,
          meta = meta || ${db().json((meta ?? {}) as never)},
          updated_at = now()
        WHERE id = ${content_item_id} RETURNING *`;
      if (!row) return err("Content item not found");
      await recordEvent({ type: "content_item_updated", content_item_id, actor, payload: { status, published_url, indexed } });
      return text(row);
    },
  );

  server.registerTool(
    "save_content_asset",
    { title: "Save a content asset", description: "Saves a piece made from a content item: linkedin_post, linkedin_article, newsletter_section, long_script, short_script, transcript, cut_list, thumbnail_brief. Optional scheduled_for proposes a publish time.", inputSchema: { content_item_id: z.string().uuid(), kind: z.enum(["linkedin_post", "linkedin_article", "newsletter_section", "long_script", "short_script", "transcript", "cut_list", "thumbnail_brief", "seo_fix", "analyst_report", "research_brief"]), body: z.string().min(1), scheduled_for: z.string().datetime().optional(), meta: z.record(z.string(), z.unknown()).optional() } },
    async ({ content_item_id, kind, body, scheduled_for, meta }) => {
      const [row] = await db()`INSERT INTO content_assets (content_item_id, kind, body, scheduled_for, meta) VALUES (${content_item_id}, ${kind}, ${body}, ${scheduled_for ? new Date(scheduled_for) : null}, ${db().json((meta ?? {}) as never)}) RETURNING id, kind, status, scheduled_for`;
      await recordEvent({ type: "content_asset_saved", content_item_id, actor, payload: { kind, asset_id: row.id } });
      return text(row);
    },
  );

  server.registerTool(
    "query_metrics",
    { title: "Read site and search metrics", description: "Daily metrics from Umami (pageviews, visitors by page), Search Console (clicks, impressions, position by query/page), LinkedIn and YouTube once connected.", inputSchema: { source: z.enum(["umami", "gsc", "youtube", "linkedin"]).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), metric: z.string().optional(), limit: z.number().int().max(2000).default(500) } },
    async ({ source, from, to, metric, limit }) => text(await db()`SELECT source, day, metric, value, dims, content_item_id FROM content_metrics WHERE day BETWEEN ${from} AND ${to} AND (${source ?? null}::text IS NULL OR source = ${source ?? null}) AND (${metric ?? null}::text IS NULL OR metric = ${metric ?? null}) ORDER BY day DESC, value DESC LIMIT ${limit}`),
  );

  server.registerTool(
    "recent_events",
    { title: "Read recent events", description: "The last N events of any type (sends, replies, stage changes, approvals, tool uses). The Analyst agent's raw material.", inputSchema: { types: z.array(z.string()).optional(), since: z.string().datetime().optional(), limit: z.number().int().max(1000).default(200) } },
    async ({ types, since, limit }) => text(await db()`SELECT id, type, contact_id, invoice_id, content_item_id, actor, payload, created_at FROM events WHERE (${types ?? null}::text[] IS NULL OR type = ANY(${types ?? []})) AND (${since ?? null}::timestamptz IS NULL OR created_at >= ${since ?? null}) ORDER BY created_at DESC LIMIT ${limit}`),
  );

  // listmonk
  server.registerTool(
    "create_campaign_draft",
    { title: "Create a newsletter draft in listmonk", description: "Creates a draft campaign (never sends). Lists: newsletter, leads or clients. Body is Markdown.", inputSchema: { name: z.string().min(3), subject: z.string().min(3).max(200), body_markdown: z.string().min(10), list: z.enum(["newsletter", "leads", "clients"]).default("newsletter") } },
    async ({ name, subject, body_markdown, list }) => {
      if (!lm.listmonkEnabled()) return err("listmonk is not configured");
      const c = (await import("../config.js")).config();
      const id = list === "newsletter" ? c.LISTMONK_LIST_NEWSLETTER : list === "leads" ? c.LISTMONK_LIST_LEADS : c.LISTMONK_LIST_CLIENTS;
      if (!id) return err(`No list id configured for ${list}`);
      const camp = await lm.createCampaignDraft({ name, subject, body: body_markdown, listIds: [id] });
      await recordEvent({ type: "campaign_draft_created", actor, payload: { campaign_id: camp.id, subject, list } });
      return text({ campaign_id: camp.id, status: camp.status, note: "Draft only. Jitaksh sends it from listmonk after reading it." });
    },
  );

  server.registerTool(
    "campaign_results",
    { title: "Read newsletter results", description: "Sent, views, clicks and bounces for recent campaigns, or one campaign by id.", inputSchema: { campaign_id: z.number().int().optional() } },
    async ({ campaign_id }) => {
      if (!lm.listmonkEnabled()) return err("listmonk is not configured");
      return text(campaign_id ? await lm.getCampaign(campaign_id) : await lm.listCampaigns(10));
    },
  );

  server.registerTool(
    "get_settings",
    { title: "Read operating settings", description: "Safe-to-send message types, whether sends are paused, daily caps. Read-only; changes are made in Slack with /ops.", inputSchema: {} },
    async () => text({ sends_paused: await getSetting("sends_paused", false), safe_send_types: await getSetting("safe_send_types", []), daily_send_cap: await getSetting("daily_send_cap", 60), actor }),
  );

  server.registerTool(
    "create_job",
    { title: "Create a job for another agent", description: "Queues work for a later agent run, for example a research job for a topic, or a follow_up job for a contact on a date.", inputSchema: { type: z.enum(JOB_TYPES), contact_id: z.string().uuid().optional(), content_item_id: z.string().uuid().optional(), due_at: z.string().datetime().optional(), payload: z.record(z.string(), z.unknown()).optional() } },
    async ({ type, contact_id, content_item_id, due_at, payload }) => {
      const job = await createJob({ type, contact_id, content_item_id, due_at: due_at ? new Date(due_at) : undefined, payload, actor });
      return text(job ?? { job: null, message: "An open job of this type already exists for that contact" });
    },
  );

  return server;
}
