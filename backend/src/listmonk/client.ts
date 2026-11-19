import { config } from "../config.js";
import { log } from "../log.js";

/** listmonk 6.x REST client: subscribers, lists, campaigns. Basic auth with an API user. */
export function listmonkEnabled(): boolean {
  const c = config();
  return Boolean(c.LISTMONK_URL && c.LISTMONK_USER && c.LISTMONK_PASS);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const c = config();
  const auth = Buffer.from(`${c.LISTMONK_USER}:${c.LISTMONK_PASS}`).toString("base64");
  const res = await fetch(`${c.LISTMONK_URL!.replace(/\/$/, "")}/api${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`listmonk ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export interface Subscriber {
  id: number;
  email: string;
  name: string;
  status: "enabled" | "blocklisted";
  lists: Array<{ id: number; subscription_status: string }>;
}

export async function findSubscriber(email: string): Promise<Subscriber | null> {
  const q = encodeURIComponent(`subscribers.email = '${email.replace(/'/g, "''")}'`);
  const res = await call<{ data: { results: Subscriber[] } }>("GET", `/subscribers?query=${q}&per_page=1`);
  return res.data.results[0] ?? null;
}

export async function upsertSubscriber(email: string, name: string, listIds: number[], attribs: Record<string, unknown>): Promise<Subscriber> {
  const existing = await findSubscriber(email);
  if (existing) {
    const res = await call<{ data: Subscriber }>("PUT", `/subscribers/${existing.id}`, {
      email,
      name,
      status: existing.status,
      lists: Array.from(new Set([...existing.lists.map((l) => l.id), ...listIds])),
      attribs,
      preconfirm_subscriptions: true,
    });
    return res.data;
  }
  const res = await call<{ data: Subscriber }>("POST", "/subscribers", { email, name, status: "enabled", lists: listIds, attribs, preconfirm_subscriptions: true });
  return res.data;
}

export async function unsubscribeInListmonk(email: string): Promise<void> {
  if (!listmonkEnabled()) return;
  const s = await findSubscriber(email);
  if (!s) return;
  await call("PUT", "/subscribers/blocklist", { ids: [s.id] });
}

export async function removeFromLists(email: string, listIds: number[]): Promise<void> {
  const s = await findSubscriber(email);
  if (!s) return;
  await call("PUT", "/subscribers/lists", { ids: [s.id], action: "unsubscribe", target_list_ids: listIds });
}

export interface Campaign {
  id: number;
  name: string;
  subject: string;
  status: string;
  views: number;
  clicks: number;
  sent: number;
  to_send: number;
  bounces?: number;
}

export async function createCampaignDraft(input: { name: string; subject: string; body: string; listIds: number[]; contentType?: "richtext" | "html" | "markdown" | "plain" }): Promise<Campaign> {
  const res = await call<{ data: Campaign }>("POST", "/campaigns", {
    name: input.name,
    subject: input.subject,
    lists: input.listIds,
    type: "regular",
    content_type: input.contentType ?? "markdown",
    body: input.body,
    from_email: config().MAIL_FROM,
  });
  return res.data;
}

export async function getCampaign(id: number): Promise<Campaign> {
  const res = await call<{ data: Campaign }>("GET", `/campaigns/${id}`);
  return res.data;
}

export async function listCampaigns(limit = 10): Promise<Campaign[]> {
  const res = await call<{ data: { results: Campaign[] } }>("GET", `/campaigns?per_page=${limit}&order_by=created_at&order=desc`);
  return res.data.results;
}

export function warnIfDisabled(label: string): boolean {
  if (!listmonkEnabled()) {
    log.info({ label }, "listmonk not configured, skipping");
    return false;
  }
  return true;
}
