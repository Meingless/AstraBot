import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

describe("legacy database upgrade", () => {
  it("repairs duplicate open tickets before enforcing the v2 invariant", async () => {
    const databasePath = path.join(
      mkdtempSync(path.join(tmpdir(), "astra-migration-")),
      "legacy.db",
    );
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        assignee_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('open', 'assigned', 'closed')),
        created_at INTEGER NOT NULL,
        assigned_at INTEGER,
        closed_at INTEGER,
        transcript_ciphertext TEXT,
        transcript_nonce TEXT,
        transcript_tag TEXT,
        transcript_expires_at INTEGER
      );
      INSERT INTO tickets
        (guild_id, channel_id, owner_id, owner_name, status, created_at)
      VALUES
        ('guild', 'old-channel', 'owner', 'Owner', 'open', 1),
        ('guild', 'new-channel', 'owner', 'Owner', 'assigned', 2);
      PRAGMA user_version = 1;
    `);
    legacy.close();
    process.env.ASTRA_DB_PATH = databasePath;
    vi.resetModules();
    const database = await import("./database.js");
    const tickets = database.listTickets("guild");
    expect(tickets.find((ticket) => ticket.channelId === "old-channel")?.status)
      .toBe("closed");
    expect(tickets.find((ticket) => ticket.channelId === "new-channel")?.status)
      .toBe("assigned");
    expect(() => database.createTicket("guild", "third-channel", "owner", "Owner"))
      .toThrow();
    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    expect((inspection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
      .toBe(3);
    inspection.close();
  });
});
