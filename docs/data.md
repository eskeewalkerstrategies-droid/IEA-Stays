# The ops database, in plain words

One Postgres database named `ops`. Twenty keeps its own database; `contacts` and `invoices` here are mirrors kept current by Twenty's webhooks, so agents and reports work from one place. Migrations live in `backend/migrations/`. A new table or column is added here the same day.

## settings

Small switches the backend reads. Changed from Slack with `/ops`.

| Key | Meaning | Default |
|---|---|---|
| `sends_paused` | When true, nothing goes out. Queued sends wait. | false |
| `safe_send_types` | Message types that send without approval. | [] |
| `daily_send_cap` | Maximum outgoing emails per day. | 60 |
| `tool_daily_cap_usd` | Claude API spend allowed by free tools per day. | 2.0 |
| `tool_visitor_daily_runs` | Free tool runs per visitor per day. | 3 |
| `imap_last_uid` | Where the inbox reader stopped. | set by code |
| `linkedin_token` | Token, expiry and profile URN from the connect flow. | set by code |

## contacts

One row per person. Mirrors a Twenty Person, plus a few working fields.

| Column | Meaning |
|---|---|
| `id` | Our id. Used everywhere else. |
| `twenty_id` | The person's id in Twenty. Null until synced. |
| `first_name`, `last_name`, `email`, `phone` | As given. Email is unique (case-insensitive) among live contacts. |
| `company_name`, `company_twenty_id` | Their company. |
| `stage` | One of the stages in `docs/business.md`. |
| `lead_source` | website_form, free_tool, referral, linkedin, newsletter, outbound, manual. |
| `lead_score` | 0 to 100, set by the Intake agent. 70+ is hot. |
| `email_consent`, `consent_at` | Whether we may email them, and since when. The `consents` table has the proof. |
| `next_follow_up_at` | The date the Follow-up agent should next look at them. Null means no follow-up planned. |
| `last_contact_at` | Last message in either direction. |
| `follow_up_count` | How many follow-ups we have sent since the last reply. Three is the limit for leads. |
| `owner` | Who in the team owns the relationship. |
| `tool_used` | The free tool that captured them, if any. |
| `need` | What they said they need, from the form. |
| `unsubscribed_at` | Set when they opt out by any route. Blocks all email. |
| `deleted_at` | Set when deleted in Twenty. Hidden from searches. |

## invoices

Mirror of the Invoice object in Twenty, plus which reminders went out.

| Column | Meaning |
|---|---|
| `number` | EWS/INV/YY-YY/NNN, unique. The backend assigns it. |
| `contact_id` | Who is billed. |
| `amount`, `gst` | Rupees. Amount is ex GST. |
| `issue_date`, `due_date`, `paid_at` | Dates. |
| `status` | Draft, Sent, Paid, Overdue. |
| `pdf_link` | Where the PDF is stored (`/files/invoices/...`). |
| `reminders_sent` | List of reminder keys already sent: before_3, due, after_7, after_14, paid. |

## events

Everything that happened, one row each. Agents read these for context; the Analyst reads them on Friday. Never edited or deleted.

| Column | Meaning |
|---|---|
| `type` | What happened. See the list below. |
| `contact_id`, `invoice_id`, `content_item_id`, `job_id`, `draft_id` | What it was about. Any may be empty. |
| `actor` | Who did it: `system`, `twenty`, `booking`, `inbound`, `slack:<name>`, or the MCP token name such as `agent-followup`. |
| `payload` | Details as JSON. |

Event types in use: `lead_created`, `lead_returned`, `lead_updated`, `contact_created`, `contact_updated`, `contact_deleted`, `stage_changed`, `note_added`, `next_follow_up_set`, `job_created`, `job_taken`, `job_done`, `job_failed`, `job_cancelled`, `draft_saved`, `draft_pending_approval`, `draft_auto_approved`, `draft_approved`, `draft_edited_and_approved`, `draft_rejected`, `draft_cancelled`, `skill_lesson`, `send_refused`, `send_deferred_cap`, `message_sent`, `send_failed`, `instant_response_skipped`, `reply_received`, `reply_classified`, `inbound_unmatched`, `unsubscribed`, `email_bounced`, `newsletter_unsubscribed`, `call_booked`, `call_rescheduled`, `call_cancelled`, `call_missed`, `call_happened`, `invoice_created`, `invoice_updated`, `invoice_paid`, `daily_jobs_ran`, `sends_paused`, `sends_resumed`, `safe_type_added`, `safe_type_removed`, `tool_used`, `tool_cap_reached`, `listmonk_synced`, `campaign_draft_created`, `content_item_created`, `content_item_updated`, `content_asset_saved`, `metrics_pulled`, `linkedin_connected`, `twenty_sync_failed`, `mcp_error`.

