import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { migrate } from "./migrate.js";
import { startBoss, stopBoss } from "./jobs/queue.js";
import { startWorkers } from "./workers.js";
import { buildApp } from "./http/app.js";
import { closeDb } from "./db.js";
import { log } from "./log.js";

async function main(): Promise<void> {
  const c = config();
  const applied = await migrate(c.DATABASE_URL);
  if (applied.length) log.info({ applied }, "migrations applied");
  await startBoss();
  await startWorkers();
  const app = buildApp();
  const server = serve({ fetch: app.fetch, port: c.PORT }, (info) => log.info({ port: info.port }, "ops backend listening"));

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    server.close();
    await stopBoss();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err }, "fatal");
  process.exit(1);
});
