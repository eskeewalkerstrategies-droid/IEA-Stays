# Secrets list

Every password and key lives in two places only: Coolify's environment variables for the service that uses it, and your private password manager. None is written into this repository. This page lists the **names**, where each is used, and how to get it.

| Name | Used by | How to get it |
|---|---|---|
| `POSTGRES_SUPERUSER_PASSWORD` | Postgres, backups | You generate it (letters and numbers) |
| `DATABASE_URL` | ops-backend | `postgres://ops:<pw>@postgres:5432/ops` |
| `OPS_MCP_TOKEN` | ops-backend, Claude Code cloud environment | Generate: `openssl rand -hex 32`. One token per person or agent so the audit trail shows who did what: `OPS_MCP_TOKENS` holds `name:token,name:token` |
| `TWENTY_API_URL`, `TWENTY_API_KEY` | ops-backend | Twenty, Settings, API & Webhooks |
| `TWENTY_WEBHOOK_SECRET` | ops-backend | Set when creating the webhook in Twenty |
| `TWENTY_APP_SECRET` | Twenty | Generate once. **Losing it loses every stored credential in the CRM.** |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | ops-backend | Slack app, OAuth & Permissions; Basic Information |
| `SLACK_APPROVALS_CHANNEL` | ops-backend | Channel ID of the approvals channel |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | ops-backend | Your mail provider (Amazon SES or the Hostinger mailbox) |
| `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASS` | ops-backend inbound reader | Same mailbox |
| `ANTHROPIC_API_KEY` | ops-backend (reply classifier, free tools) | console.anthropic.com, with a monthly spend cap of about $20 |
| `LISTMONK_URL`, `LISTMONK_USER`, `LISTMONK_PASS` | ops-backend | listmonk admin, Settings, Users (API user) |
| `BOOKING_WEBHOOK_SECRET` | ops-backend | Set when creating the webhook in Cal.com or Cal.diy |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | ops-backend | LinkedIn developer app |
| `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_TOKEN_EXPIRES_AT`, `LINKEDIN_PERSON_URN` | ops-backend | Produced by the one-time connect flow `GET /auth/linkedin` |
| `TURNSTILE_SECRET` | ops-backend lead form spam check | Cloudflare Turnstile (optional) |
| `B2_KEY_ID`, `B2_APP_KEY` | server rclone | Backblaze B2 application key limited to the bucket |
| `UMAMI_API_URL`, `UMAMI_API_TOKEN`, `UMAMI_WEBSITE_ID` | ops-backend metrics (Phase 3) | Umami settings |
| `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL` | ops-backend metrics (Phase 3) | Google Cloud service account added to Search Console |

## Accounts to arrange (only you can)

Start the slow ones in week 1.

| Item | Needed for | Wait |
|---|---|---|
| Hostinger KVM 4 with the Coolify template | Everything | Minutes |
| GitHub organisation with this private repository | Everything | Minutes |
| Claude Code connected to the repository for each team seat | Agents | Minutes |
| Anthropic API key with a monthly spend cap | Instant tasks on the server | Minutes |
| Written answer from Anthropic sales on automated use of the plan | Confidence in the design | Days |
| Slack channel and a Slack app for approvals | Approval gate | Minutes |
| Email sending account (SES or similar) on the main domain, SPF, DKIM, DMARC | Newsletter and nurture | 1 to 3 days |
| 2 secondary domains with 3 mailboxes each (Phase 5 cold outreach) | Ageing | 3 weeks warm-up |
| Booking page (Cal.com free plan or Cal.diy) | Call bookings | Minutes |
| Off-site backup storage (Backblaze B2 or Cloudflare R2) | Backups | Minutes |
| LinkedIn developer app with "Share on LinkedIn" | Personal posting (Phase 3) | Minutes |
| Google Cloud project with YouTube Data API and Search Console API | Phase 3 and 4 | Minutes, quota audit weeks |
