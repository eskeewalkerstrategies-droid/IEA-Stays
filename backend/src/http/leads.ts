import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.js";
import { captureLead, unsubscribeContact } from "../leads.js";
import { LEAD_SOURCES } from "../twenty/fields.js";
import { log } from "../log.js";
import { getContact } from "../contacts.js";

/** Lead form endpoint. Spam protection: honeypot field, per-IP rate limit, optional Cloudflare Turnstile. */
export const LEAD_CONSENT_WORDING =
  "I agree that EskeeWalker Strategies may store these details and email me about my enquiry, with occasional notes on strategy and growth. I can withdraw at any time by replying or using the unsubscribe link.";

const LeadBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  company: z.string().trim().max(160).optional().nullable(),
  need: z.string().trim().max(3000).optional().nullable(),
  email_consent: z.boolean(),
  consent_wording: z.string().max(1000).optional(),
  source: z.enum(LEAD_SOURCES).default("website_form"),
  tool_used: z.string().max(80).optional().nullable(),
  website: z.string().optional(), // honeypot: must be empty
  turnstile_token: z.string().optional(),
  started_at: z.number().optional(), // ms epoch when the form was rendered
});

const hits = new Map<string, number[]>();
export function rateLimited(ip: string, limit = 5, windowMs = 3_600_000): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) return true;
  arr.push(now);
  hits.set(ip, arr);
  return false;
}
export function resetRateLimits(): void {
  hits.clear();
}

async function turnstileOk(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = config().TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
  });
  const data = (await res.json()) as { success?: boolean };
  return Boolean(data.success);
}

export const leads = new Hono();

leads.post("/api/leads", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = c.req.header("user-agent") ?? null;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  const parsed = LeadBody.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: "invalid fields", issues: parsed.error.issues.map((i) => i.path.join(".")) }, 400);
  const d = parsed.data;

  // Spam checks. A bot that fills the hidden field or posts within 3 seconds gets a quiet 200 and nothing stored.
  if (d.website) return c.json({ ok: true });
  if (d.started_at && Date.now() - d.started_at < 3000) return c.json({ ok: true });
  if (rateLimited(ip)) return c.json({ ok: false, error: "too many submissions, try again later" }, 429);
  if (!(await turnstileOk(d.turnstile_token, ip))) return c.json({ ok: false, error: "spam check failed" }, 400);
  if (!d.email_consent) return c.json({ ok: false, error: "consent is needed so we can reply by email" }, 400);

  try {
    const result = await captureLead({
      name: d.name,
      email: d.email,
      phone: d.phone ?? null,
      company: d.company ?? null,
      need: d.need ?? null,
      email_consent: d.email_consent,
      consent_wording: d.consent_wording ?? LEAD_CONSENT_WORDING,
      source: d.source,
      tool_used: d.tool_used ?? null,
      ip,
      user_agent: ua,
    });
    return c.json({ ok: true, contact_id: result.contact.id, booking_url: config().BOOKING_URL });
  } catch (err) {
    log.error({ err }, "lead capture failed");
    return c.json({ ok: false, error: "could not save your message, please email us directly" }, 500);
  }
});

leads.get("/unsubscribe", async (c) => {
  const id = c.req.query("c");
  if (!id) return c.text("Missing contact", 400);
  const contact = await getContact(id).catch(() => null);
  if (!contact) return c.text("Already removed.", 200);
  await unsubscribeContact(id, "unsubscribe_link");
  return c.html(`<!doctype html><meta charset="utf-8"><title>Unsubscribed</title><body style="font-family:Arial;padding:40px"><h1>Done.</h1><p>You will not get further emails from EskeeWalker Strategies. If this was a mistake, reply to any earlier message.</p></body>`);
});

leads.post("/unsubscribe", async (c) => {
  const id = c.req.query("c");
  if (id) await unsubscribeContact(id, "unsubscribe_one_click");
  return c.text("ok");
});
