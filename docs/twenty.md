# Twenty CRM: install and fields

Twenty is the CRM. It lives at `crm.ops.<yourdomain>`. The Ops backend mirrors its People, Companies and Invoices into the `ops` database by webhook, so agents read from `ops` and write back through Twenty's API.

## Install in Coolify

1. Project ew-ops, **+ New**, Docker Compose, paste Twenty's official `docker-compose.yml` for the version you are pinning. Change the image tags from `latest` to the exact version (for example `twentycrm/twenty:v1.x.y`). Write the version here: **pinned version: ______**.
2. Remove the bundled `db` service from the compose file and point `PG_DATABASE_URL` at `postgres://twenty:<pw>@postgres:5432/twenty` (see `infra/postgres.md`). Keep the bundled Redis.
3. Environment variables: `SERVER_URL=https://crm.ops.<yourdomain>`, `APP_SECRET=<generate with openssl rand -base64 32>`, `STORAGE_TYPE=local`. Store `APP_SECRET` in the secrets record at once.
4. Set the domain `crm.ops.<yourdomain>` on the `server` service, port 3000. Deploy.
5. Open it, create the workspace, create the admin user.

Upgrade only one app at a time, at most once a month, after a manual backup, and read the release notes with Claude first. Twenty has broken on upgrades.

## Custom fields on People and Companies

Settings, Data model, People. Add these fields with these exact API names. The backend reads them by name (`backend/src/twenty/fields.ts`).

| Label | API name | Type | Values or notes |
|---|---|---|---|
| Stage | `stage` | Select | New lead, Qualified, Call booked, Proposal sent, Active client, Invoice sent, Overdue, Completed, Dormant, Lost, Prospect |
| Lead source | `leadSource` | Select | website_form, free_tool, referral, linkedin, newsletter, outbound, manual |
| Lead score | `leadScore` | Number | 0 to 100 |
| Email consent | `emailConsent` | Boolean | |
| Consent date | `consentDate` | Date | |
| Next follow-up date | `nextFollowUpAt` | Date | |
| Last contact date | `lastContactAt` | Date | |
| Owner | `owner` | Relation to Workspace member | |
| Tool used | `toolUsed` | Text | Name of the free tool that captured them |

Add `stage`, `leadSource` and `owner` to Companies as well.

## Custom object: Invoice

Settings, Data model, **+ Add object**: Invoice (plural Invoices, API name `invoice`).

| Label | API name | Type | Notes |
|---|---|---|---|
| Number | `number` | Text | EWS/INV/YY-YY/NNN, the backend assigns it |
| Client | `person` | Relation to Person | |
| Company | `company` | Relation to Company | |
| Amount | `amount` | Currency (INR) | Ex GST |
| GST | `gst` | Currency (INR) | 0 when GST is off |
| Issue date | `issueDate` | Date | |
| Due date | `dueDate` | Date | |
| Status | `status` | Select | Draft, Sent, Paid, Overdue |
| Paid date | `paidDate` | Date | |
| PDF link | `pdfLink` | Link | |

## Webhook to the backend

Settings, API & Webhooks, **+ Create webhook**:

- URL: `https://api.ops.<yourdomain>/webhooks/twenty`
- Operations: `person.created`, `person.updated`, `person.deleted`, `company.created`, `company.updated`, `invoice.created`, `invoice.updated`
- Secret: the value of `TWENTY_WEBHOOK_SECRET`

## API key

Settings, API & Webhooks, **+ Create key**, name `ops-backend`. Store it as `TWENTY_API_KEY`. The backend uses the REST API at `TWENTY_API_URL` (`https://crm.ops.<yourdomain>/rest`).

## Importing current clients

Import from a spreadsheet with the columns: first name, last name, email, phone, company, stage, lead source, email consent (yes/no), consent date. Settings, Import. Then check each person sits in the right stage.

## Done when

Changing a person's stage in Twenty creates an `events` row in the ops database within seconds (`stage_changed`), and the mirror in `ops.contacts` shows the new stage.
