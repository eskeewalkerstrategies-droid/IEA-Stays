import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/** Articles live as Markdown files in src/content/articles. The Writer agent adds files here on a branch. */
const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    pillar: z.string(),
    draft: z.boolean().default(false),
    sources: z.array(z.object({ title: z.string(), url: z.string().url() })).default([]),
    video: z.string().url().optional(),
  }),
});

export const collections = { articles };
