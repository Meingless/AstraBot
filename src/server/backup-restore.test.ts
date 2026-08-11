import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptBackup } from "./backup-format.js";
import { restoreBackup } from "./backup-restore.js";

function createDatabase(file: string, value: string) {
  const database = new DatabaseSync(file);
  database.exec("CREATE TABLE state (value TEXT NOT NULL)");
  database.prepare("INSERT INTO state VALUES (?)").run(value);
  database.close();
}

function readValue(file: string) {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    return (database.prepare("SELECT value FROM state").get() as { value: string }).value;
  } finally {
    database.close();
  }
}

afterEach(() => {
  delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.BACKUP_ENCRYPTION_PREVIOUS_KEYS;
  vi.restoreAllMocks();
});

describe("backup restore safety", () => {
  it("streams a rotated-key restore and atomically preserves the previous database", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "astra-restore-"));
    const sourceDatabase = path.join(root, "source.db");
    const target = path.join(root, "target.db");
    const encrypted = path.join(root, "backup.db.enc");
    const oldKey = Buffer.alloc(32, 12);
    const newKey = Buffer.alloc(32, 13);
    createDatabase(sourceDatabase, "restored");
    createDatabase(target, "previous");
    writeFileSync(encrypted, encryptBackup(readFileSync(sourceDatabase), oldKey));
    process.env.BACKUP_ENCRYPTION_KEY = newKey.toString("base64");
    process.env.BACKUP_ENCRYPTION_PREVIOUS_KEYS = oldKey.toString("base64");

    const result = await restoreBackup({ source: encrypted, target });
    expect(readValue(target)).toBe("restored");
    expect(readValue(result.rollback!)).toBe("previous");
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("leaves the live database untouched when rollback creation fails", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "astra-restore-failure-"));
    const sourceDatabase = path.join(root, "source.db");
    const target = path.join(root, "target.db");
    const encrypted = path.join(root, "backup.db.enc");
    const key = Buffer.alloc(32, 14);
    createDatabase(sourceDatabase, "replacement");
    createDatabase(target, "live");
    writeFileSync(encrypted, encryptBackup(readFileSync(sourceDatabase), key));
    process.env.BACKUP_ENCRYPTION_KEY = key.toString("base64");
    await expect(restoreBackup({
      source: encrypted,
      target,
      copyFile: () => {
        throw new Error("rollback disk full");
      },
    })).rejects.toThrow(/rollback disk full/u);
    expect(readValue(target)).toBe("live");
  });
});
