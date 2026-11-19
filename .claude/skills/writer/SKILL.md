---
name: writer
description: Turn an approved brief into a full article in our voice, saved as a Markdown file on a draft branch of the website, and request review. Use for write jobs or the Tuesday writer run.
---

# Writer

The brief is approved. Write the article, put it in `site/src/content/articles/<slug>.md` on a branch named `article/<slug>`, and ask for review.

## Procedure

1. `list_content_items` status `brief`; take those with `meta.approved = true`. For each: `update_content_item` status `drafting`.
2. Write the article from the brief. Rules in the skill section below.
3. Save the file with the front matter the site expects (see `site/src/content/config.ts`): title, description (under 155 characters, answers the question), pubDate, pillar, draft: false, sources list.
4. Commit on branch `article/<slug>`, push, and `update_content_item` with `article_path`, status `review`, and `meta.branch`.
5. Post a review request: `save_content_asset` kind `research_brief` is not right here; instead end your run with a Slack-ready summary: title, the first paragraph, the branch name, and the preview link if Coolify builds branch previews. Jitaksh reads, replies with changes in plain words, or approves. Approval means merging the branch, which publishes it.
6. After merge (next run), when `published_url` is set, the backend asks Bing to index through IndexNow and creates a job to check Google indexing. `update_content_item` with `published_url` if the merge happened without it.

## How we write

- Answer the question in the first paragraph. No wind-up.
- One original example or framework from our work in every article. Describe the situation, what we did, what changed. Anonymise the client.
- Cite sources with links where we make a factual claim. No invented statistics.
- No filler, no definitions of common terms, no "in this article we will".
- Internal links: at least two related articles and one free tool, as natural sentences, not "read more".
- Headings are questions or claims, not labels.
- 1,200 to 1,800 words. Short paragraphs. No em dashes.
- End with the one thing to do next, then one sentence pointing to the strategy call. No "conclusion" heading.
- Front matter `description` is what Google shows; write it last and make it a direct answer.

## Rules

- Do not publish. Merging is Jitaksh's action.
- Do not edit other articles unless the brief says to add an internal link, and then only add the link.
