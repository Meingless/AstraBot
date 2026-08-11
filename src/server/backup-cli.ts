import "dotenv/config";
import { restoreBackup } from "./backup-restore.js";

async function backup() {
  const { runBackup } = await import("./backup.js");
  const result = await runBackup();
  process.stdout.write(`${result.file}\n`);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function restore() {
  if (argument("--confirm") !== "RESTORE")
    throw new Error("Restore requires --confirm RESTORE and a stopped Astra service");
  const source = argument("--file");
  if (!source) throw new Error("Restore requires --file <encrypted-backup>");
  const result = await restoreBackup({ source });
  process.stdout.write(
    result.rollback
      ? `Restored ${result.target}; previous database: ${result.rollback}\n`
      : `Restored ${result.target}; no previous database existed\n`,
  );
}

const command = process.argv[2];
if (command === "backup") await backup();
else if (command === "restore") await restore();
else throw new Error("Usage: backup-cli <backup|restore>");
