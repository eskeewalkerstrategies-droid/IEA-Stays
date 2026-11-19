import { Hono } from "hono";
import { handleListmonkWebhook } from "../listmonk/sync.js";

export const listmonkWebhook = new Hono();

listmonkWebhook.post("/webhooks/listmonk", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const res = await handleListmonkWebhook(body);
  return c.json({ ok: true, ...res });
});
