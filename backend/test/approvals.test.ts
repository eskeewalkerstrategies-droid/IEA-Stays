import { describe, it, expect } from "vitest";
import { useTestDb, seedContact } from "./setup.js";
import { createDraft, getDraft } from "../src/drafts.js";
import { requestSend, approveDraft, rejectDraft } from "../src/approvals.js";
import { sendDraft } from "../src/senders/index.js";
import { db, setSetting } from "../src/db.js";
import { mailOutbox } from "../src/senders/email.js";
import { memoryOutbox } from "../src/slack/client.js";
import { memoryQueue } from "../src/jobs/queue.js";
import { handleInteraction, handleSlashCommand } from "../src/http/slack.js";

useTestDb();

async function draftFor(contactId: string, type = "follow_up") {
  return createDraft({ contact_id: contactId, channel: "email", message_type: type, subject: "Quick thought on your positioning", body: "Hi Asha,\n\nOne thing I noticed.", author: "agent-followup" });
}

describe("request_send guard", () => {
  it("refuses when the contact has no email consent", async () => {
    const c = await seedContact({ email_consent: false });
    const d = await draftFor(c.id);
    const r = await requestSend(d.id, "agent-followup");
    expect(r.outcome).toBe("refused");
    expect("reason" in r && r.reason).toBe("no email consent");
    expect(memoryOutbox).toHaveLength(0);
    const [ev] = await db()`SELECT * FROM events WHERE type = 'send_refused'`;
    expect(ev.contact_id).toBe(c.id);
  });

  it("refuses when unsubscribed", async () => {
    const c = await seedContact({ unsubscribed_at: new Date() });
    const d = await draftFor(c.id);
    const r = await requestSend(d.id, "agent-followup");
    expect(r.outcome).toBe("refused");
  });

  it("queues for approval in Slack by default, then approve sends", async () => {
    const c = await seedContact();
    const d = await draftFor(c.id);
    const r = await requestSend(d.id, "agent-followup");
    expect(r.outcome).toBe("pending_approval");
    expect(memoryOutbox).toHaveLength(1);
    const blocks = memoryOutbox[0].blocks as Array<{ type: string; elements?: Array<{ action_id: string }> }>;
    const actions = blocks.find((b) => b.type === "actions");
    expect(actions?.elements?.map((e) => e.action_id)).toEqual(["approve", "edit", "reject"]);
    expect(mailOutbox).toHaveLength(0);

    await handleInteraction({ type: "block_actions", user: { id: "U1", username: "jitaksh" }, actions: [{ action_id: "approve", value: d.id }] });
    const after = await getDraft(d.id);
    expect(after?.status).toBe("queued");
    expect(memoryQueue.find((q) => q.name === "send-draft")?.data).toEqual({ draft_id: d.id });
    const [approval] = await db()`SELECT * FROM approvals WHERE draft_id = ${d.id}`;
    expect(approval.decision).toBe("approved");
    expect(approval.decided_by).toBe("slack:jitaksh");

    const sent = await sendDraft(d.id, { ignoreWindow: true });
    expect(sent.status).toBe("sent");
    expect(mailOutbox[0].to).toBe(c.email);
    expect(mailOutbox[0].text).toMatch(/Jitaksh\nEskeeWalker Strategies$/);
    expect((await getDraft(d.id))?.status).toBe("sent");
    const [contact] = await db()`SELECT follow_up_count, last_contact_at FROM contacts WHERE id = ${c.id}`;
    expect(contact.follow_up_count).toBe(1);
    expect(contact.last_contact_at).not.toBeNull();
  });

  it("edit in the modal records the lesson and sends the edited text", async () => {
    const c = await seedContact();
    const d = await draftFor(c.id);
    await requestSend(d.id, "agent-followup");
    const res = await handleInteraction({
      type: "view_submission",
      user: { id: "U1", username: "jitaksh" },
      view: { callback_id: "edit_draft", private_metadata: d.id, state: { values: { body: { value: { value: "Hi Asha,\n\nShorter." } }, subject: { value: { value: "Shorter subject" } }, note: { value: { value: "Too long, cut the preamble" } } } } },
    });
    expect(res).toEqual({ response_action: "clear" });
    const [approval] = await db()`SELECT * FROM approvals WHERE draft_id = ${d.id}`;
    expect(approval.decision).toBe("edited");
    expect(approval.edited_body).toBe("Hi Asha,\n\nShorter.");
    const [lesson] = await db()`SELECT * FROM events WHERE type = 'skill_lesson'`;
    expect(lesson.payload.note).toBe("Too long, cut the preamble");
    await sendDraft(d.id, { ignoreWindow: true });
    expect(mailOutbox[0].subject).toBe("Shorter subject");
  });

  it("reject keeps the draft unsent", async () => {
    const c = await seedContact();
    const d = await draftFor(c.id);
    await requestSend(d.id, "agent-followup");
    await rejectDraft(d.id, "slack:jitaksh", "wrong tone");
    expect((await getDraft(d.id))?.status).toBe("rejected");
    expect(memoryQueue.filter((q) => q.name === "send-draft")).toHaveLength(0);
  });

  it("safe message types skip approval and go straight to the sender", async () => {
    await setSetting("safe_send_types", ["invoice_reminder"]);
    const c = await seedContact();
    const d = await draftFor(c.id, "invoice_reminder");
    const r = await requestSend(d.id, "agent-invoice");
    expect(r.outcome).toBe("queued_for_send");
    expect(memoryOutbox).toHaveLength(0);
    const [approval] = await db()`SELECT decision, decided_by FROM approvals WHERE draft_id = ${d.id}`;
    expect(approval).toEqual({ decision: "auto", decided_by: "policy:safe_send_types" });
  });

  it("the pause switch defers sends", async () => {
    const c = await seedContact();
    const d = await draftFor(c.id);
    await approveDraft(d.id, "slack:jitaksh");
    expect(await handleSlashCommand("pause", "jitaksh")).toMatch(/paused/);
    const r = await sendDraft(d.id, { ignoreWindow: true });
    expect(r.status).toBe("deferred");
    expect(mailOutbox).toHaveLength(0);
    await handleSlashCommand("resume", "jitaksh");
    const r2 = await sendDraft(d.id, { ignoreWindow: true });
    expect(r2.status).toBe("sent");
  });

  it("the daily cap defers the 61st email", async () => {
    await setSetting("daily_send_cap", 1);
    const c = await seedContact();
    const d1 = await draftFor(c.id);
    const d2 = await draftFor(c.id);
    await approveDraft(d1.id, "x");
    await approveDraft(d2.id, "x");
    expect((await sendDraft(d1.id, { ignoreWindow: true })).status).toBe("sent");
    expect((await sendDraft(d2.id, { ignoreWindow: true })).status).toBe("deferred");
  });

  it("/ops safe add marks a type safe", async () => {
    const out = await handleSlashCommand("safe add call_reminder", "jitaksh");
    expect(out).toMatch(/call_reminder/);
    const [row] = await db()`SELECT value FROM settings WHERE key = 'safe_send_types'`;
    expect(row.value).toEqual(["call_reminder"]);
  });
});
