import { config } from "../config.js";
import { db } from "../db.js";
import { recordEvent } from "../events.js";
import { canEmail, fullName, getContact } from "../contacts.js";
import { createDraft } from "../drafts.js";
import { sendDraft } from "../senders/index.js";
import * as slack from "../slack/client.js";

/**
 * The fixed, pre-approved reply every new lead gets within a minute. No Claude in the loop: speed comes
 * from code, personalisation follows from the Intake agent. Edit the wording here; it is the one template
 * Jitaksh approved. Also posts the Slack alert with the "call now" prompt for hot leads.
 */
export function instantResponseText(firstName: string, need: string | null, bookingUrl: string): { subject: string; body: string } {
  const needLine = need ? `You wrote: "${need.trim().slice(0, 300)}". ` : "";
  return {
    subject: "Got your message",
    body:
      `Hi ${firstName || "there"},\n\n` +
      `Thanks for writing to EskeeWalker Strategies. ${needLine}I read every enquiry myself and will reply with a proper answer within one working day.\n\n` +
      `If you would rather talk it through, pick a slot here and we will do a 30-minute call: ${bookingUrl}\n\n` +
      `Before the call, one question to think about: what would have to be true in 90 days for this to have been worth your time?`,
  };
}

export async function sendInstantResponse(contactId: string): Promise<{ sent: boolean; reason?: string }> {
  const contact = await getContact(contactId);
  if (!contact) return { sent: false, reason: "contact missing" };
  const gate = canEmail(contact);
  if (!gate.ok) {
    await recordEvent({ type: "instant_response_skipped", contact_id: contact.id, payload: { reason: gate.reason } });
    return { sent: false, reason: gate.reason };
  }
  const [already] = await db()`SELECT 1 FROM messages WHERE contact_id = ${contact.id} AND message_type = 'instant_response' AND direction = 'out' LIMIT 1`;
  if (already) return { sent: false, reason: "already sent" };

  const text = instantResponseText(contact.first_name, contact.need, config().BOOKING_URL);
  const draft = await createDraft({ contact_id: contact.id, channel: "email", message_type: "instant_response", to_address: contact.email, subject: text.subject, body: text.body, author: "system" });
  await db()`UPDATE drafts SET status = 'approved' WHERE id = ${draft.id}`;
  await db()`INSERT INTO approvals (draft_id, decision, decided_by, note) VALUES (${draft.id}, 'auto', 'policy:instant_response', 'fixed pre-approved template')`;
  const res = await sendDraft(draft.id, { ignoreWindow: true });
  return { sent: res.status === "sent", reason: res.status === "sent" ? undefined : res.status };
}

export async function postNewLeadAlert(contactId: string): Promise<void> {
  const c = await getContact(contactId);
  if (!c) return;
  const hot = (c.lead_score ?? 0) >= 70;
  const lines = [
    `*New lead:* ${fullName(c)}${c.company_name ? ` (${c.company_name})` : ""}`,
    `Email: ${c.email ?? "-"}   Phone: ${c.phone ?? "-"}   Source: ${c.lead_source ?? "-"}${c.tool_used ? ` / ${c.tool_used}` : ""}`,
    c.need ? `> ${c.need.slice(0, 500)}` : null,
    hot ? `🔥 *Call now.* Score ${c.lead_score}.` : c.lead_score != null ? `Score ${c.lead_score}. The Intake agent will draft a first message.` : "Intake agent will score within the hour.",
  ].filter(Boolean);
  await slack.alert(lines.join("\n"));
}
