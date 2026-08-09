import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaultConfig, sanitizeConfig, type GuildConfig } from "./config.js";

const databasePath = process.env.ASTRA_DB_PATH || "data/astra.db";

function openDatabase(): DatabaseSync {
  const previousUmask = process.umask(0o077);
  try {
    mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    return new DatabaseSync(databasePath);
  } finally {
    process.umask(previousUmask);
  }
}

const db = openDatabase();
if (databasePath !== ":memory:") {
  chmodSync(databasePath, 0o600);
}
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS guild_configs (
    guild_id TEXT PRIMARY KEY,
    config TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_json TEXT NOT NULL,
    guilds_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS reaction_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL, emoji TEXT NOT NULL, role_id TEXT NOT NULL, UNIQUE(guild_id, message_id, emoji));
  CREATE TABLE IF NOT EXISTS custom_commands (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, name TEXT NOT NULL, response TEXT NOT NULL, UNIQUE(guild_id, name));
  CREATE TABLE IF NOT EXISTS moderation_cases (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, target_id TEXT NOT NULL, moderator_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS guild_subscriptions (
    guild_id TEXT PRIMARY KEY,
    plan TEXT NOT NULL CHECK(plan IN ('free', 'standard', 'premium', 'ai')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status = 'active'),
    starts_at INTEGER NOT NULL,
    expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS guild_subscriptions_expiry ON guild_subscriptions(expires_at);
  CREATE TABLE IF NOT EXISTS ai_daily_usage (
    guild_id TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('commands', 'moderation')),
    used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, usage_date, category)
  );
`);

function sessionKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function migrate() {
  const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version.user_version < 1) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_id TEXT,
        channel_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_events_guild_created
        ON audit_events(guild_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS tickets (
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
      CREATE INDEX IF NOT EXISTS tickets_guild_status_created
        ON tickets(guild_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS tickets_transcript_expiry
        ON tickets(transcript_expires_at);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }
  if (version.user_version < 2) {
    db.exec(`
      BEGIN IMMEDIATE;
      UPDATE tickets
      SET status = 'closed', closed_at = COALESCE(closed_at, created_at)
      WHERE status != 'closed'
        AND id NOT IN (
          SELECT MAX(id) FROM tickets
          WHERE status != 'closed'
          GROUP BY guild_id, owner_id
        );
      CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_open_per_owner
        ON tickets(guild_id, owner_id) WHERE status != 'closed';
      PRAGMA user_version = 2;
      COMMIT;
    `);
  }
  if (version.user_version < 3) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const sessions = db.prepare("SELECT token FROM sessions").all() as Array<{
        token: string;
      }>;
      const update = db.prepare("UPDATE sessions SET token = ? WHERE token = ?");
      for (const { token } of sessions) update.run(sessionKey(token), token);
      db.exec("PRAGMA user_version = 3; COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

migrate();

type DiscordUser = {
  id: string;
  username: string;
  avatar: string | null;
  global_name?: string | null;
};
export type DiscordGuild = {
  id: string;
  name: string;
  icon: string | null;
  permissions: string;
  owner: boolean;
};
export type Session = {
  user: DiscordUser;
  guilds: DiscordGuild[];
  expiresAt: number;
};

export function getGuildConfig(guildId: string): GuildConfig {
  const row = db
    .prepare("SELECT config FROM guild_configs WHERE guild_id = ?")
    .get(guildId) as { config: string } | undefined;
  if (!row) return { ...defaultConfig };
  try {
    return sanitizeConfig(JSON.parse(row.config));
  } catch {
    return { ...defaultConfig };
  }
}

export function hasGuildConfig(guildId: string) {
  return Boolean(
    db.prepare("SELECT 1 AS found FROM guild_configs WHERE guild_id = ?").get(guildId),
  );
}

export function saveGuildConfig(guildId: string, config: GuildConfig) {
  db.prepare(
    `INSERT INTO guild_configs (guild_id, config, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
  ).run(guildId, JSON.stringify(config), Date.now());
}

