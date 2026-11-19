import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { useTestDb, seedContact } from "./setup.js";
import { buildApp } from "../src/http/app.js";
import { handleBooking } from "../src/http/booking.js";
import { db } from "../src/db.js";
import { memoryQueue } from "../src/jobs/queue.js";
import { resetConfig } from "../src/config.js";
import { recordCallMissed } from "../src/jobs/reminders.js";

useTestDb();
const app = buildApp();

describe("booking webhook", () => {
  it("a booking moves the contact to Call booked and schedules both reminders", async () => {
    const c = await seedContact({ stage: "Qualified", next_follow_up_at: "2026-11-21" });
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const r = await handleBooking({ triggerEvent: "BOOKING_CREATED", payload: { uid: "abc", startTime: start, endTime: new Date(Date.now() + 3 * 86_400_000 + 1_800_000).toISOString(), attendees: [{ email: c.email, name: "Asha Mehta" }], metadata: { videoCallUrl: "https://meet.example/x" } } });
    expect(r.handled).toBe(true);
    const [contact] = await db()`SELECT stage, next_follow_up_at FROM contacts WHERE id = ${c.id}`;
    expect(contact.stage).toBe("Call booked");
    expect(contact.next_follow_up_at).toBeNull();
    const reminders = memoryQueue.filter((q) => q.name === "call-reminder").map((q) => (q.data as { hours_before: number }).hours_before);
    expect(reminders.sort()).toEqual([1, 24]);
    expect(memoryQueue.some((q) => q.name === "call-outcome-prompt")).toBe(true);
  });

  it("an unknown attendee becomes a contact", async () => {
    await handleBooking({ triggerEvent: "BOOKING_CREATED", payload: { uid: "n1", startTime: new Date(Date.now() + 86_400_000).toISOString(), attendees: [{ email: "new@client.io", name: "New Person" }] } });
    const [c] = await db()`SELECT first_name, stage FROM contacts WHERE email = 'new@client.io'`;
    expect(c).toEqual({ first_name: "New", stage: "Call booked" });
  });

  it("cancel and no-show create a rebooking job and drop the stage", async () => {
    const c = await seedContact({ stage: "Call booked" });
    await handleBooking({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "x", attendees: [{ email: c.email }] } });
    const [contact] = await db()`SELECT stage FROM contacts WHERE id = ${c.id}`;
    expect(contact.stage).toBe("Qualified");
    const jobs = await db()`SELECT type FROM jobs WHERE contact_id = ${c.id}`;
    expect(jobs).toEqual([{ type: "rebooking" }]);
    await recordCallMissed(c.id, "slack:jitaksh"); // second rebooking job is deduplicated
    const again = await db()`SELECT type FROM jobs WHERE contact_id = ${c.id} AND status = 'queued'`;
    expect(again).toHaveLength(1);
  });

  it("verifies the signature when a secret is set", async () => {
    process.env.BOOKING_WEBHOOK_SECRET = "s3cret";
    resetConfig();
    try {
      const body = JSON.stringify({ triggerEvent: "PING", payload: {} });
      const bad = await app.request("/webhooks/booking", { method: "POST", body, headers: { "x-cal-signature-256": "nope" } });
      expect(bad.status).toBe(401);
      const sig = createHmac("sha256", "s3cret").update(body).digest("hex");
      const good = await app.request("/webhooks/booking", { method: "POST", body, headers: { "x-cal-signature-256": sig } });
      expect(good.status).toBe(200);
    } finally {
      delete process.env.BOOKING_WEBHOOK_SECRET;
      resetConfig();
    }
  });
});
