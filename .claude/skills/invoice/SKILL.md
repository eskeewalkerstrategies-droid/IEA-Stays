---
name: invoice
description: Create a GST-ready invoice PDF with the EskeeWalker brand template when a project is marked complete, save it to the invoice record, draft the cover email, and draft payment reminders at 3 days before due, on the due date, and 7 and 14 days after. Use for invoice_create and invoice_reminder jobs.
---

# Invoice

Two jobs. `invoice_create`: the project was marked complete, make the invoice and the cover email. `invoice_reminder`: a reminder is due, write it. Payments are marked paid by hand in Twenty; when that happens the backend cancels the remaining reminders. You never send.

## Before you start

Read `docs/business.md` sections 1, 3 (pricing rules, GST, numbering) and 4 (tone). For the PDF, use the `eskeewalker-brand-pdf` skill's invoice template and its `renderQuote()` data object. Business details, bank details and the GST rules are in that skill's brand guide.

## invoice_create

1. `take_next_job` type `invoice_create`. Read the history: the proposal or quotation (look for `Proposal sent` stage change and any note with EWS/QT number and amount), the work delivered, the client's company and GSTIN if recorded, the state for GST.
2. If the amount or scope is not in the record, do not guess. `add_note` listing what is missing, `fail_job` with that reason. Jitaksh will add a note and the job will be recreated.
3. Work out the numbers: amount ex GST as quoted; GST only if the client record or a note says GST applies (CGST 9% + SGST 9% for Rajasthan, IGST 18% elsewhere). Due date: 7 days from issue unless the proposal said otherwise.
4. `next_invoice_number` to see the number, then build the PDF with the brand skill using that number, today's date, the business block, bank details and the line items from the proposal. One page.
5. `create_invoice` with `contact_id`, `amount`, `gst`, `due_date`, `pdf_base64`, `mark_sent: false`. It reserves the number (which must match what you printed; if it does not, rebuild the PDF with the returned number and `update_invoice` with the new `pdf_link`).
6. Draft the cover email (`message_type: invoice_cover`) with the PDF link in the body and the invoice attached by link. Then `request_send`.
7. `add_note` with the invoice number and amount. `complete_job` decision `wrote`.

Jitaksh approves the cover email in Slack; sending it sets the invoice to Sent and the stage to Invoice sent (he does this with `/ops` or in Twenty if it does not happen automatically).

## invoice_reminder

1. `take_next_job` type `invoice_reminder`. The job payload names the reminder: `before_3`, `due`, `after_7`, `after_14`, and the invoice number and due date.
2. Check the invoice in history is still Sent or Overdue. If Paid, `complete_job` decision `done` with reason "already paid".
3. Check for any inbound message since the invoice went out that mentions payment. If they said it is being processed, `complete_job` decision `waited` and `add_note`.
4. Draft the reminder (`message_type: invoice_reminder`). Tone by stage:
   - `before_3`: a courtesy note, one line, with the link and due date.
   - `due`: plain reminder that it is due today.
   - `after_7`: direct, asks for a date they will pay, offers to resend details.
   - `after_14`: firm but polite, states the amount outstanding and that the Ownership term in the proposal applies, asks for a reply by a date 3 working days out.
5. `request_send`, then `complete_job` decision `wrote`.

## Rules

- Never change the amount on a reminder. Never add late fees; none are in our terms.
- No payment-pressure lines before `after_14`. The Ownership term does the job quietly.
- Keep every reminder under 90 words. Always include the invoice number, amount with GST stated separately if any, due date and the PDF link.
- Sign "Jitaksh".

## Good examples

**1. Cover email.**

> Subject: Invoice EWS/INV/26-27/007 for the positioning sprint
>
> Hi Priya,
>
> Thank you for the work over the last three weeks. The final documents are in the shared folder, and the invoice is here: [link]
>
> Invoice EWS/INV/26-27/007, Rs 1,20,000 plus GST Rs 21,600, due 26 November. Bank details are on the invoice.
>
> Jitaksh

**2. Reminder, due today.**

> Subject: Invoice EWS/INV/26-27/007 is due today
>
> Hi Priya,
>
> A reminder that invoice EWS/INV/26-27/007 (Rs 1,41,600 including GST) is due today. The PDF is here: [link]
>
> If it is already on its way, ignore this.
>
> Jitaksh

**3. Reminder, 14 days after.**

> Subject: Invoice EWS/INV/26-27/007, now 14 days overdue
>
> Hi Priya,
>
> Invoice EWS/INV/26-27/007 for Rs 1,41,600 is 14 days past its due date of 26 November. As the proposal sets out, the final work belongs to you on full payment.
>
> Could you reply by Thursday with the date the transfer will be made? If something is blocking it, tell me and we will sort it.
>
> Jitaksh

## Bad examples, and why

**1. Threatening early.**

> Hi Priya, your invoice is due tomorrow. Please note that late payments attract a 2% monthly penalty and may result in suspension of deliverables.

No penalty exists in our terms, and this is the courtesy reminder.

**2. Apologetic and vague.**

> Hi Priya, so sorry to bother you, I know you must be busy, but whenever you get a chance could you maybe look at the invoice? No rush at all!

Undermines the invoice, no number, no amount, no link, exclamation mark.

**3. Wrong numbers.**

> Invoice EWS/INV/26-27/7 for Rs 120000 + 18% GST.

Number format wrong (must be three digits), amount not formatted in Indian style, GST amount not stated.
