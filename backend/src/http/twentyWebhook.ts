import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { applyInvoiceWebhook, applyPersonWebhook, parseWebhook, type TwentyWebhook } from "../twenty/mirror.js";
import { log } from "../log.js";

/**
 * Twenty signs webhooks with HMAC-SHA256 over "<timestamp>:<body>" in X-Twenty-Webhook-Signature with the
 * timestamp in X-Twenty-Webhook-Timestamp. If the pinned version signs differently, adjust verify() only.
 */
export function verifyTwentySignature(raw: string, signature: string | undefined, timestamp: string | undefined): boolean {
  const secret = config().TWENTY_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature || !timestamp) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}:${raw}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export const twentyWebhook = new Hono();

twentyWebhook.post("/webhooks/twenty", async (c) => {
  const raw = await c.req.text();
  if (!verifyTwentySignature(raw, c.req.header("x-twenty-webhook-signature"), c.req.header("x-twenty-webhook-timestamp"))) {
    return c.json({ ok: false, error: "bad signature" }, 401);
  }
  let body: TwentyWebhook;
  try {
    body = JSON.parse(raw) as TwentyWebhook;
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  const parsed = parseWebhook(body);
  if (!parsed) return c.json({ ok: true, ignored: true });
  try {
    if (parsed.object === "person") await applyPersonWebhook(parsed.action, parsed.record);
    else if (parsed.object === "invoice") await applyInvoiceWebhook(parsed.action, parsed.record);
    else return c.json({ ok: true, ignored: parsed.object });
    return c.json({ ok: true });
  } catch (err) {
    log.error({ err, event: body.eventName }, "twenty webhook failed");
    return c.json({ ok: false }, 500);
  }
});
