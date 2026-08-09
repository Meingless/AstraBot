import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it, vi } from "vitest";

describe("SQLite repositories and migrations", () => {
  let database: typeof import("./database.js");
  let databasePath: string;

  beforeAll(async () => {
    databasePath = path.join(mkdtempSync(path.join(tmpdir(), "astra-db-")), "test.db");
    process.env.ASTRA_DB_PATH = databasePath;
    vi.resetModules();
    database = await import("./database.js");
  });

  it("applies all migrations and database indexes", () => {
    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    expect((inspection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
      .toBe(3);
    const indexes = inspection.prepare("PRAGMA index_list('tickets')").all() as Array<{ name: string }>;
    expect(indexes.some((index) => index.name === "tickets_one_open_per_owner")).toBe(true);
    inspection.close();
    expect(database.databaseHealthy()).toBe(true);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
  });

  it("stores ticket lifecycle and encrypted transcript metadata", () => {
    const ticket = database.createTicket("guild-1", "channel-1", "owner-1", "Owner");
    expect(ticket.status).toBe("open");
    expect(database.getOpenTicketForOwner("guild-1", "owner-1")?.id).toBe(ticket.id);
    expect(database.assignTicket("guild-1", ticket.id, "staff-1")?.status).toBe("assigned");
    database.closeTicket(
      "guild-1",
      ticket.id,
      { ciphertext: "cipher", nonce: "nonce", tag: "tag" },
      Date.now() + 1000,
    );
    expect(database.getTicketById("guild-1", ticket.id)?.hasTranscript).toBe(true);
    expect(database.purgeExpiredTranscripts(Date.now() + 2000)).toBe(1);
    expect(database.getTicketById("guild-1", ticket.id)?.hasTranscript).toBe(false);
    expect(database.assignTicket("guild-1", ticket.id, "staff-2")).toBeNull();
    expect(database.closeTicket("guild-1", ticket.id, null, null)).toBeNull();
  });

  it("enforces one active ticket per owner and allows a new ticket after close", () => {
    const first = database.createTicket("guild-unique", "channel-a", "owner-a", "Owner");
    expect(() => database.createTicket("guild-unique", "channel-b", "owner-a", "Owner"))
      .toThrow();
    expect(database.closeTicket("guild-unique", first.id, null, null)?.status).toBe("closed");
    expect(database.createTicket("guild-unique", "channel-c", "owner-a", "Owner").status)
      .toBe("open");
  });

  it("filters and paginates ticket metadata by guild", () => {
    const first = database.createTicket("guild-filter", "filter-1", "owner-1", "Alice");
    database.closeTicket("guild-filter", first.id, null, null);
    const second = database.createTicket("guild-filter", "filter-2", "owner-2", "Bob");
    database.assignTicket("guild-filter", second.id, "staff-9");
    expect(database.listTickets("guild-filter", { status: "closed" }).map((item) => item.id))
      .toEqual([first.id]);
    expect(database.listTickets("guild-filter", { query: "Bob" })[0]?.id).toBe(second.id);
    expect(database.listTickets("guild-filter", { before: second.id })).toHaveLength(1);
  });

  it("stores sessions and expires them", () => {
    const session = {
      user: { id: "user", username: "astra", avatar: null },
      guilds: [{ id: "guild", name: "Guild", icon: null, permissions: "0", owner: false }],
      expiresAt: Date.now() + 60_000,
    };
    database.createSession("active", session);
    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const stored = inspection
      .prepare("SELECT token FROM sessions")
      .get() as { token: string };
    inspection.close();
    expect(stored.token).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored.token).not.toBe("active");
    expect(database.getSession("active")?.user.username).toBe("astra");
    database.deleteSession("active");
    expect(database.getSession("active")).toBeNull();
    database.createSession("expired", { ...session, expiresAt: Date.now() - 1 });
    expect(database.getSession("expired")).toBeNull();
  });

  it("scopes reaction roles and custom commands to guilds", () => {
    database.addReactionRole({
      guildId: "guild-tools",
      channelId: "channel",
      messageId: "message",
      emoji: "🚀",
      roleId: "role",
    });
    expect(database.findReactionRole("guild-tools", "message", "🚀")?.roleId).toBe("role");
    expect(() => database.addReactionRole({
      guildId: "guild-tools",
      channelId: "channel",
      messageId: "message",
      emoji: "🚀",
      roleId: "other",
    })).toThrow();
    database.saveCustomCommand("guild-tools", "hello", "one");
    database.saveCustomCommand("guild-tools", "hello", "two");
    expect(database.listCustomCommands("guild-tools")).toHaveLength(1);
    expect(database.listCustomCommands("guild-tools")[0]?.response).toBe("two");
  });

  it("stores complete audit and moderation histories for privacy export", () => {
    database.addCase("guild-history", "target", "moderator", "warn", "reason");
    database.addAuditEvent("guild-history", "actor", "config.update", {
      targetId: "target",
      metadata: { changedFields: ["locale"] },
    });
    expect(database.listAllCases("guild-history")).toHaveLength(1);
    expect(database.listAllAuditEvents("guild-history")[0]?.metadata)
      .toEqual({ changedFields: ["locale"] });
  });

  it("enforces subscription expiry, plan capabilities, and AI quota limits", async () => {
    const plans = await import("./plans.js");
    database.setGuildSubscription("guild-plan", "standard", null);
    expect(plans.getPlanAccess("guild-plan").capabilities.tickets).toBe(true);
    expect(plans.getPlanAccess("guild-plan").capabilities.advancedAutomod).toBe(false);
    database.setGuildSubscription("guild-expired", "ai", Date.now() - 1);
    expect(plans.getPlanAccess("guild-expired").effectivePlan).toBe("free");
    const existing = database.getGuildConfig("guild-plan-locks");
    existing.ticketsEnabled = true;
    existing.regexEnabled = true;
    const requested = { ...existing, locale: "tr" as const, ticketsEnabled: false, regexEnabled: false };
    const free = plans.getPlanAccess("guild-plan-locks").capabilities;
    const preserved = plans.preserveLockedConfig(existing, requested, free);
    expect(preserved.locale).toBe("tr");
    expect(preserved.ticketsEnabled).toBe(true);
    expect(preserved.regexEnabled).toBe(true);
    expect(database.consumeAiQuota("guild-quota", "commands", 0)).toBe(false);
    expect(database.consumeAiQuota("guild-quota", "commands", 2)).toBe(true);
    expect(database.consumeAiQuota("guild-quota", "commands", 2)).toBe(true);
    expect(database.consumeAiQuota("guild-quota", "commands", 2)).toBe(false);
  });

  it("sanitizes and persists public/developer site settings", () => {
    const current = database.getSiteSettings();
    database.saveSiteSettings({
      ...current,
      announcement: "x".repeat(400),
      aiProvider: "custom",
      aiModel: " model ",
      aiBaseUrl: "https://example.com/",
      plans: current.plans.map((plan) => ({ ...plan, monthlyPrice: -5 })),
    });
    const stored = database.getSiteSettings();
    expect(stored.announcement).toHaveLength(300);
    expect(stored.aiBaseUrl).toBe("https://example.com");
    expect(stored.aiModel).toBe("model");
    expect(stored.plans.every((plan) => plan.monthlyPrice === 0)).toBe(true);
  });

  it("deletes operational data while preserving subscription assignment", () => {
    database.saveGuildConfig("guild-2", database.getGuildConfig("guild-2"));
    database.setGuildSubscription("guild-2", "premium", null);
    database.addAuditEvent("guild-2", "owner", "config.update");
    database.deleteGuildOperationalData("guild-2");
    expect(database.hasGuildConfig("guild-2")).toBe(false);
    expect(database.listAuditEvents("guild-2")).toEqual([]);
    expect(database.getGuildSubscription("guild-2").plan).toBe("premium");
  });
});
