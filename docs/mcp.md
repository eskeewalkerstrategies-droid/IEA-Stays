# The Ops MCP server: Claude's one door

Every Claude session and scheduled agent reaches the business through one MCP server inside the backend, at `POST https://api.ops.<yourdomain>/mcp` (Streamable HTTP). It is the integration point for the whole system: a new capability is a new tool here, nothing else.

## Sign-in

Bearer token. `OPS_MCP_TOKENS` on the backend holds `name:token,name:token`. The name becomes the **actor** on every event, so the audit trail shows who did what: `jitaksh`, `agent-followup`, `agent-invoice`, `agent-intake`, and so on. One token per person and per agent. Rotate by changing the variable in Coolify.

How each client connects:

| Client | How |
|---|---|
| Cloud scheduled tasks and Claude Code sessions on this repo | `.mcp.json` in the repo root reads `OPS_MCP_URL` and `OPS_MCP_TOKEN` from the environment. Add both as secrets in the Claude Code cloud environment. |
| Claude Code on a laptop | `claude mcp add --transport http ops https://api.ops.<yourdomain>/mcp --header "Authorization: Bearer <token>"` |
| claude.ai chat as a custom connector | Needs OAuth. Not built yet; see `docs/decisions.md`. Ask in a Claude Code session instead. |

## The rule built in

Claude can read and draft freely. **`request_send` never sends.** It does one of three things, decided by code:

1. **Refuses** when the contact has no email consent, has unsubscribed, or the draft has no contact. The refusal is recorded as a `send_refused` event.
2. **Queues for approval** in Slack (the default). The draft shows with Approve, Edit and Reject buttons.
3. **Passes to the sender** only when the draft's `message_type` is in `settings.safe_send_types`, set with `/ops safe add <type>` in Slack after two clean weeks.

The sender then applies the pause switch, the send window (Mon to Sat, 09:30 to 18:30 India) and the daily cap. None of this can be changed from a prompt.

## Tools

### Reading

| Tool | What it does | May not |
|---|---|---|
| `find_contact(query)` | Search by name, email or company. Up to 10 matches with stage, score and consent. | |
| `contact_history(contact_id, limit)` | The full record: events, messages in and out, drafts, invoices, consents, open jobs, and `rules.can_email`. Read before writing to anyone. | |
| `due_followups(date?)` | Contacts whose next follow-up date is on or before a date (default today, India). | |
| `list_jobs(type?, status?)` | Jobs waiting for Claude. | |
| `list_invoices(status?)` | Invoices with due dates and reminders already sent. | |
| `next_invoice_number()` | Peeks the next EWS/INV number without reserving it. | |
| `list_content_items(status?)` | Content items with their assets. | |
| `query_metrics(source?, from, to, metric?)` | Daily numbers from Umami, Search Console, YouTube, LinkedIn once connected. | |
| `recent_events(types?, since?, limit)` | Raw events for the Analyst. | |
| `campaign_results(campaign_id?)` | listmonk campaign stats. | |
| `get_settings()` | Safe types, pause state, caps. | Change them (that is `/ops` in Slack). |

### Working a job

| Tool | What it does | May not |
|---|---|---|
| `take_next_job(type)` | Claims the next due job of a type for this actor, with the contact's history. Returns `job: null` when nothing is due. Two agents never get the same job. | Take a job that is not due. |
| `complete_job(job_id, decision, reason, draft_ids?)` | Closes a job: `wrote`, `waited`, `flagged` or `done`, with one line of reason. | |
| `fail_job(job_id, reason)` | Marks a job failed; shows in the morning health check. | |
| `create_job(type, contact_id?, content_item_id?, due_at?, payload?)` | Queues work for a later run. One open job per type per contact. | |

### Writing

| Tool | What it does | May not |
|---|---|---|
| `save_draft(...)` | Saves what Claude wrote: channel `email` (needs subject and contact), `linkedin` (post text, optional article URL), or `note`. Returns `draft_id`. | Send. |
| `update_draft(draft_id, subject?, body?)` | Edits an unsent draft. | Edit a draft already approved or sent. |
| `request_send(draft_id)` | See "The rule built in". | Send directly. Bypass consent. Bypass approval for unsafe types. |
| `change_stage(contact_id, stage, reason)` | Moves a contact between the stages in `docs/business.md` and records why. | Invent a stage. |
| `add_note(contact_id, note)` | Internal note on the contact's history. | |
| `set_next_followup(contact_id, date | working_days_from_today, reason?)` | Sets or clears the next follow-up date. | |
| `update_lead(contact_id, lead_score?, company_name?, lead_source?, phone?)` | Research results. A score of 70+ posts the "call now" alert. | Set consent. |
| `create_contact(name, email, ..., email_consent, consent_wording)` | Adds a referral or manual contact. Consent is recorded only with the wording the person agreed to. | Claim consent that was not given. |
| `create_invoice(contact_id, amount, gst, issue_date?, due_date, pdf_base64?, mark_sent?)` | Reserves the next number, stores the PDF, mirrors to Twenty. `mark_sent` moves the stage to Invoice sent. | Mark paid (that is `update_invoice`). |
| `update_invoice(invoice_id, status?, paid_at?, pdf_link?)` | Status changes. Paid stops reminders and completes the contact. | |
| `reserve_document_number(kind)` | Next EWS/QT, EWS/RP or EWS/LT number. | |
| `create_content_item`, `update_content_item`, `save_content_asset` | Phase 3: briefs, articles, posts, scripts under one content item. | Publish (publishing is an approved asset the backend posts). |
| `create_campaign_draft(name, subject, body_markdown, list)` | A listmonk draft. | Send it. |

## Adding a tool

1. Add it in `backend/src/mcp/server.ts` with a Zod input schema and a one-paragraph description that says what it may not do.
2. Record an event for any write.
3. Add a row to the tables above.
4. Add a test in `backend/test/mcp.test.ts`.

## Checking it works

In a Claude Code session on this repo with the environment variables set: "Who is due a follow-up today?" should return names from the CRM through `due_followups`.
