import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { config } from "../config.js";
import { db } from "../db.js";
import { leads } from "./leads.js";
import { booking } from "./booking.js";
import { twentyWebhook } from "./twentyWebhook.js";
import { slackRoutes } from "./slack.js";
import { tools } from "./tools.js";
import { listmonkWebhook } from "./listmonkWebhook.js";
import { linkedinAuth } from "./linkedinAuth.js";
import { mcpRoutes } from "../mcp/http.js";

export function buildApp(): Hono {
  const app = new Hono();
  mkdirSync(config().FILES_DIR, { recursive: true });

  app.get("/health", async (c) => {
    try {
      await db()`SELECT 1`;
      return c.json({ ok: true, service: "ew-ops-backend", env: config().NODE_ENV });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // Website origin may call the API; keep it narrow in production via PUBLIC site domain if wanted.
  app.use("/api/*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", c.req.header("origin") ?? "*");
    c.header("Access-Control-Allow-Headers", "content-type");
    c.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.route("/", leads);
  app.route("/", booking);
  app.route("/", twentyWebhook);
  app.route("/", slackRoutes);
  app.route("/", tools);
  app.route("/", listmonkWebhook);
  app.route("/", linkedinAuth);
  app.route("/", mcpRoutes);
  app.use("/files/*", serveStatic({ root: config().FILES_DIR, rewriteRequestPath: (p) => p.replace(/^\/files/, "") }));

  app.notFound((c) => c.json({ ok: false, error: "not found" }, 404));
  return app;
}
