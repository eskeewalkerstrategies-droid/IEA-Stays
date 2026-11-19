import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";
import { recordEvent } from "../events.js";
import { approveDraft, rejectDraft } from "../approvals.js";
import { getDraft } from "../drafts.js";
import * as slack from "../slack/client.js";
import { recordCallHappened, recordCallMissed } from "../jobs/reminders.js";
import { collectHealth, formatHealth } from "../jobs/health.js";
import { log } from "../log.js";

/** Slack interactions (buttons, modals) and the /ops slash command. Signature checked on every request. */
export function verifySlackSignature(raw: string, timestamp: string | undefined, signature: string | undefined): boolean {
  const secret = config().SLACK_SIGNING_SECRET;
  if (!secret) return config().NODE_ENV !== "production";
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface Interaction {
  type: string;
  user?: { id: string; username?: string; name?: string };
  trigger_id?: string;
  actions?: Array<{ action_id: string; value?: string; block_id?: string }>;
  view?: { callback_id: string; private_metadata: string; state: { values: Record<string, Record<string, { value?: string }>> } };
}

function who(i: Interaction): string {
  return `slack:${i.user?.username ?? i.user?.name ?? i.user?.id ?? "unknown"}`;
}

export async function handleInteraction(i: Interaction): Promise<{ response_action?: string; text?: string } | null> {
  const actor = who(i);
  if (i.type === "block_actions") {
    const a = i.actions?.[0];
    if (!a) return null;
    switch (a.action_id) {
      case "approve":
        await approveDraft(a.value!, actor);
        return null;
      case "reject":
        await rejectDraft(a.value!, actor);
        return null;
      case "edit": {
        const d = await getDraft(a.value!);
        if (d && i.trigger_id) await slack.openModal(i.trigger_id, slack.editModalView(d));
        return null;
      }
      case "call_happened": {
        const [contactId] = (a.value ?? "").split("|");
        await recordCallHappened(contactId, actor);
        return null;
      }
      case "call_missed": {
        const [contactId] = (a.value ?? "").split("|");
        await recordCallMissed(contactId, actor);
        return null;
      }
      default:
        return null;
    }
  }
  if (i.type === "view_submission" && i.view?.callback_id === "edit_draft") {
    const v = i.view.state.values;
    const body = v.body?.value?.value ?? "";
    const subject = v.subject?.value?.value;
    const note = v.note?.value?.value;
    await approveDraft(i.view.private_metadata, actor, { body, subject, note });
    if (note) await recordEvent({ type: "skill_lesson", draft_id: i.view.private_metadata, actor, payload: { note } });
    return { response_action: "clear" };
  }
  return null;
}

export async function handleSlashCommand(text: string, user: string): Promise<string> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const actor = `slack:${user}`;
  switch ((cmd ?? "").toLowerCase()) {
    case "pause":
      await setSetting("sends_paused", true);
      await recordEvent({ type: "sends_paused", actor });
      return "⏸️ All outgoing sends are paused. Queued sends will wait. `/ops resume` to continue.";
    case "resume":
      await setSetting("sends_paused", false);
      await recordEvent({ type: "sends_resumed", actor });
      return "▶️ Sends resumed.";
    case "status":
      return formatHealth(await collectHealth());
    case "safe": {
      const types = await getSetting<string[]>("safe_send_types", []);
      const [action, type] = rest;
      if (action === "add" && type) {
        if (!types.includes(type)) types.push(type);
        await setSetting("safe_send_types", types);
        await recordEvent({ type: "safe_type_added", actor, payload: { type } });
        return `Marked \`${type}\` as safe to send without approval. Now: ${types.join(", ")}`;
      }
      if (action === "remove" && type) {
        const next = types.filter((t) => t !== type);
        await setSetting("safe_send_types", next);
        await recordEvent({ type: "safe_type_removed", actor, payload: { type } });
        return `Removed \`${type}\`. Now: ${next.join(", ") || "nothing"}`;
      }
      return `Safe types: ${types.join(", ") || "nothing yet"}. Use \`/ops safe add <type>\` or \`/ops safe remove <type>\`.`;
    }
    default:
      return "Commands: `/ops pause`, `/ops resume`, `/ops status`, `/ops safe [add|remove <type>]`";
  }
}

export const slackRoutes = new Hono();

slackRoutes.post("/slack/interactions", async (c) => {
  const raw = await c.req.text();
  if (!verifySlackSignature(raw, c.req.header("x-slack-request-timestamp"), c.req.header("x-slack-signature"))) return c.text("bad signature", 401);
  const params = new URLSearchParams(raw);
  const payload = params.get("payload");
  if (!payload) return c.text("no payload", 400);
  try {
    const res = await handleInteraction(JSON.parse(payload) as Interaction);
    return res ? c.json(res) : c.text("");
  } catch (err) {
    log.error({ err }, "slack interaction failed");
    return c.json({ response_action: "errors", errors: { body: String(err) } });
  }
});

slackRoutes.post("/slack/commands", async (c) => {
  const raw = await c.req.text();
  if (!verifySlackSignature(raw, c.req.header("x-slack-request-timestamp"), c.req.header("x-slack-signature"))) return c.text("bad signature", 401);
  const params = new URLSearchParams(raw);
  const text = await handleSlashCommand(params.get("text") ?? "", params.get("user_name") ?? params.get("user_id") ?? "unknown");
  return c.json({ response_type: "ephemeral", text });
});
