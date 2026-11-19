# Decisions already made

Do not reopen these without a new reason. Each has a date and the reason it was taken.

| Date | Decision | Reason |
|---|---|---|
| 2026-11-17 | No n8n and no paid automation tools. Open-source projects are the base; Claude writes the rest. | Fewer subscriptions, one repository, no vendor lock-in. |
| 2026-11-17 | Claude is the only brain. Code does delivery, Claude does judgment. | Keeps sending deterministic and auditable. |
| 2026-11-17 | No payment gateway for now. Invoices are marked paid by hand. | Gateway only when live classes are sold through the platform (Phase 5). |
| 2026-11-17 | Content starts on the website as a full article, then becomes LinkedIn posts, scripts and the newsletter. | Google should see our site as the original. |
| 2026-11-17 | Voice agent is built last, only for people who asked to be contacted. | TRAI calling rules in India; a provider confirmed in writing first. |
| 2026-11-17 | Start with one personal channel and one faceless channel. | Prove the pipeline before expanding. |
| 2026-11-17 | Agents run as Claude Code cloud scheduled tasks, not cron on our server with the subscription login. | Anthropic consumer terms bar automated access on consumer plans; server-side instant tasks use an API key with a spend cap. |
| 2026-11-17 | Twenty is the CRM, version pinned, encryption key in the secrets record. | Custom objects, API, webhooks. Breaks on upgrades, so pin. |
| 2026-11-17 | listmonk 6.2 for newsletter and nurture. Not the 7.0 beta. | Light, transactional API, bounce handling. |
| 2026-11-17 | Skip Postiz. The backend posts to LinkedIn and YouTube directly. | Postiz needs Temporal and 3 to 4 GB of memory. |
| 2026-11-17 | Website in Astro, not Next.js. | Simplest stack for a content site kept in Git. |
| 2026-11-17 | HyperFrames for titles, graphics and faceless videos, not Remotion. | Remotion needs a paid licence above 3 employees. |
| 2026-11-17 | Invoices generated with our own brand PDF skill. | No open-source invoicing tool handles Indian GST properly. |
| 2026-11-17 | Hostinger KVM VPS with the Coolify template. | Cloud hosting has no root access, so no Docker, Postgres or FFmpeg. |
| 2026-11-19 | WhatsApp is removed from this build. Consent forms keep only an email tick box. | Deferred by Jitaksh. Re-add as a sender plus one MCP tool when wanted. |
| 2026-11-19 | Scheduled tasks reach the MCP server through `.mcp.json` in this repo with a token from the cloud environment's secrets, not through a claude.ai custom connector. | Avoids building an OAuth server now. A custom connector with OAuth can be added later without changing the tools. |
| 2026-11-19 | The ops database keeps a mirror of Twenty contacts and invoices (`ops.contacts`, `ops.invoices`), filled by Twenty webhooks and a nightly sync. | Agents and tests work without calling Twenty for every read, and the CRM can be swapped later. |
