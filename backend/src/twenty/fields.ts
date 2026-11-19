/**
 * Names of the custom fields in Twenty and the stage values. If a field is renamed in Twenty,
 * change it here and in docs/twenty.md in the same commit.
 */
export const STAGES = [
  "New lead",
  "Qualified",
  "Call booked",
  "Proposal sent",
  "Active client",
  "Invoice sent",
  "Overdue",
  "Completed",
  "Dormant",
  "Lost",
  "Prospect",
] as const;
export type Stage = (typeof STAGES)[number];

export const LEAD_SOURCES = ["website_form", "free_tool", "referral", "linkedin", "newsletter", "outbound", "manual"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const INVOICE_STATUSES = ["Draft", "Sent", "Paid", "Overdue"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Twenty API names for the custom fields on Person. */
export const PERSON_FIELDS = {
  stage: "stage",
  leadSource: "leadSource",
  leadScore: "leadScore",
  emailConsent: "emailConsent",
  consentDate: "consentDate",
  nextFollowUpAt: "nextFollowUpAt",
  lastContactAt: "lastContactAt",
  owner: "owner",
  toolUsed: "toolUsed",
} as const;

/** Twenty API names on the Invoice custom object. */
export const INVOICE_FIELDS = {
  number: "number",
  person: "personId",
  company: "companyId",
  amount: "amount",
  gst: "gst",
  issueDate: "issueDate",
  dueDate: "dueDate",
  status: "status",
  paidDate: "paidDate",
  pdfLink: "pdfLink",
} as const;

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}
