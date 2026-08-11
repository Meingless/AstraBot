import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decryptBackupFile, parseBackupKeys } from "./backup-format.js";

type RestoreOptions = {
  source: string;
  target?: string;
  copyFile?: (source: string, destination: string) => void;
};

function removeIfPresent(file: string) {
  try {
    unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function restoreBackup({
  source,
  target = process.env.ASTRA_DB_PATH || "data/astra.db",
  copyFile = copyFileSync,
}: RestoreOptions) {
  const resolvedTarget = path.resolve(target);
  const resolvedSource = path.resolve(source);
  const directory = path.dirname(resolvedTarget);
  const temporary = `${resolvedTarget}.restore.tmp`;
  const rollback = `${resolvedTarget}.before-restore`;
  const rollbackTemporary = `${rollback}.tmp`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(`${resolvedTarget}-wal`) || existsSync(`${resolvedTarget}-shm`))
    throw new Error("Refusing restore while SQLite WAL/SHM files exist; stop Astra cleanly first");
  removeIfPresent(temporary);
  removeIfPresent(rollbackTemporary);
  try {
    await decryptBackupFile(resolvedSource, temporary, parseBackupKeys());
    chmodSync(temporary, 0o600);
    const inspection = new DatabaseSync(temporary, { readOnly: true });
    let integrity: string;
    try {
      integrity = (inspection.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      }).integrity_check;
    } finally {
      inspection.close();
    }
    if (integrity !== "ok")
      throw new Error(`Backup integrity check failed: ${integrity}`);

    const hadPreviousDatabase = existsSync(resolvedTarget);
    if (hadPreviousDatabase) {
      copyFile(resolvedTarget, rollbackTemporary);
      chmodSync(rollbackTemporary, 0o600);
      renameSync(rollbackTemporary, rollback);
    }
    renameSync(temporary, resolvedTarget);
    chmodSync(resolvedTarget, 0o600);
    return {
      target: resolvedTarget,
      rollback: hadPreviousDatabase ? rollback : null,
    };
  } finally {
    removeIfPresent(temporary);
    removeIfPresent(rollbackTemporary);
  }
}
