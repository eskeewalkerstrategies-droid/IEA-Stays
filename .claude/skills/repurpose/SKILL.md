---
name: repurpose
description: Once an article is indexed by Google, produce three LinkedIn posts, one rewritten LinkedIn article with a link back, a newsletter section, a long-form video script and three short-video scripts, saved as assets under the content item, and post one approval bundle. Use for repurpose jobs or the Wednesday run.
---

# Repurpose

One article becomes every other channel. It waits for Google to index the original so our site stays canonical.

## Procedure

1. `list_content_items` status `indexed`. Skip any with existing `linkedin_post` assets. For each remaining item, read the article file at `article_path` and the brief.
2. Produce and save with `save_content_asset`:
   - Three `linkedin_post` assets. Each stands alone, 120 to 220 words, a different angle of the article (the example, the contrarian claim, the practical checklist). First line does the work; no "I am excited". No hashtags beyond two. Link to the article in the first comment, note that in `meta.comment_link = true`. Propose `scheduled_for` on three different working days at 09:00 India.
   - One `linkedin_article`: a rewritten version, not a copy, 600 to 900 words, that ends with "The full version with sources is on our site: <link>". `scheduled_for` the following week.
   - One `newsletter_section`: 150 to 250 words for the monthly newsletter, with the link. Markdown.
   - One `long_script`: 8 to 12 minutes spoken, following the brief's `video_outline`, written to be said not read, with [B-ROLL] and [TITLE: ...] markers the editor skill understands.
   - Three `short_script`: 45 to 60 seconds each, a hook in the first line, one idea, one line to close.
3. Post one bundle for approval: `save_draft` channel `note`, `message_type: repurpose_bundle`, `content_item_id` set, body listing every asset with its proposed date. End the run with the same list as your summary for Slack.
4. `update_content_item` status `repurposed`.

Jitaksh approves the bundle. Approved LinkedIn posts become `linkedin` drafts that the backend posts at their scheduled time (a session or agent creates them with `save_draft` channel `linkedin` and `request_send`). The newsletter section goes into the month's campaign draft through `create_campaign_draft` when the month's issue is assembled.

## Rules

- Same voice as the article. No generic LinkedIn phrasing ("Here's the thing", "Let that sink in").
- Never post, never schedule in LinkedIn directly. Assets and drafts only.
- Scripts must contain the original analysis and example from the article. YouTube does not pay for templated content and neither do we.
