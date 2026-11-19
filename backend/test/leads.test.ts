import { describe, it, expect } from "vitest";
import { useTestDb } from "./setup.js";
import { buildApp } from "../src/http/app.js";
import { db } from "../src/db.js";
import { memoryQueue } from "../src/jobs/queue.js";
import { sendInstantResponse, postNewLeadAlert } from "../src/jobs/instantResponse.js";
import { mailOutbox } from "../src/senders/email.js";
import { memoryOutbox } from "../src/slack/client.js";
import { captureLead } from "../src/leads.js";

useTestDb();
const app = buildApp();

describe("lead form", () => {
  it("creates the contact, consent row, intake job and queues the instant response", async () => {
    const res = await app.request("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
      body: JSON.stringify({ name: "Ravi Kumar", email: "Ravi@Example.com", company: "Kumar Foods", need: "Our positioning is muddy", email_consent: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; contact_id: string };
    expect(body.ok).toBe(true);

    const [contact] = await db()`SELECT * FROM contacts WHERE id = ${body.contact_id}`;
    expect(contact.email).toBe("ravi@example.com");
    expect(contact.first_name).toBe("Ravi");
    expect(contact.stage).toBe("New lead");
    expect(contact.email_consent).toBe(true);

    const consents = await db()`SELECT * FROM consents WHERE contact_id = ${body.contact_id}`;
    expect(consents).toHaveLength(1);
    expect(consents[0].wording).toMatch(/withdraw at any time/);
    expect(consents[0].ip).toBe("10.0.0.1");

    const jobs = await db()`SELECT * FROM jobs WHERE contact_id = ${body.contact_id}`;
    expect(jobs.map((j) => j.type)).toEqual(["intake"]);
    expect(memoryQueue.map((q) => q.name)).toContain("instant-response");

    const events = await db()`SELECT type FROM events WHERE contact_id = ${body.contact_id} ORDER BY id`;
    expect(events.map((e) => e.type)).toEqual(["lead_created", "job_created"]);
  });

  it("refuses without consent and swallows honeypot submissions", async () => {
    const noConsent = await app.request("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "A B", email: "a@b.co", email_consent: false }) });
    expect(noConsent.status).toBe(400);
    const bot = await app.request("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "A B", email: "bot@b.co", email_consent: true, website: "http://spam" }) });
    expect(bot.status).toBe(200);
    const [{ count }] = await db()`SELECT count(*)::int AS count FROM contacts`;
    expect(count).toBe(0);
  });

  it("rate limits one IP after five submissions", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.request("/api/leads", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ name: "A B", email: `p${i}@b.co`, email_consent: true }) });
      expect(r.status).toBe(200);
    }
    const r = await app.request("/api/leads", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ name: "A B", email: "p9@b.co", email_consent: true }) });
    expect(r.status).toBe(429);
  });

  it("sends the instant response once and posts the Slack alert", async () => {
    const lead = await captureLead({ name: "Meera Shah", email: "meera@example.com", need: "Growth has stalled", email_consent: true, consent_wording: "w", source: "website_form" });
    const first = await sendInstantResponse(lead.contact.id);
    expect(first.sent).toBe(true);
    expect(mailOutbox).toHaveLength(1);
    expect(mailOutbox[0].to).toBe("meera@example.com");
    expect(mailOutbox[0].text).toMatch(/Hi Meera/);
    expect(mailOutbox[0].text).toMatch(/Growth has stalled/);
    expect(mailOutbox[0].text).toMatch(/EskeeWalker Strategies/);
    const again = await sendInstantResponse(lead.contact.id);
    expect(again.sent).toBe(false);
    expect(mailOutbox).toHaveLength(1);
    const [msg] = await db()`SELECT * FROM messages WHERE contact_id = ${lead.contact.id}`;
    expect(msg.message_type).toBe("instant_response");
    expect(msg.direction).toBe("out");

    await postNewLeadAlert(lead.contact.id);
    expect(memoryOutbox.at(-1)?.text).toMatch(/New lead:\* Meera Shah/);
  });

  it("a returning dormant contact becomes a New lead again without a duplicate row", async () => {
    const lead = await captureLead({ name: "Old Client", email: "old@example.com", email_consent: true, consent_wording: "w", source: "website_form" });
    await db()`UPDATE contacts SET stage = 'Dormant' WHERE id = ${lead.contact.id}`;
    const again = await captureLead({ name: "Old Client", email: "OLD@example.com", email_consent: true, consent_wording: "w", source: "free_tool", tool_used: "positioning-check" });
    expect(again.created).toBe(false);
    expect(again.contact.id).toBe(lead.contact.id);
    expect(again.contact.stage).toBe("New lead");
    expect(again.contact.tool_used).toBe("positioning-check");
    const [{ count }] = await db()`SELECT count(*)::int AS count FROM contacts`;
    expect(count).toBe(1);
  });

  it("unsubscribe link flips consent and records it", async () => {
    const lead = await captureLead({ name: "U N", email: "un@example.com", email_consent: true, consent_wording: "w", source: "website_form" });
    const res = await app.request(`/unsubscribe?c=${lead.contact.id}`);
    expect(res.status).toBe(200);
    const [c] = await db()`SELECT * FROM contacts WHERE id = ${lead.contact.id}`;
    expect(c.email_consent).toBe(false);
    expect(c.unsubscribed_at).not.toBeNull();
    const consents = await db()`SELECT granted FROM consents WHERE contact_id = ${lead.contact.id} ORDER BY created_at`;
    expect(consents.map((x) => x.granted)).toEqual([true, false]);
  });
});
