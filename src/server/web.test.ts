import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChannelType, Collection } from "discord.js";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("HTTP API, security, and role authorization", () => {
  let app: ReturnType<(typeof import("./web.js"))["createWebServer"]>;
  let database: typeof import("./database.js");
  let discord: typeof import("./bot.js");
  let channelStore: Collection<string, Record<string, unknown>>;
  let roleStore: Collection<string, Record<string, unknown>>;

  const adminId = "111111111111111111";
  const moderatorId = "222222222222222222";
  const adminRoleId = "333333333333333333";
  const moderatorRoleId = "444444444444444444";
  const guildId = "555555555555555555";

  function createLogin(
    token: string,
    userId: string,
    guilds: Array<{
      id: string;
      name: string;
      icon: null;
      permissions: string;
      owner: boolean;
    }>,
  ) {
    database.createSession(token, {
      user: { id: userId, username: `user-${userId.slice(0, 3)}`, avatar: null },
      guilds,
      expiresAt: Date.now() + 60_000,
    });
    return `astra_session=${token}`;
  }

  function oauthGuild(id: string, name = "Test Guild", owner = false) {
    return { id, name, icon: null, permissions: "0", owner };
  }

  beforeAll(async () => {
    process.env.ASTRA_DB_PATH = path.join(
      mkdtempSync(path.join(tmpdir(), "astra-web-")),
      "test.db",
    );
    process.env.METRICS_TOKEN = "test-metrics-token";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.DISCORD_CLIENT_ID = "123456789012345678";
    process.env.DISCORD_CLIENT_SECRET = "test-client-secret";
    process.env.DISCORD_REDIRECT_URI = "http://localhost:3000/api/auth/callback";
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    vi.resetModules();
    database = await import("./database.js");
    discord = await import("./bot.js");
    const { createWebServer } = await import("./web.js");
    app = createWebServer();

    const config = database.getGuildConfig(guildId);
    config.dashboardAdminRoleIds = [adminRoleId];
    config.moderatorRoleIds = [moderatorRoleId];
    database.saveGuildConfig(guildId, config);
    const members = new Map([
      [
        adminId,
        {
          permissions: { has: vi.fn().mockReturnValue(false) },
          roles: { cache: new Map([[adminRoleId, {}]]) },
        },
      ],
      [
        moderatorId,
        {
          permissions: { has: vi.fn().mockReturnValue(false) },
          roles: { cache: new Map([[moderatorRoleId, {}]]) },
        },
      ],
    ]);
    const reactionMessage = {
      id: "121212121212121212",
      react: vi.fn().mockResolvedValue({
        emoji: { id: null, name: "🚀", identifier: "%F0%9F%9A%80" },
      }),
    };
    const textChannel = {
      id: "101010101010101010",
      name: "general",
      type: ChannelType.GuildText,
      isTextBased: () => true,
      isDMBased: () => false,
      messages: {
        fetch: vi.fn((id: string) =>
          Promise.resolve(id === reactionMessage.id ? reactionMessage : null),
        ),
      },
    };
    const category = {
      id: "202020202020202020",
      name: "Support",
      type: ChannelType.GuildCategory,
      isTextBased: () => false,
      isDMBased: () => false,
    };
    channelStore = new Collection([
      [textChannel.id, textChannel],
      [category.id, category],
    ]);
    const role = {
      id: "303030303030303030",
      name: "Member",
      managed: false,
      position: 5,
      hexColor: "#8b5cf6",
    };
    roleStore = new Collection([[role.id, role]]);
    discord.bot.guilds.cache.set(
      guildId,
      {
        id: guildId,
        name: "Test Guild",
        ownerId: "999999999999999999",
        preferredLocale: "en-US",
        memberCount: 42,
        members: { fetch: vi.fn((id: string) => Promise.resolve(members.get(id) || null)) },
        channels: {
          cache: channelStore,
          fetch: vi.fn((id?: string) =>
            Promise.resolve(id ? channelStore.get(id) || null : channelStore),
          ),
        },
        roles: {
          fetch: vi.fn((id?: string) =>
            Promise.resolve(id ? roleStore.get(id) || null : roleStore),
          ),
        },
      } as never,
    );
  });

  afterAll(() => {
    discord.bot.guilds.cache.clear();
    delete process.env.DATA_ENCRYPTION_KEY;
  });

  it("reports liveness/readiness and propagates request IDs", async () => {
    const live = await request(app)
      .get("/health/live")
      .set("X-Request-Id", "test-request")
      .expect(200, { status: "ok" });
    expect(live.headers["x-request-id"]).toBe("test-request");
    const response = await request(app).get("/health/ready").expect(503);
    expect(response.body.checks.database).toBe(true);
    expect(response.body.checks.discord).toBe(false);
  });

  it("protects Prometheus metrics with a bearer token", async () => {
    await request(app).get("/metrics").expect(401);
    const response = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer test-metrics-token")
      .expect(200);
    expect(response.text).toContain("astra_http_requests_total");
  });

  it("returns safe 4xx errors for malformed and oversized JSON", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await request(app)
      .post("/api/auth/logout")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400, { error: "Invalid JSON request body" });
    await request(app)
      .post("/api/auth/logout")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ value: "x".repeat(110_000) }))
      .expect(413, { error: "Request body is too large" });
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  it("creates signed OAuth state and rejects invalid callbacks", async () => {
    const login = await request(app).get("/api/auth/login").expect(302);
    expect(login.headers.location).toContain("https://discord.com/oauth2/authorize");
    expect(login.headers.location).toContain("state=");
    expect(login.headers["set-cookie"]?.[0]).toContain("astra_oauth=");
    expect(login.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    await request(app).get("/api/auth/callback?state=invalid").expect(400);
  });

  it("completes a valid Discord OAuth callback and creates a secure session", async () => {
    const login = await request(app).get("/api/auth/login").expect(302);
    const location = new URL(String(login.headers.location));
    const state = location.searchParams.get("state")!;
    expect(state.split(".")).toHaveLength(3);
    const oauthCookie = String(login.headers["set-cookie"]?.[0]).split(";")[0];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "discord-access" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "919191919191919191", username: "oauth-user", avatar: null }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([oauthGuild(guildId, "Test Guild", true)]), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const callback = await request(app)
      .get(`/api/auth/callback?state=${encodeURIComponent(state)}&code=test-code`)
      .set("Cookie", oauthCookie)
      .expect(302);
    expect(callback.headers.location).toBe("/");
    const sessionCookie = (callback.headers["set-cookie"] as unknown as string[])
      .find((value) => value.includes("astra_session="));
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Strict");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every((call) => {
      const init = call[1] as RequestInit;
      return init.redirect === "error" && init.signal instanceof AbortSignal;
    })).toBe(true);
    vi.unstubAllGlobals();
  });

  it("requires a valid session and prevents API caching", async () => {
    const response = await request(app).get("/api/me").expect(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    const cookie = createLogin("owner-session", adminId, [
      oauthGuild("666666666666666666", "Absent Guild", true),
    ]);
    const me = await request(app).get("/api/me").set("Cookie", cookie).expect(200);
    expect(me.body.guilds[0]).toMatchObject({
      id: "666666666666666666",
      botPresent: false,
      accessLevel: "admin",
    });
  });

  it("separates moderator operations from administrator configuration", async () => {
    const moderatorCookie = createLogin("moderator-session", moderatorId, [oauthGuild(guildId)]);
    const adminCookie = createLogin("admin-session", adminId, [oauthGuild(guildId)]);
    await request(app)
      .get(`/api/guilds/${guildId}/moderation`)
      .set("Cookie", moderatorCookie)
      .expect(200);
    await request(app)
      .put(`/api/guilds/${guildId}/config`)
      .set("Cookie", moderatorCookie)
      .send(database.getGuildConfig(guildId))
      .expect(403);

    const requested = { ...database.getGuildConfig(guildId), locale: "tr" };
    const updated = await request(app)
      .put(`/api/guilds/${guildId}/config`)
      .set("Cookie", adminCookie)
      .send(requested)
      .expect(200);
    expect(updated.body.config.locale).toBe("tr");
  });

  it("returns the complete administrator dashboard payload", async () => {
    const cookie = createLogin("dashboard-session", adminId, [oauthGuild(guildId)]);
    const response = await request(app)
      .get(`/api/guilds/${guildId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(response.body.stats).toEqual({ members: 42, channels: 2, roles: 1 });
    expect(response.body.channels).toContainEqual({
      id: "101010101010101010",
      name: "general",
    });
    expect(response.body.categories).toContainEqual({
      id: "202020202020202020",
      name: "Support",
    });
    expect(response.body.roles[0].name).toBe("Member");
    expect(response.body).toHaveProperty("transcriptEncryptionAvailable", true);
  });

  it("previews and explicitly applies validated setup templates", async () => {
    const cookie = createLogin("setup-session", adminId, [oauthGuild(guildId)]);
    await request(app)
      .post(`/api/guilds/${guildId}/setup/preview`)
      .set("Cookie", cookie)
      .send({ template: "unknown" })
      .expect(400);
    const preview = await request(app)
      .post(`/api/guilds/${guildId}/setup/preview`)
      .set("Cookie", cookie)
      .send({ template: "support" })
      .expect(200);
    expect(preview.body.config.ticketsEnabled).toBe(true);
    await request(app)
      .post(`/api/guilds/${guildId}/setup/apply`)
      .set("Cookie", cookie)
      .send({ template: "support" })
      .expect(400);
    const applied = await request(app)
      .post(`/api/guilds/${guildId}/setup/apply`)
      .set("Cookie", cookie)
      .send({ template: "support", confirm: true })
      .expect(200);
    expect(applied.body.config).toMatchObject({
      setupCompleted: true,
      setupTemplate: "support",
    });
  });

  it("creates, rejects duplicates, and deletes reaction roles", async () => {
    database.setGuildSubscription(guildId, "standard", null);
    const cookie = createLogin("reaction-session", adminId, [oauthGuild(guildId)]);
    const body = {
      channelId: "101010101010101010",
      messageId: "121212121212121212",
      emoji: "🚀",
      roleId: "303030303030303030",
    };
    const created = await request(app)
      .post(`/api/guilds/${guildId}/reaction-roles`)
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
    expect(created.body.reactionRoles[0].emoji).toBe("🚀");
    await request(app)
      .post(`/api/guilds/${guildId}/reaction-roles`)
      .set("Cookie", cookie)
      .send(body)
      .expect(409);
    await request(app)
      .delete(`/api/guilds/${guildId}/reaction-roles/${created.body.reactionRoles[0].id}`)
      .set("Cookie", cookie)
      .expect(204);
  });

  it("sanitizes, updates, limits, and deletes custom commands", async () => {
    const cookie = createLogin("commands-session", adminId, [oauthGuild(guildId)]);
    const created = await request(app)
      .post(`/api/guilds/${guildId}/custom-commands`)
      .set("Cookie", cookie)
      .send({ name: " Hello!! ", response: "Hi {user}" })
      .expect(201);
    expect(created.body.customCommands[0].name).toBe("hello");
    const updated = await request(app)
      .post(`/api/guilds/${guildId}/custom-commands`)
      .set("Cookie", cookie)
      .send({ name: "hello", response: "Updated" })
      .expect(201);
    expect(updated.body.customCommands[0].response).toBe("Updated");
    await request(app)
      .post(`/api/guilds/${guildId}/custom-commands`)
      .set("Cookie", cookie)
      .send({ name: "", response: "missing" })
      .expect(400);
    await request(app)
      .delete(`/api/guilds/${guildId}/custom-commands/${updated.body.customCommands[0].id}`)
      .set("Cookie", cookie)
      .expect(204);
  });

  it("assigns only open tickets to eligible support staff", async () => {
    const cookie = createLogin("ticket-session", moderatorId, [oauthGuild(guildId)]);
    const ticket = database.createTicket(guildId, "ticket-channel", "ticket-owner", "Owner");
    const assigned = await request(app)
      .patch(`/api/guilds/${guildId}/tickets/${ticket.id}`)
      .set("Cookie", cookie)
      .send({ assigneeId: moderatorId })
      .expect(200);
    expect(assigned.body.ticket).toMatchObject({ status: "assigned", assigneeId: moderatorId });
    database.closeTicket(guildId, ticket.id, null, null);
    await request(app)
      .patch(`/api/guilds/${guildId}/tickets/${ticket.id}`)
      .set("Cookie", cookie)
      .send({ assigneeId: moderatorId })
      .expect(404);
  });

  it("downloads and deletes authenticated encrypted transcripts", async () => {
    const cookie = createLogin("transcript-session", moderatorId, [oauthGuild(guildId)]);
    const ticket = database.createTicket(guildId, "transcript-channel", "transcript-owner", "Owner");
    const { encryptTranscript } = await import("./crypto.js");
    const payload = JSON.stringify({ version: 1, messages: [{ content: "private" }] });
    database.closeTicket(
      guildId,
      ticket.id,
      encryptTranscript(payload, `${guildId}:${ticket.id}`),
      Date.now() + 30_000,
    );
    const response = await request(app)
      .get(`/api/guilds/${guildId}/tickets/${ticket.id}/transcript`)
      .set("Cookie", cookie)
      .expect(200);
    expect(response.body.messages[0].content).toBe("private");
    expect(response.headers["content-disposition"]).toContain(`astra-ticket-${ticket.id}.json`);
    expect(response.headers["cache-control"]).toBe("no-store");
    await request(app)
      .delete(`/api/guilds/${guildId}/tickets/${ticket.id}/transcript`)
      .set("Cookie", cookie)
      .expect(204);
    await request(app)
      .get(`/api/guilds/${guildId}/tickets/${ticket.id}/transcript`)
      .set("Cookie", cookie)
      .expect(404);
  });

  it("filters ticket inbox queries and reports close conflicts", async () => {
    const cookie = createLogin("ticket-list-session", moderatorId, [oauthGuild(guildId)]);
    const ticket = database.createTicket(guildId, "query-channel", "query-owner", "Searchable Owner");
    const response = await request(app)
      .get(`/api/guilds/${guildId}/tickets?status=open&q=Searchable&limit=1`)
      .set("Cookie", cookie)
      .expect(200);
    expect(response.body.tickets).toHaveLength(1);
    expect(response.body.tickets[0].id).toBe(ticket.id);
    await request(app)
      .post(`/api/guilds/${guildId}/tickets/999999/close`)
      .set("Cookie", cookie)
      .expect(409);
    database.closeTicket(guildId, ticket.id, null, null);
  });

  it("serves public plan data, billing overview, and a scoped invite URL", async () => {
    const publicSettings = await request(app).get("/api/public/site-settings").expect(200);
    expect(publicSettings.body).not.toHaveProperty("premiumGuildIds");
    expect(publicSettings.body).not.toHaveProperty("aiBaseUrl");
    const cookie = createLogin("billing-session", adminId, [oauthGuild(guildId, "Test Guild", true)]);
    const billing = await request(app)
      .get("/api/billing/overview")
      .set("Cookie", cookie)
      .expect(200);
    expect(billing.body.paymentsEnabled).toBe(false);
    expect(billing.body.guilds[0].id).toBe(guildId);
    const invite = await request(app)
      .get("/api/invite")
      .set("Cookie", cookie)
      .expect(200);
    const inviteUrl = new URL(invite.body.url);
    expect(inviteUrl.hostname).toBe("discord.com");
    expect(inviteUrl.searchParams.get("scope")).toBe("bot applications.commands");
  });

  it("restricts and validates developer settings and subscription assignment", async () => {
    const cookie = createLogin("developer-session", adminId, [oauthGuild(guildId)]);
    await request(app).get("/api/developer/settings").set("Cookie", cookie).expect(403);
    process.env.DEVELOPER_DISCORD_IDS = adminId;
    const settings = await request(app)
      .get("/api/developer/settings")
      .set("Cookie", cookie)
      .expect(200);
    await request(app)
      .put("/api/developer/settings")
      .set("Cookie", cookie)
      .send({ ...settings.body, announcement: "Maintenance soon" })
      .expect(200);
    await request(app)
      .put("/api/developer/settings")
      .set("Cookie", cookie)
      .send({ ...settings.body, aiProvider: "custom", aiBaseUrl: "https://internal.example/v1" })
      .expect(400, { error: "Custom AI endpoint is not allowed" });
    process.env.AI_CUSTOM_ALLOWED_HOSTS = "ai.example";
    await request(app)
      .put("/api/developer/settings")
      .set("Cookie", cookie)
      .send({ ...settings.body, aiProvider: "custom", aiBaseUrl: "https://ai.example/v1" })
      .expect(200);
    delete process.env.AI_CUSTOM_ALLOWED_HOSTS;

    const guilds = await request(app)
      .get("/api/developer/subscriptions")
      .set("Cookie", cookie)
      .expect(200);
    expect(guilds.body.some((guild: { id: string }) => guild.id === guildId)).toBe(true);
    await request(app)
      .put(`/api/developer/subscriptions/${guildId}`)
      .set("Cookie", cookie)
      .send({ plan: "invalid" })
      .expect(400);
    await request(app)
      .put(`/api/developer/subscriptions/${guildId}`)
      .set("Cookie", cookie)
      .send({ plan: "ai", expiresAt: "not-a-date" })
      .expect(400);
    const assigned = await request(app)
      .put(`/api/developer/subscriptions/${guildId}`)
      .set("Cookie", cookie)
      .send({ plan: "ai", expiresAt: null })
      .expect(200);
    expect(assigned.body.subscription.plan).toBe("ai");
    delete process.env.DEVELOPER_DISCORD_IDS;
  });

  it("exports all operational records and owner-confirmed deletion preserves plans", async () => {
    const ownerGuildId = "777777777777777777";
    const ownerId = "888888888888888888";
    discord.bot.guilds.cache.set(
      ownerGuildId,
      {
        id: ownerGuildId,
        name: "Privacy Guild",
        ownerId,
        members: { fetch: vi.fn() },
      } as never,
    );
    const cookie = createLogin("privacy-session", ownerId, [
      oauthGuild(ownerGuildId, "Privacy Guild", true),
    ]);
    database.saveGuildConfig(ownerGuildId, database.getGuildConfig(ownerGuildId));
    database.setGuildSubscription(ownerGuildId, "premium", null);
    for (let index = 0; index < 101; index += 1) {
      const ticket = database.createTicket(
        ownerGuildId,
        `privacy-channel-${index}`,
        `privacy-owner-${index}`,
        `Owner ${index}`,
      );
      database.closeTicket(ownerGuildId, ticket.id, null, null);
      database.addCase(ownerGuildId, `target-${index}`, ownerId, "warn", "reason");
    }
    for (let index = 0; index < 260; index += 1)
      database.addAuditEvent(ownerGuildId, ownerId, "test.audit", {
        metadata: { index },
      });

    const exported = await request(app)
      .get(`/api/guilds/${ownerGuildId}/privacy/export`)
      .set("Cookie", cookie)
      .expect(200);
    expect(exported.body.tickets).toHaveLength(101);
    expect(exported.body.cases).toHaveLength(101);
    expect(exported.body.auditEvents).toHaveLength(261);
    expect(exported.body.auditEvents[0].action).toBe("privacy.export");

    await request(app)
      .post(`/api/guilds/${ownerGuildId}/privacy/delete`)
      .set("Cookie", cookie)
      .send({ confirmation: "wrong" })
      .expect(400);
    await request(app)
      .post(`/api/guilds/${ownerGuildId}/privacy/delete`)
      .set("Cookie", cookie)
      .send({ confirmation: "Privacy Guild" })
      .expect(204);
    expect(database.hasGuildConfig(ownerGuildId)).toBe(false);
    expect(database.listTickets(ownerGuildId)).toEqual([]);
    expect(database.getGuildSubscription(ownerGuildId).plan).toBe("premium");
  });

  it("invalidates sessions on logout", async () => {
    const cookie = createLogin("logout-session", adminId, [oauthGuild(guildId)]);
    await request(app).post("/api/auth/logout").set("Cookie", cookie).expect(204);
    await request(app).get("/api/me").set("Cookie", cookie).expect(401);
  });
});
