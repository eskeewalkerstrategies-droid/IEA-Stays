# EskeeWalker Strategies: business rules

This file is what every agent reads before writing anything. It is written to be handed to a new employee. Items marked **CONFIRM** were drafted from existing documents and need Jitaksh's sign-off; the open questions at the end replace the interview the build guide asked for.

## 1. Who we are

- **Display name:** EskeeWalker Strategies. **Legal name:** EskeeWalker Strategies LLP.
- **Based in:** Jaipur, Rajasthan, India. The full address appears only on quotations and invoices.
- **Founder and signatory:** Jitaksh Jain, Founder & Director.
- **What we do:** business strategy, brand positioning, marketing strategy, growth planning, and AI adoption for founders and growing companies. We combine strategic thinking with practical execution. We do not sell theory.
- **Ambition:** an AI-driven business and strategy consultancy that solves meaningful problems across strategy, positioning, growth and modern business transformation.

## 2. Who we sell to

**Ideal client (CONFIRM):**

- Founder-led or owner-led businesses in India with a product or service that already sells, typically between early traction and the first serious growth push.
- Decision-maker is the founder or a director. We do not sell to committees.
- They have a clear commercial problem: positioning is muddy, growth has stalled, marketing spend is not converting, or they want to adopt AI in the business and do not know where to start.
- They can commit to a scoped engagement and answer feedback within 24 hours.

**Not a fit:**

- Businesses looking for an execution-only vendor (just design, just ads, just posts) with no strategic question.
- Pre-idea founders with no product and no budget.
- Anyone who needs a decision by committee or a tender process.

**Lead score (0 to 100), used by the Intake agent:**

| Signal | Points |
|---|---|
| Decision-maker (founder, director, owner) | 25 |
| Clear strategic problem stated in their own words | 25 |
| Business is trading (website, listings, team, or revenue signals) | 20 |
| Company size 5 to 200 people or revenue signals that match | 15 |
| India-based or India-focused | 10 |
| Work email on a company domain | 5 |

Score 70 and above: hot, Slack "call now" alert. 40 to 69: warm, normal follow-up. Under 40: cold, nurture only.

## 3. Offers and prices (CONFIRM every number)

| Offer | What it is | Typical price (INR, ex GST) | Timeline |
|---|---|---|---|
| Strategy call | 60-minute paid diagnostic call with a written summary of findings and next steps | Confirm | Within 5 working days of confirmation |
| Brand and positioning sprint | Positioning, messaging, audience and offer architecture, delivered as a strategy document and a working session | Confirm | 15 to 20 working days |
| Growth and marketing strategy | Channel strategy, content system, funnel and budget plan with a 90-day execution roadmap | Confirm | 20 to 25 working days |
| AI adoption roadmap | Audit of where AI changes the business, prioritised use cases, tool stack, rollout plan and governance | Confirm | 15 to 20 working days |
| Retainer advisory | Monthly strategic partner: fixed hours, weekly call, async access | Confirm per month | Rolling, 3-month minimum |
| Content and video production | Brand content from long-form to social channels, quoted per project | Per quotation | Per quotation |

Pricing rules:

- Quote in INR. GST is off by default; add CGST 9% + SGST 9% for Rajasthan clients, IGST 18% for other states, only when told to.
- Timelines are day counts from confirmation, never calendar dates, and assume client feedback within 24 hours of each share.
- No "100% advance" pressure lines. The Ownership term ("On full payment, the final work belongs to the client") does that job.
- Changes after sign-off are quoted separately.
- Numbering: quotations EWS/QT/YY-YY/NNN, invoices EWS/INV/YY-YY/NNN, financial year April to March. The backend hands out the next number.

## 4. Tone of voice

- Direct and plain. Write like a sharp colleague, not a brochure.
- Short paragraphs, mostly one idea each. One clear next step per message.
- No flattery, no "great to connect", no "I hope this email finds you well".
- No em dashes. Use commas, colons, or a new sentence.
- No generic AI phrasing: "leverage", "unlock", "elevate", "seamless", "synergy", "in today's fast-paced world" are banned.
- Say what we think. If a client's plan has a flaw, name it politely and propose the alternative.
- Specific beats impressive: refer to something real about the person or their business.
- Hinglish is fine in conversation when the contact writes that way. Written documents are in English.
- Sign emails as "Jitaksh" with "EskeeWalker Strategies" on the next line. No phone number is on record.

