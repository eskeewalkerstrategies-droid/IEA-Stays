import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8080),
  PUBLIC_URL: z.string().default("http://localhost:8080"),
  DATABASE_URL: z.string(),
  LOG_LEVEL: z.string().default("info"),
  TZ_NAME: z.string().default("Asia/Kolkata"),

  // Ops MCP: "name:token,name:token". One token per person or agent.
  OPS_MCP_TOKENS: z.string().default(""),

  // Twenty CRM
  TWENTY_API_URL: z.string().optional(),
  TWENTY_API_KEY: z.string().optional(),
  TWENTY_WEBHOOK_SECRET: z.string().optional(),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_APPROVALS_CHANNEL: z.string().optional(),
  SLACK_ALERTS_CHANNEL: z.string().optional(),

  // Email out
  MAIL_TRANSPORT: z.enum(["smtp", "log"]).default("log"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("Jitaksh Jain <founder@example.com>"),
  MAIL_REPLY_TO: z.string().optional(),
  MAIL_SIGNATURE: z.string().default("Jitaksh\nEskeeWalker Strategies"),

  // Email in
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().default(993),
  IMAP_USER: z.string().optional(),
  IMAP_PASS: z.string().optional(),
  IMAP_MAILBOX: z.string().default("INBOX"),

  // Claude API for instant tasks on the server
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_CLASSIFY_MODEL: z.string().default("claude-haiku-5-5"),
  CLAUDE_TOOL_MODEL: z.string().default("claude-opus-5-5"),

  // listmonk
  LISTMONK_URL: z.string().optional(),
  LISTMONK_USER: z.string().optional(),
  LISTMONK_PASS: z.string().optional(),
  LISTMONK_LIST_LEADS: z.coerce.number().optional(),
  LISTMONK_LIST_CLIENTS: z.coerce.number().optional(),
  LISTMONK_LIST_NEWSLETTER: z.coerce.number().optional(),

  // Booking page webhook (Cal.com or Cal.diy)
  BOOKING_WEBHOOK_SECRET: z.string().optional(),
  BOOKING_URL: z.string().default("https://cal.com/eskeewalker/strategy-call"),

  // LinkedIn
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_ACCESS_TOKEN: z.string().optional(),
  LINKEDIN_TOKEN_EXPIRES_AT: z.string().optional(),
  LINKEDIN_PERSON_URN: z.string().optional(),

  // Lead form spam check (optional)
  TURNSTILE_SECRET: z.string().optional(),

  // Optional webhook the backend calls to wake the Intake agent at once
  AGENT_WAKE_URL: z.string().optional(),
  AGENT_WAKE_TOKEN: z.string().optional(),

  // Files
  FILES_DIR: z.string().default("./data/files"),
  BACKUP_STATUS_FILE: z.string().optional(),

  // Metrics (Phase 3)
  UMAMI_API_URL: z.string().optional(),
  UMAMI_API_TOKEN: z.string().optional(),
  UMAMI_WEBSITE_ID: z.string().optional(),
  GSC_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GSC_SITE_URL: z.string().optional(),
});

export type Config = z.infer<typeof schema> & { mcpTokens: Map<string, string> };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const mcpTokens = new Map<string, string>();
  for (const pair of parsed.OPS_MCP_TOKENS.split(",")) {
    const [name, token] = pair.split(":").map((s) => s.trim());
    if (name && token) mcpTokens.set(token, name);
  }
  return { ...parsed, mcpTokens };
}

let cached: Config | undefined;
export function config(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}
export function resetConfig(): void {
  cached = undefined;
}
