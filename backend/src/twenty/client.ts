import { config } from "../config.js";
import { log } from "../log.js";
import { PERSON_FIELDS } from "./fields.js";

/**
 * Thin client for Twenty's REST API. Only the calls the backend needs.
 * Field shapes follow Twenty's REST conventions (name.firstName, emails.primaryEmail). Confirm against the
 * pinned version's API playground (Settings, API & Webhooks) when installing. Every call is best effort:
 * the ops mirror is the source agents read, and a failed write here is recorded as an event.
 */
export function twentyEnabled(): boolean {
  const c = config();
  return Boolean(c.TWENTY_API_URL && c.TWENTY_API_KEY);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const c = config();
  const res = await fetch(`${c.TWENTY_API_URL!.replace(/\/$/, "")}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.TWENTY_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twenty ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export interface TwentyPersonInput {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  companyId?: string | null;
  stage?: string;
  leadSource?: string | null;
  leadScore?: number | null;
  emailConsent?: boolean;
  consentDate?: string | null;
  nextFollowUpAt?: string | null;
  lastContactAt?: string | null;
  toolUsed?: string | null;
}

function toPersonBody(p: TwentyPersonInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (p.firstName !== undefined || p.lastName !== undefined) body.name = { firstName: p.firstName ?? "", lastName: p.lastName ?? "" };
  if (p.email !== undefined) body.emails = { primaryEmail: p.email ?? "" };
  if (p.phone !== undefined) body.phones = { primaryPhoneNumber: p.phone ?? "" };
  if (p.companyId !== undefined) body.companyId = p.companyId;
  if (p.stage !== undefined) body[PERSON_FIELDS.stage] = p.stage;
  if (p.leadSource !== undefined) body[PERSON_FIELDS.leadSource] = p.leadSource;
  if (p.leadScore !== undefined) body[PERSON_FIELDS.leadScore] = p.leadScore;
  if (p.emailConsent !== undefined) body[PERSON_FIELDS.emailConsent] = p.emailConsent;
  if (p.consentDate !== undefined) body[PERSON_FIELDS.consentDate] = p.consentDate;
  if (p.nextFollowUpAt !== undefined) body[PERSON_FIELDS.nextFollowUpAt] = p.nextFollowUpAt;
  if (p.lastContactAt !== undefined) body[PERSON_FIELDS.lastContactAt] = p.lastContactAt;
  if (p.toolUsed !== undefined) body[PERSON_FIELDS.toolUsed] = p.toolUsed;
  return body;
}

export async function findPersonByEmail(email: string): Promise<{ id: string } | null> {
  const filter = encodeURIComponent(`emails.primaryEmail[eq]:"${email}"`);
  const res = await call<{ data?: { people?: Array<{ id: string }> } }>("GET", `/people?filter=${filter}&limit=1`);
  return res.data?.people?.[0] ?? null;
}

export async function createPerson(p: TwentyPersonInput): Promise<{ id: string }> {
  const res = await call<{ data?: { createPerson?: { id: string } } }>("POST", "/people", toPersonBody(p));
  const id = res.data?.createPerson?.id;
  if (!id) throw new Error("Twenty createPerson returned no id");
  return { id };
}

export async function updatePerson(id: string, p: TwentyPersonInput): Promise<void> {
  await call("PATCH", `/people/${id}`, toPersonBody(p));
}

export async function createCompany(name: string, domain?: string | null): Promise<{ id: string }> {
  const body: Record<string, unknown> = { name };
  if (domain) body.domainName = { primaryLinkUrl: domain };
  const res = await call<{ data?: { createCompany?: { id: string } } }>("POST", "/companies", body);
  const id = res.data?.createCompany?.id;
  if (!id) throw new Error("Twenty createCompany returned no id");
  return { id };
}

export async function createInvoice(body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await call<{ data?: { createInvoice?: { id: string } } }>("POST", "/invoices", body);
  const id = res.data?.createInvoice?.id;
  if (!id) throw new Error("Twenty createInvoice returned no id");
  return { id };
}

export async function updateInvoice(id: string, body: Record<string, unknown>): Promise<void> {
  await call("PATCH", `/invoices/${id}`, body);
}

/** Runs a Twenty write if Twenty is configured; logs and returns false on failure instead of throwing. */
export async function tryTwenty(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  if (!twentyEnabled()) return false;
  try {
    await fn();
    return true;
  } catch (err) {
    log.warn({ err, label }, "twenty write failed");
    return false;
  }
}
