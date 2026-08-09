import "dotenv/config";
import type { Server } from "node:http";
import { startBot } from "./bot.js";
import { bot } from "./bot.js";
import { createWebServer } from "./web.js";
import { closeDatabase, purgeExpiredTranscripts } from "./database.js";
import { gauge, log } from "./observability.js";
import { InProcessJobScheduler } from "./jobs.js";
import { validateRuntimeConfig } from "./runtime-config.js";
import { runBackup } from "./backup.js";

const { token, clientId, port } = validateRuntimeConfig();
const app = createWebServer();
const server = app.listen(port, () => log("info", "web_ready", { port }));
const jobs = new InProcessJobScheduler();
const initialPurged = purgeExpiredTranscripts();
if (initialPurged)
  log("info", "ticket_retention_purged", { purged: initialPurged });
jobs.recurring("ticket-transcript-retention", 60 * 60_000, () => {
  const purged = purgeExpiredTranscripts();
  if (purged) log("info", "ticket_retention_purged", { purged });
});
if (process.env.BACKUP_ENABLED === "true") {
  const intervalHours = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || 24));
  void runBackup().catch((error) =>
    log("error", "backup_failed", {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  jobs.recurring("sqlite-backup", intervalHours * 60 * 60_000, async () => {
    await runBackup();
  });
}
startBot(token, clientId)
  .then(() => gauge("discord_connected", 1))
  .catch((error) => {
    gauge("discord_connected", 0);
    log("error", "discord_startup_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals, httpServer: Server = server) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "shutdown_started", { signal });
  jobs.stop();
  const forceTimer = setTimeout(() => {
    log("error", "shutdown_forced", { signal });
    process.exit(1);
  }, 10_000);
  forceTimer.unref();
  httpServer.close(() => {
    try {
      bot.destroy();
      closeDatabase();
      clearTimeout(forceTimer);
      log("info", "shutdown_complete", { signal });
      process.exit(0);
    } catch (error) {
      log("error", "shutdown_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
