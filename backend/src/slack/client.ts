import { WebClient } from "@slack/web-api";
import { config } from "../config.js";
import { log } from "../log.js";
import type { Draft } from "../drafts.js";
import type { Contact } from "../contacts.js";

/**
 * Slack is the approval gate and the alert channel. When no bot token is configured (local dev, tests),
 * every message lands in memoryOutbox instead so the flow can still be checked.
 */
export interface SlackOut {
  channel: string;
  text: string;
  blocks?: unknown[];
  ts?: string;
  thread_ts?: string;
}
export const memoryOutbox: SlackOut[] = [];

let client: WebClient | undefined;
function web(): WebClient | null {
  const token = config().SLACK_BOT_TOKEN;
  if (!token) return null;
  if (!client) client = new WebClient(token);
  return client;
}

export function slackEnabled(): boolean {
  return Boolean(config().SLACK_BOT_TOKEN);
}

export async function postMessage(channel: string, text: string, blocks?: unknown[], thread_ts?: string): Promise<{ ts: string; channel: string }> {
  const w = web();
  if (!w) {
    const ts = `${Date.now() / 1000}`;
    memoryOutbox.push({ channel, text, blocks, ts, thread_ts });
    log.info({ channel, text }, "slack (memory)");
    return { ts, channel };
  }
  const res = await w.chat.postMessage({ channel, text, blocks: blocks as never, thread_ts });
  return { ts: res.ts as string, channel: (res.channel as string) ?? channel };
}

export async function updateMessage(channel: string, ts: string, text: string, blocks?: unknown[]): Promise<void> {
  const w = web();
  if (!w) {
    const i = memoryOutbox.findIndex((m) => m.ts === ts);
    if (i >= 0) memoryOutbox[i] = { ...memoryOutbox[i], text, blocks };
    return;
  }
  await w.chat.update({ channel, ts, text, blocks: blocks as never });
}

export async function alert(text: string, blocks?: unknown[]): Promise<void> {
  const c = config();
  const channel = c.SLACK_ALERTS_CHANNEL ?? c.SLACK_APPROVALS_CHANNEL ?? "alerts";
  await postMessage(channel, text, blocks);
}

export function approvalsChannel(): string {
  return config().SLACK_APPROVALS_CHANNEL ?? "approvals";
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** The approval card: who, what, the text, and the three buttons. */
export function draftBlocks(draft: Draft, contact: Contact | null, status?: string): unknown[] {
  const who = contact ? `${contact.first_name} ${contact.last_name}`.trim() : "(no contact)";
  const meta = [
    `*To:* ${draft.to_address ?? contact?.email ?? "?"}`,
    `*Type:* ${draft.message_type}`,
    `*Channel:* ${draft.channel}`,
    contact ? `*Stage:* ${contact.stage}` : null,
    contact?.lead_score != null ? `*Score:* ${contact.lead_score}` : null,
  ]
    .filter(Boolean)
    .join("   ");
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: truncate(`${draft.message_type.replace(/_/g, " ")}: ${who}`, 150) } },
    { type: "section", text: { type: "mrkdwn", text: meta } },
    ...(draft.subject ? [{ type: "section", text: { type: "mrkdwn", text: `*Subject:* ${truncate(draft.subject, 200)}` } }] : []),
    { type: "section", text: { type: "mrkdwn", text: truncate(draft.body, 2900) } },
  ];
  if (status) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: status }] });
  } else {
    blocks.push({
      type: "actions",
      block_id: `draft:${draft.id}`,
      elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "Approve" }, action_id: "approve", value: draft.id },
        { type: "button", text: { type: "plain_text", text: "Edit" }, action_id: "edit", value: draft.id },
        { type: "button", style: "danger", text: { type: "plain_text", text: "Reject" }, action_id: "reject", value: draft.id },
      ],
    });
  }
  return blocks;
}

export async function postDraftForApproval(draft: Draft, contact: Contact | null): Promise<{ ts: string; channel: string }> {
  const text = `${draft.message_type} for ${contact ? `${contact.first_name} ${contact.last_name}`.trim() : "?"}: ${truncate(draft.subject ?? draft.body, 120)}`;
  return postMessage(approvalsChannel(), text, draftBlocks(draft, contact));
}

export async function markDraftMessage(draft: Draft, contact: Contact | null, status: string): Promise<void> {
  if (!draft.slack_channel || !draft.slack_ts) return;
  await updateMessage(draft.slack_channel, draft.slack_ts, status, draftBlocks(draft, contact, status));
}

export function editModalView(draft: Draft): unknown {
  return {
    type: "modal",
    callback_id: "edit_draft",
    private_metadata: draft.id,
    title: { type: "plain_text", text: "Edit draft" },
    submit: { type: "plain_text", text: "Approve and send" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      ...(draft.channel === "email"
        ? [{ type: "input", block_id: "subject", label: { type: "plain_text", text: "Subject" }, element: { type: "plain_text_input", action_id: "value", initial_value: draft.subject ?? "" } }]
        : []),
      { type: "input", block_id: "body", label: { type: "plain_text", text: "Message" }, element: { type: "plain_text_input", action_id: "value", multiline: true, initial_value: draft.body } },
      { type: "input", block_id: "note", optional: true, label: { type: "plain_text", text: "What was wrong? (goes into the skill as a lesson)" }, element: { type: "plain_text_input", action_id: "value" } },
    ],
  };
}

export async function openModal(triggerId: string, view: unknown): Promise<void> {
  const w = web();
  if (!w) {
    memoryOutbox.push({ channel: "modal", text: JSON.stringify(view) });
    return;
  }
  await w.views.open({ trigger_id: triggerId, view: view as never });
}