## 5. Client stages

Used in Twenty (field `stage`) and in `ops.contacts.stage`. Only these values are valid.

| Stage | Meaning | Enters when | Leaves when |
|---|---|---|---|
| New lead | Just arrived from a form, tool, referral or reply | Lead form, free tool, manual entry, outbound reply | Intake agent scores it |
| Qualified | Scored 40 or above and matches the ideal client | Intake agent or manual | Call booked, or Lost, or Dormant after 30 days silence |
| Call booked | A call is on the calendar | Booking webhook | Call happens (Proposal sent) or is missed (back to Qualified with a rebooking job) |
| Proposal sent | A proposal or quotation has gone out | Manual or `change_stage` after the send | Signed (Active client) or Lost or Dormant |
| Active client | Work is in progress | Signed proposal or first payment | Project complete |
| Invoice sent | Final or milestone invoice is out and unpaid | Invoice skill | Paid (Completed) or 1 day past due (Overdue) |
| Overdue | Invoice past due date | Backend daily job | Paid (Completed) |
| Completed | Paid and delivered | Invoice marked paid | Re-engages (Qualified) or Dormant after 90 days |
| Dormant | No contact for a set period | Backend daily job (30 days for leads, 90 days for completed clients) | Any inbound reply (Qualified) |
| Lost | Said no, or unreachable after 3 follow-ups | Reply agent or manual | Manual only |
| Prospect | Cold outbound target, not yet a lead (Phase 5 only) | Outbound list import | Replies (New lead) |

## 6. Sales process

1. **Arrive.** Form, free tool, referral or reply creates a New lead with a consent record.
2. **Instant reply.** The backend sends a fixed, pre-approved email within a minute, with the booking link. Jitaksh gets a Slack alert; hot leads get a "call now" prompt.
3. **Intake.** Within the hour, the Intake agent researches the company, scores the lead, sets the stage, and drafts a personal first message for approval.
4. **Follow-up.** The Follow-up agent drafts the next message for every contact whose next follow-up date is today. Three follow-ups at most for a lead, then Dormant. Each follow-up adds something new: an article, an example, a specific observation.
5. **Call.** Booked through the booking page. Reminders at 24 hours and 1 hour. A missed call creates a rebooking job.
6. **Proposal.** Written with the brand PDF skill, sent by Jitaksh, stage set to Proposal sent. Follow-ups at 3, 7 and 14 days.
7. **Work and invoice.** On completion the Invoice skill creates the GST invoice PDF and cover email. Reminders at 3 days before due, on the due date, and 7 and 14 days after.
8. **Paid.** Marked paid by hand in Twenty. The backend stops the reminders and moves the stage to Completed.

## 7. Follow-up rules

- Follow-up dates: leads at +2, +5, +10 working days from the last message. Proposals at +3, +7, +14. Invoices as above.
- Never follow up on the same day as an inbound reply. A reply resets the clock and goes to the Reply agent.
- Never send to a contact without email consent, or after an unsubscribe.
- Working hours for sends: 9:30 to 18:30 India time, Monday to Saturday. Nothing on Sundays or national holidays.
- Message types that may send without approval are listed in `ops.settings.safe_send_types`. At launch the list is empty. Candidates after two clean weeks: invoice reminders, call reminders.

## 8. Message types

| Type | Who writes it | Approval |
|---|---|---|
| `instant_response` | Fixed template in code | Pre-approved |
| `intake_first_message` | Intake agent | Always |
| `follow_up` | Follow-up agent | Always |
| `call_reminder` | Fixed template in code | Safe after two clean weeks |
| `rebooking` | Follow-up agent | Always |
| `invoice_cover` | Invoice agent | Always |
| `invoice_reminder` | Invoice agent | Safe after two clean weeks |
| `reply_answer` | Reply agent | Always |
| `newsletter` | Repurpose agent via listmonk | Always |
| `linkedin_post` | Repurpose agent | Always |

## 9. Open questions for Jitaksh

Answer these in this file and delete the question.

1. Prices for each offer in section 3, and whether the strategy call is paid or free.
2. Which mailbox sends client follow-ups: founder@ or a shared address like hello@?
3. Who approves drafts in Slack when Jitaksh is away?
4. Are there industries we prefer or avoid? (Adds or subtracts lead score points.)
5. Minimum engagement size below which we send people to the free tools and newsletter instead?
6. Is the booking page Cal.com or Cal.diy, and what is its link?
