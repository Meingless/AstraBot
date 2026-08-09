import "dotenv/config";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decryptBackup, parseBackupKey } from "./backup-format.js";

async function backup() {
  const { runBackup } = await import("./backup.js");
  const result = await runBackup();
  process.stdout.write(`${result.file}\n`);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function restore() {
  if (argument("--confirm") !== "RESTORE")
    throw new Error("Restore requires --confirm RESTORE and a stopped Astra service");
  const source = argument("--file");
  if (!source) throw new Error("Restore requires --file <encrypted-backup>");
  const target = path.resolve(process.env.ASTRA_DB_PATH || "data/astra.db");
  const directory = path.dirname(target);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.restore.tmp`;
  const rollback = `${target}.before-restore`;
  const plaintext = decryptBackup(readFileSync(path.resolve(source)), parseBackupKey());
  writeFileSync(temporary, plaintext, { mode: 0o600 });
  const inspection = new DatabaseSync(temporary);
  const row = inspection.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  inspection.close();
  if (row.integrity_check !== "ok") {
    unlinkSync(temporary);
    throw new Error(`Backup integrity check failed: ${row.integrity_check}`);
  }
  try { unlinkSync(rollback); } catch { /* no previous rollback */ }
  try { copyFileSync(target, rollback); } catch { /* fresh restore */ }
  renameSync(temporary, target);
  chmodSync(target, 0o600);
  process.stdout.write(`Restored ${target}; previous database: ${rollback}\n`);
}

const command = process.argv[2];
if (command === "backup") await backup();
else if (command === "restore") restore();
else throw new Error("Usage: backup-cli <backup|restore>");

