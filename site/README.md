# Website (Astro)

Static site deployed by Coolify on every push to `main`. Articles are Markdown files in `src/content/articles/`; the Writer agent adds them on `article/<slug>` branches and merging publishes.

```bash
npm install
cp .env.example .env    # PUBLIC_API_URL points at the Ops backend
npm run dev
```

- `src/components/LeadForm.astro`: the one lead form. Its consent text must match `LEAD_CONSENT_WORDING` in the backend.
- `src/pages/tools/`: one page per free tool, matching `backend/src/tools/registry.ts`.
- `public/robots.txt`: allows AI search crawlers.

The existing website's design and pages still need porting in here, keeping every page address. See `docs/roadmap.md` step 2.1.
