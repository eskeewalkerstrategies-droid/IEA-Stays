import { db } from "../db.js";
import { recordEvent } from "../events.js";
import * as twenty from "../twenty/client.js";
import { INVOICE_FIELDS } from "../twenty/fields.js";
import { getContact } from "../contacts.js";
import { nextDocumentNumber } from "./numbering.js";

export interface Invoice {
  id: string;
  twenty_id: string | null;
  number: string | null;
  contact_id: string | null;
  amount: string;
  gst: string;
  issue_date: string | null;
  due_date: string | null;
  status: "Draft" | "Sent" | "Paid" | "Overdue";
  paid_at: string | null;
  pdf_link: string | null;
  reminders_sent: string[];
  created_at: Date;
  updated_at: Date;
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const [row] = await db()<Invoice[]>`SELECT * FROM invoices WHERE id = ${id}`;
  return row ?? null;
}

export async function listInvoices(status?: string): Promise<Invoice[]> {
  return db()<Invoice[]>`SELECT * FROM invoices WHERE (${status ?? null}::text IS NULL OR status = ${status ?? null}) ORDER BY due_date NULLS LAST, created_at DESC`;
}

export interface CreateInvoiceInput {
  contact_id: string;
  amount: number;
  gst?: number;
  issue_date: string;
  due_date: string;
  pdf_link?: string | null;
  status?: "Draft" | "Sent";
  actor: string;
}

/** Creates an invoice in ops with the next number, and mirrors it to Twenty when configured. */
export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  const contact = await getContact(input.contact_id);
  if (!contact) throw new Error("Contact not found");
  const number = await nextDocumentNumber("INV", input.issue_date);
  const [inv] = await db()<Invoice[]>`
    INSERT INTO invoices (number, contact_id, amount, gst, issue_date, due_date, status, pdf_link)
    VALUES (${number}, ${input.contact_id}, ${input.amount}, ${input.gst ?? 0}, ${input.issue_date}, ${input.due_date}, ${input.status ?? "Draft"}, ${input.pdf_link ?? null})
    RETURNING *`;
  await recordEvent({ type: "invoice_created", contact_id: contact.id, invoice_id: inv.id, actor: input.actor, payload: { number, amount: input.amount, gst: input.gst ?? 0, due_date: input.due_date } });
  await twenty.tryTwenty("createInvoice", async () => {
    const res = await twenty.createInvoice({
      [INVOICE_FIELDS.number]: number,
      [INVOICE_FIELDS.person]: contact.twenty_id,
      [INVOICE_FIELDS.company]: contact.company_twenty_id,
      [INVOICE_FIELDS.amount]: { amountMicros: Math.round(input.amount * 1_000_000), currencyCode: "INR" },
      [INVOICE_FIELDS.gst]: { amountMicros: Math.round((input.gst ?? 0) * 1_000_000), currencyCode: "INR" },
      [INVOICE_FIELDS.issueDate]: input.issue_date,
      [INVOICE_FIELDS.dueDate]: input.due_date,
      [INVOICE_FIELDS.status]: input.status ?? "Draft",
      [INVOICE_FIELDS.pdfLink]: input.pdf_link ? { primaryLinkUrl: input.pdf_link } : null,
    });
    await db()`UPDATE invoices SET twenty_id = ${res.id} WHERE id = ${inv.id}`;
  });
  return (await getInvoice(inv.id))!;
}

export async function updateInvoice(id: string, patch: Partial<Pick<Invoice, "status" | "paid_at" | "pdf_link" | "due_date" | "twenty_id">>, actor: string): Promise<Invoice> {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const [inv] = await db()<Invoice[]>`UPDATE invoices SET ${db()(clean as never)}, updated_at = now() WHERE id = ${id} RETURNING *`;
  await recordEvent({ type: "invoice_updated", contact_id: inv.contact_id, invoice_id: inv.id, actor, payload: clean });
  if (inv.twenty_id && (patch.status || patch.paid_at || patch.pdf_link)) {
    await twenty.tryTwenty("updateInvoice", () =>
      twenty.updateInvoice(inv.twenty_id!, {
        ...(patch.status ? { [INVOICE_FIELDS.status]: patch.status } : {}),
        ...(patch.paid_at ? { [INVOICE_FIELDS.paidDate]: patch.paid_at } : {}),
        ...(patch.pdf_link ? { [INVOICE_FIELDS.pdfLink]: { primaryLinkUrl: patch.pdf_link } } : {}),
      }),
    );
  }
  return inv;
}

export async function markReminderSent(id: string, reminder: string): Promise<void> {
  await db()`UPDATE invoices SET reminders_sent = reminders_sent || ${db().json([reminder])}, updated_at = now() WHERE id = ${id}`;
}
