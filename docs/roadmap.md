# Roadmap: what exists, what is next

Phases follow the EskeeWalker Automation Build Guide (17 November 2026). WhatsApp (Step 2.7) is removed from this build.

## Phase 0: Foundations

| Step | Status | Where |
|---|---|---|
| 0.1 Business rules | Drafted, needs the open questions answered | `docs/business.md` |
| 0.2 Repository | Done | this repo |
| 0.3 Server | Checklist written, server not yet provisioned | `infra/server-setup.md` |
| 0.4 Database | Coolify steps written | `infra/postgres.md` |
| 0.5 Backups and secrets list | Scripts and docs written, first restore test pending | `infra/backup.md`, `infra/scripts/`, `infra/secrets.md` |
| 0.6 Slow clocks | Manual: domains, mailboxes, Anthropic sales question | `infra/secrets.md` lists what to arrange |

## Phase 1: CRM and follow-up engine

| Step | Status | Where |
|---|---|---|
| 1.1 Twenty install and fields | Field list and Coolify steps written; install pending | `docs/twenty.md` |
| 1.2 Ops tables | Done, migrations and tests | `backend/migrations`, `docs/data.md` |
| 1.3 Ops backend | Done: Twenty webhook receiver, daily job creator, Slack approvals, SMTP sender, tests, Dockerfile | `backend/` |
| 1.4 MCP server | Done: Streamable HTTP, bearer auth, 12 tools, send guard | `backend/src/mcp`, `docs/mcp.md` |
| 1.5 Skills | Done: follow-up, invoice | `.claude/skills/` |
| 1.6 Scheduled agents | Prompts and times written; create the tasks in Claude Code | `docs/scheduled-tasks.md` |
| 1.7 Draft-only fortnight | Starts when 1.6 runs | `ops.settings.safe_send_types` stays empty |

## Phase 2: Lead capture and nurture

| Step | Status | Where |
|---|---|---|
| 2.1 Website in repo | Astro scaffold with the lead form; design and existing pages still to be ported | `site/` |
| 2.2 Lead form with consent | Done: component plus backend endpoint, consent row, intake job, spam protection | `site/src/components/LeadForm.astro`, `backend/src/http/leads.ts` |
| 2.3 Instant response | Done: fixed email plus Slack alert | `backend/src/jobs/instantResponse.ts` |
| 2.4 Booking page | Done: webhook handler, reminders, rebooking job. Needs the booking tool's webhook pointed at it | `backend/src/http/booking.ts` |
| 2.5 Intake agent | Done: skill, agent, hourly schedule, backend wake call | `.claude/skills/intake` |
| 2.6 listmonk | Done: client, nightly sync by stage and consent, bounce and unsubscribe webhook, MCP tools | `backend/src/listmonk` |
| 2.7 WhatsApp | Removed | `docs/decisions.md` |
| 2.8 Reply agent | Done: IMAP inbox reader, Haiku classifier with keyword fallback, unsubscribe handled in code, reply skill | `backend/src/inbound`, `.claude/skills/reply` |
| 2.9 First free tool | Done: backend endpoint with per-visitor spend cap and a sample tool page | `backend/src/http/tools.ts`, `site/src/pages/tools/` |

## Phase 3: Content and SEO engine

| Step | Status | Where |
|---|---|---|
| 3.1 Data sources | Umami and Search Console pull jobs written as stubs that need credentials; `content_metrics` table exists | `backend/src/jobs/metrics.ts` |
| 3.2 Content strategy | Template to fill | `docs/content.md` |
| 3.3 to 3.5, 3.7, 3.8 Agents | Skills and agent files written; scheduled tasks to create | `.claude/skills/research`, `writer`, `repurpose`, `seo`, `analyst` |
| 3.6 LinkedIn sender | Done for personal profile text posts, with token expiry alert | `backend/src/senders/linkedin.ts` |

## Phase 4: Video pipeline

Not built. `video/README.md` holds the plan and the cut list JSON schema so the editor skill and renderer agree on a format before either is written.

## Phase 5: Outreach, voice, later modules

Not built. Prospect stage exists in the data model so cold outbound slots in later.

## Monitoring

Done: morning health check to Slack, `/ops pause` and `/ops resume`.
