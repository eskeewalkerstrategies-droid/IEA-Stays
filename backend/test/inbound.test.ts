import { describe, it, expect } from "vitest";
import { useTestDb, seedContact } from "./setup.js";
import { handleInbound, stripQuoted } from "../src/inbound/handle.js";
import { classifyByKeywords } from "../src/inbound/classify.js";
import { db } from "../src/db.js";
import { createJob } from "../src/jobs/agentJobs.js";
import { createDraft } from "../src/drafts.js";
import { requestSend } from "../src/approvals.js";

useTestDb();

describe("inbound replies", () => {
  it("keyword classifier: unsubscribe always wins", () => {
    expect(classifyByKeywords("Interesting, but please remove me from your list").classification).toBe("unsubscribe");
    expect(classifyByKeywords("I am out of office until Monday").classification).toBe("out_of_office");
    expect(classifyByKeywords("Not interested, thanks").classification).toBe("not_interested");
    expect(classifyByKeywords("Sounds good, let's talk next week?").classification).toBe("interested");
    expect(classifyByKeywords("What does the sprint cost?").classification).toBe("question");
  });

  it("strips quoted history", () => {
    expect(stripQuoted("Yes let's do it.\n\nOn Tue, Nov 18, Jitaksh wrote:\n> old text")).toBe("Yes let's do it.");
  });

  it("a reply stops the sequence, classifies, changes stage and creates a reply job", async () => {
    const c = await seedContact({ stage: "New lead", next_follow_up_at: "2026-11-25" });
    await createJob({ type: "follow_up", contact_id: c.id });
    const d = await createDraft({ contact_id: c.id, channel: "email", message_type: "follow_up", subject: "s", body: "b", author: "agent" });
    await requestSend(d.id, "agent");

    const r = await handleInbound({ messageId: "<m1@x>", from: c.email.toUpperCase(), subject: "Re: s", text: "Sounds good, let's book a call.\n\n> quoted", receivedAt: new Date() });
    expect(r.action).toBe("interested");
    const [contact] = await db()`SELECT stage, next_follow_up_at FROM contacts WHERE id = ${c.id}`;
    expect(contact.stage).toBe("Qualified");
    expect(contact.next_follow_up_at).toBeNull();
    const jobs = await db()`SELECT type, status FROM jobs WHERE contact_id = ${c.id} ORDER BY created_at`;
    expect(jobs).toEqual([{ type: "follow_up", status: "cancelled" }, { type: "reply", status: "queued" }]);
    const [draft] = await db()`SELECT status FROM drafts WHERE id = ${d.id}`;
    expect(draft.status).toBe("rejected");
    const [msg] = await db()`SELECT direction, classification, body FROM messages WHERE contact_id = ${c.id}`;
    expect(msg.direction).toBe("in");
    expect(msg.classification).toBe("interested");
    expect(msg.body).toBe("Sounds good, let's book a call.");
  });

  it("unsubscribe is acted on by code with no reply job", async () => {
    const c = await seedContact();
    const r = await handleInbound({ messageId: "<m2@x>", from: c.email, subject: "Re:", text: "Please unsubscribe me", receivedAt: new Date() });
    expect(r.action).toBe("unsubscribed");
    const [contact] = await db()`SELECT email_consent, unsubscribed_at FROM contacts WHERE id = ${c.id}`;
    expect(contact.email_consent).toBe(false);
    expect(contact.unsubscribed_at).not.toBeNull();
    const jobs = await db()`SELECT 1 FROM jobs WHERE contact_id = ${c.id}`;
    expect(jobs).toHaveLength(0);
  });

  it("duplicates by message id are ignored, unknown senders are stored unmatched", async () => {
    const c = await seedContact();
    await handleInbound({ messageId: "<m3@x>", from: c.email, subject: "", text: "Hi", receivedAt: new Date() });
    const dupe = await handleInbound({ messageId: "<m3@x>", from: c.email, subject: "", text: "Hi", receivedAt: new Date() });
    expect(dupe.action).toBe("duplicate");
    const unknown = await handleInbound({ messageId: "<m4@x>", from: "stranger@nowhere.io", subject: "", text: "Hi", receivedAt: new Date() });
    expect(unknown.action).toBe("unmatched");
    expect(unknown.contact_id).toBeNull();
  });
});
