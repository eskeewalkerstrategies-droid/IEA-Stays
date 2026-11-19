import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.js";
import { db, getSetting } from "../db.js";
import { captureLead } from "../leads.js";
import { LEAD_CONSENT_WORDING, rateLimited } from "./leads.js";
import { runTool, TOOLS } from "../tools/registry.js";
import { recordEvent } from "../events.js";
import { log } from "../log.js";

/**
 * Free tools on the website: the visitor answers questions, leaves an email with consent, and gets the result on
 * screen and by email. This is the one place the paid Claude API is required, so it has a spending cap per visitor
 * and per day (settings: tool_visitor_daily_runs, tool_daily_cap_usd).
 */
const Body = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  company: z.string().trim().max(160).optional().nullable(),
  email_consent: z.boolean(),
  answers: z.record(z.string(), z.string().max(2000)),
  website: z.string().optional(),
});

export const tools = new Hono();

tools.get("/api/tools", (c) => c.json({ tools: Object.values(TOOLS).map((t) => ({ slug: t.slug, name: t.name, description: t.description, questions: t.questions })) }));

tools.post("/api/tools/:slug", async (c) => {
  const tool = TOOLS[c.req.param("slug")];
  if (!tool) return c.json({ ok: false, error: "unknown tool" }, 404);
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: "invalid fields" }, 400);
  const d = parsed.data;
  if (d.website) return c.json({ ok: true, result: "" });
  if (!d.email_consent) return c.json({ ok: false, error: "consent is needed so we can email the result" }, 400);
  if (rateLimited(`tool:${ip}`, 10)) return c.json({ ok: false, error: "too many requests" }, 429);

  const email = d.email.toLowerCase();
  const visitorCap = await getSetting<number>("tool_visitor_daily_runs", 3);
  const dailyCapUsd = await getSetting<number>("tool_daily_cap_usd", 2);
  const [[v], [spend]] = await Promise.all([
    db()`SELECT count(*)::int AS n FROM tool_runs WHERE email = ${email} AND created_at > now() - interval '24 hours'`,
    db()`SELECT coalesce(sum(cost_usd),0)::float AS usd FROM tool_runs WHERE created_at > now() - interval '24 hours'`,
  ]);
  if (v.n >= visitorCap) return c.json({ ok: false, error: "you have used today's runs, we have emailed your earlier results" }, 429);
  if (Number(spend.usd) >= dailyCapUsd) {
    await recordEvent({ type: "tool_cap_reached", payload: { tool: tool.slug, usd: spend.usd } });
    return c.json({ ok: false, error: "the tool is resting for today, we will email you the result" }, 503);
  }

  const lead = await captureLead({
    name: d.name,
    email,
    company: d.company ?? null,
    need: `Used the ${tool.name} tool. Answers: ${JSON.stringify(d.answers).slice(0, 1500)}`,
    email_consent: true,
    consent_wording: LEAD_CONSENT_WORDING,
    source: "free_tool",
    tool_used: tool.slug,
    ip,
    user_agent: c.req.header("user-agent") ?? null,
  });

  try {
    const out = await runTool(tool, d.answers, { model: config().CLAUDE_TOOL_MODEL });
    await db()`INSERT INTO tool_runs (tool, contact_id, email, ip, input, output, tokens_in, tokens_out, cost_usd)
      VALUES (${tool.slug}, ${lead.contact.id}, ${email}, ${ip}, ${db().json(d.answers)}, ${out.text}, ${out.tokens_in}, ${out.tokens_out}, ${out.cost_usd})`;
    await recordEvent({ type: "tool_used", contact_id: lead.contact.id, payload: { tool: tool.slug, cost_usd: out.cost_usd } });
    const { createDraft } = await import("../drafts.js");
    const { sendDraft } = await import("../senders/index.js");
    const draft = await createDraft({ contact_id: lead.contact.id, channel: "email", message_type: "tool_result", to_address: email, subject: `Your ${tool.name} result`, body: `Hi ${lead.contact.first_name || "there"},\n\nHere is your ${tool.name} result, as promised.\n\n${out.text}\n\nIf you want to talk it through: ${config().BOOKING_URL}`, author: "system" });
    await db()`UPDATE drafts SET status = 'approved' WHERE id = ${draft.id}`;
    await sendDraft(draft.id, { ignoreWindow: true }).catch((err) => log.warn({ err }, "tool result email failed"));
    return c.json({ ok: true, result: out.text });
  } catch (err) {
    log.error({ err }, "tool run failed");
    return c.json({ ok: false, error: "the tool hit a snag, we will email you the result" }, 500);
  }
});
