import { config } from "../config.js";
import { db } from "../db.js";
import { recordEvent } from "../events.js";
import { canEmail, fullName, getContact, setStage, setNextFollowUp } from "../contacts.js";
import { createDraft } from "../drafts.js";
import { requestSend } from "../approvals.js";
import { createJob } from "./agentJobs.js";
import * as slack from "../slack/client.js";
import { addWorkingDays, indiaDate } from "../time.js";

/** Fixed call reminder sent 24 hours and 1 hour before a booked call. Goes through request_send, so it waits for approval until call_reminder is marked safe. */
export function callReminderText(firstName: string, whenIndia: string, joinUrl: string | null, hoursBefore: number): { subject: string; body: string } {
  const when = hoursBefore === 1 ? "in about an hour" : "tomorrow";
  return {
    subject: hoursBefore === 1 ? "Our call in an hour" : "Our call tomorrow",
    body:
      `Hi ${firstName || "there"},\n\n` +
      `A quick note that our call is ${when}: ${whenIndia} (India time).${joinUrl ? `\n\nJoin link: ${joinUrl}` : ""}\n\n` +
      `If anything has changed, reply here and we will move it.`,
  };
}

export async function sendCallReminder(contactId: string, startAt: string, hoursBefore: number, joinUrl: string | null): Promise<void> {
  const c = await getContact(contactId);
  if (!c || c.stage !== "Call booked") return;
  if (!canEmail(c).ok) return;
  const whenIndia = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" }).format(new Date(startAt));
  const text = callReminderText(c.first_name, whenIndia, joinUrl, hoursBefore);
  const draft = await createDraft({ contact_id: c.id, channel: "email", message_type: "call_reminder", to_address: c.email, subject: text.subject, body: text.body, author: "system" });
  await requestSend(draft.id, "system");
}

/** After the call's end time, ask in Slack whether it happened. "Missed" creates a rebooking job. */
export async function postCallOutcomePrompt(contactId: string, bookingUid: string): Promise<void> {
  const c = await getContact(contactId);
  if (!c) return;
  await slack.postMessage(slack.approvalsChannel(), `Did the call with ${fullName(c)} happen?`, [
    { type: "section", text: { type: "mrkdwn", text: `*Call check:* did the call with *${fullName(c)}* (${c.email ?? "-"}) happen?` } },
    {
      type: "actions",
      block_id: `call:${c.id}`,
      elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "Happened" }, action_id: "call_happened", value: `${c.id}|${bookingUid}` },
        { type: "button", style: "danger", text: { type: "plain_text", text: "Missed" }, action_id: "call_missed", value: `${c.id}|${bookingUid}` },
      ],
    },
  ]);
}

export async function recordCallHappened(contactId: string, actor: string): Promise<void> {
  await recordEvent({ type: "call_happened", contact_id: contactId, actor });
  await setNextFollowUp(contactId, addWorkingDays(indiaDate(), 1), actor, "proposal or summary after the call");
}

export async function recordCallMissed(contactId: string, actor: string): Promise<void> {
  await recordEvent({ type: "call_missed", contact_id: contactId, actor });
  await setStage(contactId, "Qualified", actor, "call missed");
  await createJob({ type: "rebooking", contact_id: contactId, payload: { reason: "missed call", booking_url: config().BOOKING_URL }, actor });
  await db()`UPDATE contacts SET next_follow_up_at = NULL WHERE id = ${contactId}`;
}
