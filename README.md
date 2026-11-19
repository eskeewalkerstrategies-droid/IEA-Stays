# EskeeWalker Ops

The one repository that runs EskeeWalker Strategies' client operations and marketing. Claude does the judgment work (scoring, research, writing, planning edits). Code does delivery (receiving forms, queueing jobs, sending email, posting).

If you are not a developer, this page tells you what each folder is for and where to look when something needs changing.

## What the system does

1. Something happens: a form is filled, a reply arrives, a booking is made, or the clock reaches a set time.
2. The Ops backend records it in the database and adds a job to the queue.
3. A scheduled Claude agent wakes, takes the job through the MCP door, and writes a draft back.
4. Low-risk drafts send at once. Everything else waits in Slack for your approval.
5. The backend sends it and records the result. The next research run reads that result.

## Folders

| Folder | What it holds | When you open it |
|---|---|---|
| `CLAUDE.md` | The standing instructions every Claude session reads | When Claude keeps getting something wrong about how we work |
| `docs/business.md` | Who we sell to, offers, prices, tone of voice, client stages | When an email or article sounds wrong |
| `docs/data.md` | Every database table and column in plain words | When you want to know what is stored |
| `docs/mcp.md` | Every tool Claude can call and what it may not do | When Claude claims it cannot do something |
| `docs/scheduled-tasks.md` | The schedule and prompt for each agent | When you set up or change a scheduled task |
| `docs/decisions.md` | Decisions already made, so they are not reopened | Before proposing a tool change |
| `docs/roadmap.md` | What is built, what is next, what was deferred | At the start of each phase |
| `.claude/skills/` | One written procedure per task Claude repeats | When you correct a draft and want Claude to learn it |
| `.claude/agents/` | One file per agent role | When adding a new agent |
| `backend/` | The Ops backend and the MCP server | Developers only |
| `site/` | The website, with the lead form and free tools | When adding a page or an article |
| `video/` | Video pipeline (Phase 4) | When the video phase starts |
| `infra/` | Server setup checklist, Postgres, backups, the secrets list | When setting up or restoring the server |

## Running it locally

```bash
cd backend
cp .env.example .env     # fill in DATABASE_URL at least
npm install
npm run migrate
npm run dev
```

The backend listens on port 8080. Health check: `GET /health`. The MCP endpoint is `POST /mcp` with a bearer token.

## Deploying

Everything deploys through Coolify from this repository. `backend/Dockerfile` builds the Ops backend. The website in `site/` builds as a static Astro site. See `infra/server-setup.md`.

## When something breaks

1. Open Claude Code on this repository and describe what you saw, with the Slack message or screenshot.
2. Ask: "Find the cause, explain it to me in plain words, and propose a fix. Do not change anything yet."
3. Approve the fix, then ask Claude to add a test so the same failure is caught next time.
4. If sending is misbehaving, type `/ops pause` in Slack first. It stops all outgoing sends until `/ops resume`.