export function createSession(token: string, session: Session) {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(
    sessionKey(token),
    JSON.stringify(session.user),
    JSON.stringify(session.guilds),
    session.expiresAt,
  );
}

export function getSession(token: string): Session | null {
  const row = db
    .prepare(
      "SELECT user_json, guilds_json, expires_at FROM sessions WHERE token = ? AND expires_at > ?",
    )
    .get(sessionKey(token), Date.now()) as
    | { user_json: string; guilds_json: string; expires_at: number }
    | undefined;
  return row
    ? {
        user: JSON.parse(row.user_json),
        guilds: JSON.parse(row.guilds_json),
        expiresAt: row.expires_at,
      }
    : null;
}

export function deleteSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(sessionKey(token));
}

export type ReactionRole = {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string;
  emoji: string;
  roleId: string;
};
export type CustomCommand = {
  id: number;
  guildId: string;
  name: string;
  response: string;
};
export function listReactionRoles(guildId: string) {
  return (
    db
      .prepare(
        "SELECT id, guild_id, channel_id, message_id, emoji, role_id FROM reaction_roles WHERE guild_id = ? ORDER BY id DESC",
      )
      .all(guildId) as Array<{
      id: number;
      guild_id: string;
      channel_id: string;
      message_id: string;
      emoji: string;
      role_id: string;
    }>
  ).map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    emoji: row.emoji,
    roleId: row.role_id,
  }));
}
export function addReactionRole(rule: Omit<ReactionRole, "id">) {
  db.prepare(
    "INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?, ?)",
  ).run(rule.guildId, rule.channelId, rule.messageId, rule.emoji, rule.roleId);
}
export function deleteReactionRole(guildId: string, id: number) {
  db.prepare("DELETE FROM reaction_roles WHERE guild_id = ? AND id = ?").run(
    guildId,
    id,
  );
}
export function findReactionRole(
  guildId: string,
  messageId: string,
  emoji: string,
) {
  return listReactionRoles(guildId).find(
    (item) => item.messageId === messageId && item.emoji === emoji,
  );
}
export function listCustomCommands(guildId: string) {
  return (
    db
      .prepare(
        "SELECT id, guild_id, name, response FROM custom_commands WHERE guild_id = ? ORDER BY name",
      )
      .all(guildId) as Array<{
      id: number;
      guild_id: string;
      name: string;
      response: string;
    }>
  ).map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    response: row.response,
  }));
}
export function saveCustomCommand(
  guildId: string,
  name: string,
  response: string,
) {
  db.prepare(
    "INSERT INTO custom_commands (guild_id, name, response) VALUES (?, ?, ?) ON CONFLICT(guild_id, name) DO UPDATE SET response = excluded.response",
  ).run(guildId, name, response);
}
export function deleteCustomCommand(guildId: string, id: number) {
  db.prepare("DELETE FROM custom_commands WHERE guild_id = ? AND id = ?").run(
    guildId,
    id,
  );
}
export function addCase(
  guildId: string,
  targetId: string,
  moderatorId: string,
  action: string,
  reason: string,
) {
  db.prepare(
    "INSERT INTO moderation_cases (guild_id, target_id, moderator_id, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(guildId, targetId, moderatorId, action, reason, Date.now());
}
export function listCases(guildId: string, limit = 100) {
  return db
    .prepare(
      "SELECT id, target_id, moderator_id, action, reason, created_at FROM moderation_cases WHERE guild_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(guildId, Math.min(250, Math.max(1, limit)));
}

export function listAllCases(guildId: string) {
  return db
    .prepare(
      "SELECT id, target_id, moderator_id, action, reason, created_at FROM moderation_cases WHERE guild_id = ? ORDER BY id DESC",
    )
    .all(guildId);
}

export type AuditEvent = {
  id: number;
  guildId: string;
  actorId: string;
  action: string;
  targetId: string | null;
  channelId: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
};

export function addAuditEvent(
  guildId: string,
  actorId: string,
  action: string,
  options: {
    targetId?: string | null;
    channelId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  db.prepare(
    "INSERT INTO audit_events (guild_id, actor_id, action, target_id, channel_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    guildId,
    actorId,
    action.slice(0, 80),
    options.targetId || null,
    options.channelId || null,
    JSON.stringify(options.metadata || {}),
    Date.now(),
  );
}

export function listAuditEvents(guildId: string, limit = 100): AuditEvent[] {
  const rows = db
    .prepare(
      "SELECT id, guild_id, actor_id, action, target_id, channel_id, metadata, created_at FROM audit_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(guildId, Math.min(250, Math.max(1, limit))) as Array<{
      id: number;
      guild_id: string;
      actor_id: string;
      action: string;
      target_id: string | null;
      channel_id: string | null;
      metadata: string;
      created_at: number;
    }>;
  return rows.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    actorId: row.actor_id,
    action: row.action,
    targetId: row.target_id,
    channelId: row.channel_id,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}

export function listAllAuditEvents(guildId: string): AuditEvent[] {
  const rows = db
    .prepare(
      "SELECT id, guild_id, actor_id, action, target_id, channel_id, metadata, created_at FROM audit_events WHERE guild_id = ? ORDER BY created_at DESC",
    )
    .all(guildId) as Array<{
      id: number;
      guild_id: string;
      actor_id: string;
      action: string;
      target_id: string | null;
      channel_id: string | null;
      metadata: string;
      created_at: number;
    }>;
  return rows.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    actorId: row.actor_id,
    action: row.action,
    targetId: row.target_id,
    channelId: row.channel_id,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}

export type TicketStatus = "open" | "assigned" | "closed";
export type Ticket = {
  id: number;
  guildId: string;
  channelId: string;
  ownerId: string;
  ownerName: string;
  assigneeId: string | null;
  status: TicketStatus;
  createdAt: number;
  assignedAt: number | null;
  closedAt: number | null;
  transcriptExpiresAt: number | null;
  hasTranscript: boolean;
};

type TicketRow = {
  id: number;
  guild_id: string;
  channel_id: string;
  owner_id: string;
  owner_name: string;
  assignee_id: string | null;
  status: TicketStatus;
  created_at: number;
  assigned_at: number | null;
  closed_at: number | null;
  transcript_expires_at: number | null;
  transcript_ciphertext: string | null;
};

function ticketFromRow(row: TicketRow): Ticket {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    assigneeId: row.assignee_id,
    status: row.status,
    createdAt: row.created_at,
    assignedAt: row.assigned_at,
    closedAt: row.closed_at,
    transcriptExpiresAt: row.transcript_expires_at,
    hasTranscript: Boolean(row.transcript_ciphertext),
  };
}

const ticketColumns =
  "id, guild_id, channel_id, owner_id, owner_name, assignee_id, status, created_at, assigned_at, closed_at, transcript_expires_at, transcript_ciphertext";

export function createTicket(
  guildId: string,
  channelId: string,
  ownerId: string,
  ownerName: string,
) {
  const result = db.prepare(
    "INSERT INTO tickets (guild_id, channel_id, owner_id, owner_name, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
  ).run(guildId, channelId, ownerId, ownerName.slice(0, 80), Date.now());
  return getTicketById(guildId, Number(result.lastInsertRowid))!;
}

export function getOpenTicketForOwner(guildId: string, ownerId: string) {
  const row = db
    .prepare(`SELECT ${ticketColumns} FROM tickets WHERE guild_id = ? AND owner_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`)
    .get(guildId, ownerId) as TicketRow | undefined;
  return row ? ticketFromRow(row) : null;
}

export function getTicketByChannel(guildId: string, channelId: string) {
  const row = db
    .prepare(`SELECT ${ticketColumns} FROM tickets WHERE guild_id = ? AND channel_id = ?`)
    .get(guildId, channelId) as TicketRow | undefined;
  return row ? ticketFromRow(row) : null;
}

export function getTicketById(guildId: string, id: number) {
  const row = db
    .prepare(`SELECT ${ticketColumns} FROM tickets WHERE guild_id = ? AND id = ?`)
    .get(guildId, id) as TicketRow | undefined;
  return row ? ticketFromRow(row) : null;
}

export function listTickets(
  guildId: string,
  filters: { status?: TicketStatus; query?: string; limit?: number; before?: number } = {},
) {
  const clauses = ["guild_id = ?"];
  const values: Array<string | number> = [guildId];
  if (filters.status) {
    clauses.push("status = ?");
    values.push(filters.status);
  }
  if (filters.query) {
    clauses.push("(owner_name LIKE ? OR owner_id LIKE ? OR assignee_id LIKE ? OR channel_id LIKE ?)");
    const query = `%${filters.query.slice(0, 80)}%`;
    values.push(query, query, query, query);
  }
  if (filters.before) {
    clauses.push("id < ?");
    values.push(filters.before);
  }
  values.push(Math.min(100, Math.max(1, filters.limit || 50)));
  const rows = db
    .prepare(`SELECT ${ticketColumns} FROM tickets WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`)
    .all(...values) as TicketRow[];
  return rows.map(ticketFromRow);
}

export function assignTicket(guildId: string, id: number, assigneeId: string) {
  const result = db.prepare(
    "UPDATE tickets SET assignee_id = ?, assigned_at = ?, status = 'assigned' WHERE guild_id = ? AND id = ? AND status != 'closed'",
  ).run(assigneeId, Date.now(), guildId, id);
  return result.changes > 0 ? getTicketById(guildId, id) : null;
}

export function closeTicket(
  guildId: string,
  id: number,
  encrypted: { ciphertext: string; nonce: string; tag: string } | null,
  expiresAt: number | null,
) {
  const result = db.prepare(
    "UPDATE tickets SET status = 'closed', closed_at = ?, transcript_ciphertext = ?, transcript_nonce = ?, transcript_tag = ?, transcript_expires_at = ? WHERE guild_id = ? AND id = ? AND status != 'closed'",
  ).run(
    Date.now(),
    encrypted?.ciphertext || null,
    encrypted?.nonce || null,
    encrypted?.tag || null,
    expiresAt,
    guildId,
    id,
  );
  return result.changes > 0 ? getTicketById(guildId, id) : null;
}

export function getEncryptedTranscript(guildId: string, id: number) {
  return db.prepare(
    "SELECT transcript_ciphertext AS ciphertext, transcript_nonce AS nonce, transcript_tag AS tag FROM tickets WHERE guild_id = ? AND id = ? AND transcript_ciphertext IS NOT NULL",
  ).get(guildId, id) as { ciphertext: string; nonce: string; tag: string } | undefined;
}

export function deleteTicketTranscript(guildId: string, id: number) {
  return db.prepare(
    "UPDATE tickets SET transcript_ciphertext = NULL, transcript_nonce = NULL, transcript_tag = NULL, transcript_expires_at = NULL WHERE guild_id = ? AND id = ?",
  ).run(guildId, id).changes > 0;
}

export function purgeExpiredTranscripts(now = Date.now()) {
  return db.prepare(
    "UPDATE tickets SET transcript_ciphertext = NULL, transcript_nonce = NULL, transcript_tag = NULL, transcript_expires_at = NULL WHERE transcript_expires_at IS NOT NULL AND transcript_expires_at <= ?",
  ).run(now).changes;
}

export function deleteGuildOperationalData(guildId: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of [
      "guild_configs",
      "reaction_roles",
      "custom_commands",
      "moderation_cases",
      "audit_events",
      "tickets",
      "ai_daily_usage",
    ])
      db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function databaseHealthy() {
  try {
    return (db.prepare("SELECT 1 AS ok").get() as { ok: number }).ok === 1;
  } catch {
    return false;
  }
}

export function checkpointDatabase() {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
}

export function createConsistentBackup(destination: string) {
  db.prepare("VACUUM INTO ?").run(destination);
}

export function closeDatabase() {
  if (!db.isOpen) return;
  checkpointDatabase();
  db.close();
}

export type SubscriptionPlan = "free" | "standard" | "premium" | "ai";
export type Subscription = {
  plan: SubscriptionPlan;
  status: "active" | "expired";
  startsAt: number;
  expiresAt: number | null;
};
type SubscriptionRow = {
  plan: SubscriptionPlan;
  status: "active";
  starts_at: number;
  expires_at: number | null;
};

function subscriptionFromRow(row: SubscriptionRow): Subscription {
  return {
    plan: row.plan,
    status:
      row.expires_at !== null && row.expires_at <= Date.now()
        ? "expired"
        : "active",
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
  };
}

export function getGuildSubscription(guildId: string): Subscription {
  const row = db
    .prepare(
      "SELECT plan, status, starts_at, expires_at FROM guild_subscriptions WHERE guild_id = ?",
    )
    .get(guildId) as SubscriptionRow | undefined;
  if (row) return subscriptionFromRow(row);

  // Preserve access for installations configured before subscriptions existed.
  if (getSiteSettings().premiumGuildIds.includes(guildId))
    return setGuildSubscription(guildId, "ai", null);
  return setGuildSubscription(guildId, "free", null);
}

export function setGuildSubscription(
  guildId: string,
  plan: SubscriptionPlan,
  expiresAt: number | null,
): Subscription {
  const startsAt = Date.now();
  db.prepare(
    `INSERT INTO guild_subscriptions (guild_id, plan, status, starts_at, expires_at) VALUES (?, ?, 'active', ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET plan = excluded.plan, status = 'active', starts_at = excluded.starts_at, expires_at = excluded.expires_at`,
  ).run(guildId, plan, startsAt, expiresAt);
  return subscriptionFromRow({
    plan,
    status: "active",
    starts_at: startsAt,
    expires_at: expiresAt,
  });
}

export function consumeAiQuota(
  guildId: string,
  category: "commands" | "moderation",
  limit: number,
): boolean {
  if (!Number.isSafeInteger(limit) || limit <= 0) return false;
  const usageDate = new Date().toISOString().slice(0, 10);
  const result = db
    .prepare(
      `INSERT INTO ai_daily_usage (guild_id, usage_date, category, used) VALUES (?, ?, ?, 1)
    ON CONFLICT(guild_id, usage_date, category) DO UPDATE SET used = used + 1 WHERE used < ?`,
    )
    .run(guildId, usageDate, category, limit);
  return result.changes === 1;
}

export type Plan = {
  id: "standard" | "premium" | "ai";
  name: string;
  enabled: boolean;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  accent: "standard" | "premium" | "ai";
};
export type AiProvider =
  | "openai"
  | "openrouter"
  | "gemini"
  | "moonshot"
  | "custom";
export type SiteSettings = {
  maintenanceMode: boolean;
  announcement: string;
  premiumGuildIds: string[];
  aiProvider: AiProvider;
  aiModel: string;
  aiBaseUrl: string;
  plans: Plan[];
};
const defaultSiteSettings: SiteSettings = {
  maintenanceMode: false,
  announcement: "",
  premiumGuildIds: [],
  aiProvider: "openai",
  aiModel: "gpt-4o-mini",
  aiBaseUrl: "",
  plans: [
    {
      id: "standard",
      name: "Standard",
      enabled: true,
      monthlyPrice: 4.17,
      yearlyPrice: 49.99,
      accent: "standard",
      features: [
        "Everything in Free",
        "15 reaction roles",
        "25 custom commands",
        "Join Guard",
        "Basic AutoMod",
        "Boost and role messages",
      ],
    },
    {
      id: "premium",
      name: "Premium",
      enabled: true,
      monthlyPrice: 8.33,
      yearlyPrice: 99.99,
      accent: "premium",
      features: [
        "Everything in Standard",
        "Unlimited reaction roles",
        "Unlimited custom commands",
        "Advanced AutoMod",
        "Moderation case history",
        "Priority support",
      ],
    },
    {
      id: "ai",
      name: "Astra AI",
      enabled: true,
      monthlyPrice: 14.99,
      yearlyPrice: 149.99,
      accent: "ai",
      features: [
        "Everything in Premium",
        "AI ask, summarize, and explain commands",
        "Private ephemeral AI responses",
        "Daily server usage controls",
        "Dynamic provider support",
        "Prompt-injection-aware summaries",
      ],
    },
  ],
};
export function sanitizeSiteSettings(value: unknown): SiteSettings {
  const input =
    typeof value === "object" && value
      ? (value as Record<string, unknown>)
      : {};
  const suppliedPlans = Array.isArray(input.plans) ? input.plans : [];
  const plans = defaultSiteSettings.plans.map((fallback, index) => {
    const plan = suppliedPlans[index];
    const source =
      typeof plan === "object" && plan ? (plan as Record<string, unknown>) : {};
    return {
      id: fallback.id,
      name:
        typeof source.name === "string"
          ? source.name.slice(0, 30)
          : fallback.name,
      enabled:
        typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
      monthlyPrice: Number.isFinite(Number(source.monthlyPrice))
        ? Math.max(0, Number(source.monthlyPrice))
        : fallback.monthlyPrice,
      yearlyPrice: Number.isFinite(Number(source.yearlyPrice))
        ? Math.max(0, Number(source.yearlyPrice))
        : fallback.yearlyPrice,
      accent: fallback.accent,
      features: Array.isArray(source.features)
        ? source.features
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.slice(0, 90))
            .filter(Boolean)
            .slice(0, 12)
        : fallback.features,
    };
  });
  const premiumGuildIds = Array.isArray(input.premiumGuildIds)
    ? input.premiumGuildIds
        .filter(
          (id): id is string =>
            typeof id === "string" && /^\d{17,20}$/.test(id),
        )
        .slice(0, 100)
    : [];
  const providers: AiProvider[] = [
    "openai",
    "openrouter",
    "gemini",
    "moonshot",
    "custom",
  ];
  const aiProvider = providers.includes(input.aiProvider as AiProvider)
    ? (input.aiProvider as AiProvider)
    : defaultSiteSettings.aiProvider;
  const aiModel =
    typeof input.aiModel === "string" && input.aiModel.trim()
      ? input.aiModel.trim().slice(0, 120)
      : defaultSiteSettings.aiModel;
  const aiBaseUrl =
    typeof input.aiBaseUrl === "string" && /^https?:\/\//.test(input.aiBaseUrl)
      ? input.aiBaseUrl.trim().replace(/\/$/, "").slice(0, 300)
      : "";
  return {
    maintenanceMode: input.maintenanceMode === true,
    announcement:
      typeof input.announcement === "string"
        ? input.announcement.slice(0, 300)
        : "",
    premiumGuildIds,
    aiProvider,
    aiModel,
    aiBaseUrl,
    plans,
  };
}
export function getSiteSettings(): SiteSettings {
  const row = db
    .prepare("SELECT value FROM site_settings WHERE key = 'global'")
    .get() as { value: string } | undefined;
  if (!row) return structuredClone(defaultSiteSettings);
  try {
    return sanitizeSiteSettings(JSON.parse(row.value));
  } catch {
    return structuredClone(defaultSiteSettings);
  }
}
export function saveSiteSettings(settings: SiteSettings) {
  db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES ('global', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(JSON.stringify(sanitizeSiteSettings(settings)), Date.now());
}