## jobs

Work waiting for Claude. (Background work for code uses pg-boss's own tables in the `pgboss` schema.)

| Column | Meaning |
|---|---|
| `type` | intake, follow_up, rebooking, invoice_create, invoice_reminder, reply, research, write, repurpose, seo_audit, analyst_report. |
| `status` | queued, taken, done, failed, cancelled. |
| `contact_id`, `invoice_id`, `content_item_id` | What it is about. |
| `payload` | Extra context, such as which reminder (`before_3`) or the reply's classification. |
| `due_at` | When it may be taken. |
| `taken_at`, `taken_by` | Which agent has it. A job taken more than 2 hours ago can be taken again. |
| `completed_at`, `result` | How it ended: the decision and reason from `complete_job`. |

Only one open job per type per contact, and per reminder per invoice. Creating a duplicate is a quiet no-op.

## drafts

What Claude (or a template) wrote, waiting to be approved and sent.

| Column | Meaning |
|---|---|
| `job_id`, `contact_id`, `content_item_id` | Where it came from. |
| `channel` | email, linkedin, newsletter, note. |
| `message_type` | instant_response, intake_first_message, follow_up, call_reminder, rebooking, invoice_cover, invoice_reminder, reply_answer, tool_result, linkedin_post, newsletter. |
| `to_address`, `subject`, `body`, `attachments` | The message. |
| `status` | draft, pending_approval, approved, rejected, queued, sent, failed. |
| `author` | Who wrote it (actor name). |
| `slack_channel`, `slack_ts` | The Slack message with the buttons, so it can be updated. |
| `send_after` | Do not send before this time. |

## approvals

Who approved or rejected what, and the edit they made. The audit trail and the source of lessons for skills.

| Column | Meaning |
|---|---|
| `draft_id` | The draft. |
| `decision` | approved, edited, rejected, auto. |
| `decided_by` | `slack:<name>`, or `policy:safe_send_types` / `policy:instant_response` for automatic ones. |
| `note` | What was wrong, from the Edit modal. |
| `original_body`, `edited_body` | Before and after. |

## messages

Every message sent or received, any channel.

| Column | Meaning |
|---|---|
| `contact_id`, `draft_id` | Who, and which draft produced it. |
| `channel`, `direction` | email, linkedin; in or out. |
| `message_type` | As on the draft; `reply` for inbound. |
| `from_address`, `to_address`, `subject`, `body` | The content. Inbound bodies have quoted history removed. |
| `external_id` | The email Message-ID or LinkedIn post id. Unique per channel. |
| `in_reply_to` | The Message-ID it answers. |
| `classification` | For inbound: interested, question, not_now, not_interested, out_of_office, unsubscribe, other. |
| `meta` | Confidence, summary, sender name. |
| `occurred_at` | When it was sent or received. |

## consents

Proof of consent: what was shown, when, from where.

| Column | Meaning |
|---|---|
| `contact_id`, `email` | Who. |
| `channel` | email (only channel in this build). |
| `granted` | true for consent, false for withdrawal. |
| `source` | website_form, free_tool, manual, reply, unsubscribe_link, listmonk_unsubscribe, bounce_hard. |
| `wording` | The exact consent text the person saw. |
| `ip`, `user_agent` | Where the form was filled. |

## content_items, content_assets, content_metrics (Phase 3)

- **content_items**: one article from idea to indexed. `slug`, `title`, `pillar`, `status` (idea, brief, drafting, review, published, indexed, repurposed), `brief` (JSON: question, what top results say and miss, our point of view, sources, outline, video outline), `article_path` in `site/`, `published_url`, `published_at`, `indexed_at`.
- **content_assets**: pieces made from an item: `kind` (linkedin_post, linkedin_article, newsletter_section, long_script, short_script, transcript, cut_list, thumbnail_brief, seo_fix, analyst_report, research_brief), `body`, `status`, `scheduled_for`, `published_url`.
- **content_metrics**: daily numbers: `source` (umami, gsc, youtube, linkedin), `day`, `metric`, `value`, `dims` (path, query, page), linked to a content item when the path matches a slug.

## tool_runs

Each free-tool use: `tool`, `contact_id`, `email`, `ip`, `input`, `output`, token counts and `cost_usd`. The caps in settings read from here.

## sequence_counters

Document numbers per type and financial year, for example `INV/26-27` = 7 means the next invoice is EWS/INV/26-27/008.
