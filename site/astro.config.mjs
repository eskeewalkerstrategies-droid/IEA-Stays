import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Static site. Set SITE_URL in Coolify to the live domain so the sitemap and canonical links are right.
export default defineConfig({
  site: process.env.SITE_URL ?? "https://www.eskeewalkerstrategies.com",
  output: "static",
  integrations: [sitemap()],
  trailingSlash: "never",
  build: { format: "file" },
});
