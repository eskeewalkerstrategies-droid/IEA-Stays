import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { db } from "../db.js";
import { recordEvent } from "../events.js";
import { findContactByEmail, setStage, splitName, syncContactToTwenty, type Contact } from "../contacts.js";
import { createJob, cancelOpenJobs } from "../jobs/agentJobs.js";
import { enqueue, Q } from "../jobs/queue.js";
import { log } from "../log.js";

/**
 * Booking page webhook (Cal.com and Cal.diy send the same shape). A booking moves the contact to Call booked
 * and schedules reminders 24 hours and 1 hour before. Cancellation or no-show creates a rebooking job.
 */
export interface BookingPayload {
  triggerEvent: string; // BOOKING_CREATED | BOOKING_RESCHEDULED | BOOKING_CANCELLED | BOOKING_NO_SHOW_UPDATED | MEETING_ENDED
  payload: {
    uid?: string;
    title?: string;
    startTime?: string;
    endTime?: string;
    attendees?: Array<{ email?: string; name?: string; noShow?: boolean }>;
    metadata?: { videoCallUrl?: string } & Record<string, unknown>;
    location?: string;
    cancellationReason?: string;
  };
}

export function verifyBookingSignature(raw: string, header: string | undefined): boolean {
  const secret = config().BOOKING_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

async function contactForAttendee(a: { email?: string; name?: string }): Promise<Contact | null> {
  if (!a.email) return null;
  const existing = await findContactByEmail(a.email);
  if (existing) return existing;
  const { first_name, last_name } = splitName(a.name ?? "");
  const [c] = await db()<Contact[]>`INSERT INTO contacts (first_name, last_name, email, stage, lead_source) VALUES (${first_name}, ${last_name}, ${a.email.toLowerCase()}, 'New lead', 'manual') RETURNING *`;
  await recordEvent({ type: "contact_created", contact_id: c.id, actor: "booking", payload: { source: "booking page" } });
  await syncContactToTwenty(c, { first_name, last_name, email: c.email, stage: "New lead", lead_source: "manual" });
  return c;
}

export async function handleBooking(evt: BookingPayload): Promise<{ handled: boolean; contact_id?: string }> {
  const p = evt.payload ?? {};
  const attendee = (p.attendees ?? []).find((a) => a.email && !a.email.endsWith("@eskeewalkerstrategies.com")) ?? p.attendees?.[0];
  if (!attendee) return { handled: false };
  const contact = await contactForAttendee(attendee);
  if (!contact) return { handled: false };
  const uid = p.uid ?? `${p.startTime}`;
  const joinUrl = p.metadata?.videoCallUrl ?? (p.location?.startsWith("http") ? p.location : null);

  switch (evt.triggerEvent) {
    case "BOOKING_CREATED":
    case "BOOKING_RESCHEDULED": {
      await recordEvent({ type: evt.triggerEvent === "BOOKING_CREATED" ? "call_booked" : "call_rescheduled", contact_id: contact.id, actor: "booking", payload: { uid, start: p.startTime, end: p.endTime, title: p.title } });
      await setStage(contact.id, "Call booked", "booking", "booking page");
      await cancelOpenJobs(contact.id, ["follow_up", "rebooking"], "booking", "call booked");
      await db()`UPDATE contacts SET next_follow_up_at = NULL WHERE id = ${contact.id}`;
      if (p.startTime) {
        const start = new Date(p.startTime);
        for (const hours of [24, 1]) {
          const at = new Date(start.getTime() - hours * 3_600_000);
          if (at.getTime() > Date.now()) {
            await enqueue(Q.callReminder, { contact_id: contact.id, start: p.startTime, hours_before: hours, join_url: joinUrl }, { singletonKey: `reminder:${uid}:${hours}`, startAfter: at });
          }
        }
        const end = p.endTime ? new Date(p.endTime) : new Date(start.getTime() + 30 * 60_000);
        await enqueue(Q.callOutcomePrompt, { contact_id: contact.id, uid }, { singletonKey: `outcome:${uid}`, startAfter: new Date(end.getTime() + 30 * 60_000) });
      }
      return { handled: true, contact_id: contact.id };
    }
    case "BOOKING_CANCELLED": {
      await recordEvent({ type: "call_cancelled", contact_id: contact.id, actor: "booking", payload: { uid, reason: p.cancellationReason ?? null } });
      if (contact.stage === "Call booked") await setStage(contact.id, "Qualified", "booking", "booking cancelled");
      await createJob({ type: "rebooking", contact_id: contact.id, payload: { reason: "booking cancelled", booking_url: config().BOOKING_URL }, actor: "booking" });
      return { handled: true, contact_id: contact.id };
    }
    case "BOOKING_NO_SHOW_UPDATED": {
      if (attendee.noShow === false) return { handled: true, contact_id: contact.id };
      await recordEvent({ type: "call_missed", contact_id: contact.id, actor: "booking", payload: { uid } });
      if (contact.stage === "Call booked") await setStage(contact.id, "Qualified", "booking", "no show");
      await createJob({ type: "rebooking", contact_id: contact.id, payload: { reason: "missed call", booking_url: config().BOOKING_URL }, actor: "booking" });
      return { handled: true, contact_id: contact.id };
    }
    default:
      await recordEvent({ type: "booking_event", contact_id: contact.id, actor: "booking", payload: { event: evt.triggerEvent, uid } });
      return { handled: true, contact_id: contact.id };
  }
}

export const booking = new Hono();

booking.post("/webhooks/booking", async (c) => {
  const raw = await c.req.text();
  if (!verifyBookingSignature(raw, c.req.header("x-cal-signature-256"))) return c.json({ ok: false, error: "bad signature" }, 401);
  let evt: BookingPayload;
  try {
    evt = JSON.parse(raw) as BookingPayload;
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  if (evt.triggerEvent === "PING") return c.json({ ok: true });
  try {
    const res = await handleBooking(evt);
    return c.json({ ok: true, ...res });
  } catch (err) {
    log.error({ err }, "booking webhook failed");
    return c.json({ ok: false }, 500);
  }
});
