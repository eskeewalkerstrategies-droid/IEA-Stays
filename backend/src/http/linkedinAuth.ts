import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { exchangeLinkedInCode, linkedInAuthUrl } from "../senders/linkedin.js";
import { recordEvent } from "../events.js";

/** One-time LinkedIn connect flow. Protected by the MCP token so only the team can start it. */
export const linkedinAuth = new Hono();
const states = new Set<string>();

linkedinAuth.get("/auth/linkedin", (c) => {
  const token = c.req.query("token") ?? "";
  if (!config().mcpTokens.has(token)) return c.text("Add ?token=<your OPS_MCP token>", 401);
  if (!config().LINKEDIN_CLIENT_ID) return c.text("LINKEDIN_CLIENT_ID is not set", 500);
  const state = randomBytes(12).toString("hex");
  states.add(state);
  return c.redirect(linkedInAuthUrl(state));
});

linkedinAuth.get("/auth/linkedin/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  if (!code || !states.has(state)) return c.text("Invalid state", 400);
  states.delete(state);
  const t = await exchangeLinkedInCode(code);
  await recordEvent({ type: "linkedin_connected", payload: { expires_at: t.expires_at } });
  return c.html(`<!doctype html><meta charset="utf-8"><body style="font-family:Arial;padding:40px"><h1>LinkedIn connected.</h1><p>Token valid until ${t.expires_at}. The morning health check will warn 7 days before it expires.</p></body>`);
});
