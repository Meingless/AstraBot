import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("backup lifecycle", () => {
  const root = mkdtempSync(path.join(tmpdir(), "astra-backup-test-"));
  const databasePath = path.join(root, "source.db");
  const backupDirectory = path.join(root, "backups");
  const key = Buffer.alloc(32, 6).toString("base64");
  let modules: {
    backup: typeof import("./backup.js");
    format: typeof import("./backup-format.js");
    database: typeof import("./database.js");
  };

  beforeAll(async () => {
    process.env.ASTRA_DB_PATH = databasePath;
    process.env.BACKUP_ENCRYPTION_KEY = key;
    vi.resetModules();
    const [backup, format, database] = await Promise.all([
      import("./backup.js"),
      import("./backup-format.js"),
      import("./database.js"),
    ]);
    modules = { backup, format, database };
    database.saveGuildConfig("123456789012345678", {
      ...((await import("./config.js")).defaultConfig),
      welcomeEnabled: true,
    });
  });

  afterAll(() => {
    modules.database.closeDatabase();
    delete process.env.ASTRA_DB_PATH;
    delete process.env.BACKUP_ENCRYPTION_KEY;
  });

  it("creates, encrypts, uploads, and validates a consistent SQLite copy", async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const result = await modules.backup.runBackup({
      directory: backupDirectory,
      now: new Date("2026-08-09T12:00:00.000Z"),
      upload,
    });
    expect(statSync(result.file).mode & 0o777).toBe(0o600);
    expect(result.offsite).toBe(true);
    expect(upload).toHaveBeenCalledOnce();
    const plain = modules.format.decryptBackup(
      readFileSync(result.file),
      Buffer.from(key, "base64"),
    );
    const restored = path.join(root, "inspection.db");
    writeFileSync(restored, plain);
    const inspection = new DatabaseSync(restored);
    expect((inspection.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check)
      .toBe("ok");
    expect(inspection.prepare("SELECT COUNT(*) AS count FROM guild_configs").get())
      .toEqual({ count: 1 });
    inspection.close();
  });

  it("rotates only expired encrypted backup files", () => {
    const expired = path.join(backupDirectory, "astra-expired.db.enc");
    const unrelated = path.join(backupDirectory, "notes.txt");
    writeFileSync(expired, "old");
    writeFileSync(unrelated, "keep");
    const old = new Date("2026-07-01T00:00:00.000Z");
    utimesSync(expired, old, old);
    expect(modules.backup.rotateBackups(
      backupDirectory,
      7,
      new Date("2026-08-09T00:00:00.000Z").getTime(),
    )).toBe(1);
    expect(statSync(unrelated).isFile()).toBe(true);
  });

  it("marks readiness unhealthy when required off-site upload fails", async () => {
    process.env.BACKUP_ENABLED = "true";
    const result = await modules.backup.runBackup({
      directory: backupDirectory,
      now: new Date("2026-08-10T12:00:00.000Z"),
      upload: vi.fn().mockRejectedValue(new Error("off-site unavailable")),
    });
    expect(result.offsite).toBe(false);
    expect(modules.backup.backupHealthy()).toBe(false);
    await modules.backup.runBackup({
      directory: backupDirectory,
      now: new Date("2026-08-10T13:00:00.000Z"),
    });
    expect(modules.backup.backupHealthy()).toBe(true);
    delete process.env.BACKUP_ENABLED;
  });
});
