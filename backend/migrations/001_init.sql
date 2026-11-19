-- EskeeWalker Ops: core tables. Explained in docs/data.md.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('sends_paused', 'false'),
  ('safe_send_types', '[]'),
  ('daily_send_cap', '60'),
  ('tool_daily_cap_usd', '2.0'),
  ('tool_visitor_daily_runs', '3')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twenty_id          text UNIQUE,
  first_name         text NOT NULL DEFAULT '',
  last_name          text NOT NULL DEFAULT '',
  email              text,
  phone              text,
  company_name       text,
  company_twenty_id  text,
  stage              text NOT NULL DEFAULT 'New lead',
  lead_source        text,
  lead_score         integer,
  email_consent      boolean NOT NULL DEFAULT false,
  consent_at         timestamptz,
  next_follow_up_at  date,
  last_contact_at    timestamptz,
  follow_up_count    integer NOT NULL DEFAULT 0,
  owner              text,
  tool_used          text,
  need               text,
  unsubscribed_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_lower_idx ON contacts (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contacts_stage_idx ON contacts (stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contacts_next_follow_up_idx ON contacts (next_follow_up_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twenty_id       text UNIQUE,
  number          text UNIQUE,
  contact_id      uuid REFERENCES contacts(id),
  amount          numeric(12,2) NOT NULL DEFAULT 0,
  gst             numeric(12,2) NOT NULL DEFAULT 0,
  issue_date      date,
  due_date        date,
  status          text NOT NULL DEFAULT 'Draft',
  paid_at         date,
  pdf_link        text,
  reminders_sent  jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status);

CREATE TABLE IF NOT EXISTS content_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text UNIQUE,
  title          text NOT NULL,
  pillar         text,
  status         text NOT NULL DEFAULT 'idea',
  brief          jsonb,
  article_path   text,
  published_url  text,
  published_at   timestamptz,
  indexed_at     timestamptz,
  meta           jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  body             text,
  status           text NOT NULL DEFAULT 'draft',
  scheduled_for    timestamptz,
  published_url    text,
  published_at     timestamptz,
  meta             jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_assets_item_idx ON content_assets (content_item_id);

CREATE TABLE IF NOT EXISTS content_metrics (
  id               bigserial PRIMARY KEY,
  content_item_id  uuid REFERENCES content_items(id) ON DELETE SET NULL,
  source           text NOT NULL,
  day              date NOT NULL,
  metric           text NOT NULL,
  value            numeric NOT NULL DEFAULT 0,
  dims             jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, day, metric, dims)
);

CREATE TABLE IF NOT EXISTS jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text NOT NULL,
  status           text NOT NULL DEFAULT 'queued',
  contact_id       uuid REFERENCES contacts(id) ON DELETE CASCADE,
  invoice_id       uuid REFERENCES invoices(id) ON DELETE CASCADE,
  content_item_id  uuid REFERENCES content_items(id) ON DELETE CASCADE,
  payload          jsonb NOT NULL DEFAULT '{}',
  due_at           timestamptz NOT NULL DEFAULT now(),
  taken_at         timestamptz,
  taken_by         text,
  completed_at     timestamptz,
  result           jsonb,
  attempts         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_open_idx ON jobs (type, due_at) WHERE status IN ('queued', 'taken');
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_open_per_contact_idx ON jobs (type, contact_id) WHERE status IN ('queued', 'taken') AND contact_id IS NOT NULL AND invoice_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_open_per_invoice_idx ON jobs (type, invoice_id, (payload->>'reminder')) WHERE status IN ('queued', 'taken') AND invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid REFERENCES jobs(id) ON DELETE SET NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE CASCADE,
  content_item_id  uuid REFERENCES content_items(id) ON DELETE SET NULL,
  channel          text NOT NULL,
  message_type     text NOT NULL,
  to_address       text,
  subject          text,
  body             text NOT NULL,
  attachments      jsonb NOT NULL DEFAULT '[]',
  status           text NOT NULL DEFAULT 'draft',
  author           text,
  slack_channel    text,
  slack_ts         text,
  send_after       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drafts_status_idx ON drafts (status);
CREATE INDEX IF NOT EXISTS drafts_contact_idx ON drafts (contact_id);

CREATE TABLE IF NOT EXISTS approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id       uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  decision       text NOT NULL,
  decided_by     text NOT NULL,
  note           text,
  original_body  text,
  edited_body    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  draft_id        uuid REFERENCES drafts(id) ON DELETE SET NULL,
  channel         text NOT NULL,
  direction       text NOT NULL,
  message_type    text,
  from_address    text,
  to_address      text,
  subject         text,
  body            text,
  external_id     text,
  in_reply_to     text,
  classification  text,
  meta            jsonb NOT NULL DEFAULT '{}',
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_external_id_idx ON messages (channel, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_contact_idx ON messages (contact_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid REFERENCES contacts(id) ON DELETE CASCADE,
  email       text,
  channel     text NOT NULL DEFAULT 'email',
  granted     boolean NOT NULL,
  source      text NOT NULL,
  wording     text NOT NULL,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consents_contact_idx ON consents (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id               bigserial PRIMARY KEY,
  type             text NOT NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  invoice_id       uuid REFERENCES invoices(id) ON DELETE SET NULL,
  content_item_id  uuid REFERENCES content_items(id) ON DELETE SET NULL,
  job_id           uuid,
  draft_id         uuid,
  actor            text NOT NULL DEFAULT 'system',
  payload          jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_contact_idx ON events (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_type_idx ON events (type, created_at DESC);

CREATE TABLE IF NOT EXISTS tool_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool        text NOT NULL,
  contact_id  uuid REFERENCES contacts(id) ON DELETE SET NULL,
  email       text,
  ip          text,
  input       jsonb NOT NULL,
  output      text,
  tokens_in   integer NOT NULL DEFAULT 0,
  tokens_out  integer NOT NULL DEFAULT 0,
  cost_usd    numeric(10,5) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_runs_day_idx ON tool_runs (created_at);

CREATE TABLE IF NOT EXISTS sequence_counters (
  name   text PRIMARY KEY,
  value  integer NOT NULL DEFAULT 0
);
