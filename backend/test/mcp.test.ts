import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { useTestDb, seedContact } from "./setup.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { buildApp } from "../src/http/app.js";
import { db } from "../src/db.js";
import { createJob } from "../src/jobs/agentJobs.js";
import { memoryOutbox } from "../src/slack/client.js";

useTestDb();

async function connect(actor = "agent-followup") {
  const server = buildMcpServer(actor);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}

function parse<T = unknown>(res: { content?: unknown }): T {
  const c = (res.content as Array<{ type: string; text: string }>)[0];
  return JSON.parse(c.text) as T;
}

describe("Ops MCP server", () => {
  it("lists the tools Claude may use", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["find_contact", "contact_history", "due_followups", "take_next_job", "complete_job", "save_draft", "request_send", "change_stage", "add_note", "set_next_followup", "create_invoice", "create_content_item"]) {
      expect(names).toContain(n);
    }
    expect(names).not.toContain("send_email");
  });

  it("walks the follow-up loop: take job, read history, draft, request send, complete", async () => {
    const c = await seedContact({ first_name: "Rohan", last_name: "Iyer", next_follow_up_at: "2026-11-19" });
    await createJob({ type: "follow_up", contact_id: c.id, payload: { due_date: "2026-11-19" } });
    const client = await connect();

    const found = parse<Array<{ id: string; name: string }>>(await client.callTool({ name: "find_contact", arguments: { query: "rohan" } }));
    expect(found[0].id).toBe(c.id);

    const taken = parse<{ job: { id: string; type: string }; history: { contact: { id: string }; rules: { can_email: { ok: boolean } } } }>(await client.callTool({ name: "take_next_job", arguments: { type: "follow_up" } }));
    expect(taken.job.type).toBe("follow_up");
    expect(taken.history.contact.id).toBe(c.id);
    expect(taken.history.rules.can_email.ok).toBe(true);
    const [job] = await db()`SELECT status, taken_by FROM jobs WHERE id = ${taken.job.id}`;
    expect(job).toEqual({ status: "taken", taken_by: "agent-followup" });

    const nothing = parse<{ job: null }>(await client.callTool({ name: "take_next_job", arguments: { type: "follow_up" } }));
    expect(nothing.job).toBeNull();

    const draft = parse<{ draft_id: string }>(await client.callTool({ name: "save_draft", arguments: { contact_id: c.id, job_id: taken.job.id, channel: "email", message_type: "follow_up", subject: "One idea for Iyer & Co", body: "Hi Rohan,\n\nOne idea." } }));
    const sent = parse<{ outcome: string }>(await client.callTool({ name: "request_send", arguments: { draft_id: draft.draft_id } }));
    expect(sent.outcome).toBe("pending_approval");
    expect(memoryOutbox).toHaveLength(1);

    await client.callTool({ name: "set_next_followup", arguments: { contact_id: c.id, working_days_from_today: 5, reason: "second touch" } });
    const done = parse<{ status: string }>(await client.callTool({ name: "complete_job", arguments: { job_id: taken.job.id, decision: "wrote", reason: "drafted a follow-up", draft_ids: [draft.draft_id] } }));
    expect(done.status).toBe("done");

    const events = await db()`SELECT type, actor FROM events WHERE contact_id = ${c.id} ORDER BY id`;
    expect(events.map((e) => e.type)).toEqual(["job_created", "job_taken", "draft_saved", "draft_pending_approval", "next_follow_up_set", "job_done"]);
    expect(new Set(events.slice(1).map((e) => e.actor))).toEqual(new Set(["agent-followup"]));
  });

  it("request_send is refused without consent, whatever the prompt says", async () => {
    const c = await seedContact({ email_consent: false });
    const client = await connect("jitaksh");
    const draft = parse<{ draft_id: string }>(await client.callTool({ name: "save_draft", arguments: { contact_id: c.id, channel: "email", message_type: "follow_up", subject: "x", body: "y" } }));
    const r = parse<{ outcome: string; reason: string }>(await client.callTool({ name: "request_send", arguments: { draft_id: draft.draft_id } }));
    expect(r).toMatchObject({ outcome: "refused", reason: "no email consent" });
  });

  it("change_stage validates the stage and records the actor", async () => {
    const c = await seedContact();
    const client = await connect("jitaksh");
    const r = parse<{ stage: string }>(await client.callTool({ name: "change_stage", arguments: { contact_id: c.id, stage: "Proposal sent", reason: "sent EWS/QT/26-27/004" } }));
    expect(r.stage).toBe("Proposal sent");
    const bad = await client.callTool({ name: "change_stage", arguments: { contact_id: c.id, stage: "Won", reason: "x" } });
    expect(bad.isError).toBe(true);
    const [ev] = await db()`SELECT actor, payload FROM events WHERE type = 'stage_changed'`;
    expect(ev.actor).toBe("jitaksh");
    expect(ev.payload.to).toBe("Proposal sent");
  });

  it("creates an invoice with the next number and stores the PDF", async () => {
    const c = await seedContact({ stage: "Active client" });
    const client = await connect("agent-invoice");
    const peek = parse<{ next: string }>(await client.callTool({ name: "next_invoice_number", arguments: {} }));
    expect(peek.next).toMatch(/^EWS\/INV\/\d{2}-\d{2}\/001$/);
    const inv = parse<{ number: string; pdf_link: string; status: string }>(await client.callTool({ name: "create_invoice", arguments: { contact_id: c.id, amount: 45000, gst: 8100, due_date: "2026-12-05", pdf_base64: Buffer.from("%PDF-1.4 test").toString("base64"), mark_sent: true } }));
    expect(inv.number).toBe(peek.next);
    expect(inv.status).toBe("Sent");
    expect(inv.pdf_link).toMatch(/^http:\/\/test\.local\/files\/invoices\/.+\.pdf$/);
    const [contact] = await db()`SELECT stage FROM contacts WHERE id = ${c.id}`;
    expect(contact.stage).toBe("Invoice sent");
    const next = parse<{ next: string }>(await client.callTool({ name: "next_invoice_number", arguments: {} }));
    expect(next.next).toMatch(/\/002$/);
  });

  it("content items and assets", async () => {
    const client = await connect("agent-research");
    const item = parse<{ id: string; slug: string; status: string }>(await client.callTool({ name: "create_content_item", arguments: { title: "Why Indian D2C brands plateau at 1 crore a month", pillar: "growth", brief: { question: "why do D2C brands plateau" } } }));
    expect(item.slug).toBe("why-indian-d2c-brands-plateau-at-1-crore-a-month");
    expect(item.status).toBe("brief");
    await client.callTool({ name: "save_content_asset", arguments: { content_item_id: item.id, kind: "linkedin_post", body: "Post 1" } });
    const list = parse<Array<{ id: string; assets: Array<{ kind: string }> }>>(await client.callTool({ name: "list_content_items", arguments: { status: "brief" } }));
    expect(list[0].assets.map((a) => a.kind)).toEqual(["linkedin_post"]);
  });

  it("HTTP endpoint needs a bearer token and answers initialize", async () => {
    const app = buildApp();
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
    const noAuth = await app.request("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(init) });
    expect(noAuth.status).toBe(401);
    const ok = await app.request("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer t0ken" }, body: JSON.stringify(init) });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe("eskeewalker-ops");
  });
});
