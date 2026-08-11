import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChannelType, Collection, Events, PermissionFlagsBits } from "discord.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

describe("Discord command and ticket integration", () => {
  let database: typeof import("./database.js");
  let discord: typeof import("./bot.js");

  beforeAll(async () => {
    process.env.ASTRA_DB_PATH = path.join(
      mkdtempSync(path.join(tmpdir(), "astra-bot-")),
      "test.db",
    );
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
    vi.resetModules();
    database = await import("./database.js");
    discord = await import("./bot.js");
  });

  afterEach(() => vi.useRealTimers());
  afterAll(() => {
    discord.bot.guilds.cache.clear();
    delete process.env.DATA_ENCRYPTION_KEY;
  });

  it("publishes the complete command contract", () => {
    const names = discord.commandDefinitions.map((command) => command.name);
    expect(discord.bot.options.allowedMentions).toEqual({
      parse: [],
      repliedUser: false,
    });
    expect(names).toEqual([
      "help",
      "ping",
      "server",
      "user",
      "kick",
      "warn",
      "ban",
      "timeout",
      "purge",
      "lock",
      "unlock",
      "ai",
      "ticket",
      "User information",
    ]);
    const ai = discord.commandDefinitions.find((command) => command.name === "ai");
    const ticket = discord.commandDefinitions.find((command) => command.name === "ticket");
    expect(ai?.options?.map((option) => option.name)).toEqual(["ask", "summarize", "explain"]);
    expect(ticket?.options?.map((option) => option.name)).toEqual(["panel", "close", "claim"]);
  });

  it("archives, encrypts, and later deletes a dashboard-closed ticket channel", async () => {
    vi.useFakeTimers();
    const guildId = "123456789012345678";
    const channelId = "223456789012345678";
    const attachments = new Collection([
      ["attachment", { name: "proof.txt", url: "https://cdn.example/proof", size: 12 }],
    ]);
    const messages = new Collection([
      [
        "message",
        {
          id: "message",
          author: { id: "owner", username: "Owner" },
          createdTimestamp: 1234,
          content: "Need help",
          attachments,
        },
      ],
    ]);
    const removeChannel = vi.fn().mockResolvedValue(undefined);
    const channel = {
      id: channelId,
      type: ChannelType.GuildText,
      topic: "astra-ticket:owner",
      messages: { fetch: vi.fn().mockResolvedValue(messages) },
      delete: removeChannel,
    };
    const guild = {
      id: guildId,
      channels: { fetch: vi.fn().mockResolvedValue(channel) },
    };
    discord.bot.guilds.cache.set(guildId, guild as never);
    database.saveGuildConfig(
      guildId,
      database.getGuildConfig(guildId),
    );
    const ticket = database.createTicket(guildId, channelId, "owner", "Owner");

    const archived = await discord.archiveTicketFromDashboard(guildId, ticket.id, "staff");
    expect(archived?.status).toBe("closed");
    expect(archived?.hasTranscript).toBe(true);
    const encrypted = database.getEncryptedTranscript(guildId, ticket.id);
    expect(encrypted?.ciphertext).not.toContain("Need help");
    const { decryptTranscript } = await import("./crypto.js");
    expect(decryptTranscript(encrypted!, `${guildId}:${ticket.id}`)).toContain("Need help");
    expect(removeChannel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(removeChannel).toHaveBeenCalledOnce();
  });

  it("keeps the ticket and channel open when transcript encryption is unavailable", async () => {
    vi.useFakeTimers();
    const guildId = "323456789012345678";
    const channelId = "423456789012345678";
    const removeChannel = vi.fn();
    const channel = {
      id: channelId,
      type: ChannelType.GuildText,
      topic: "astra-ticket:owner-two",
      messages: { fetch: vi.fn() },
      delete: removeChannel,
    };
    discord.bot.guilds.cache.set(
      guildId,
      { id: guildId, channels: { fetch: vi.fn().mockResolvedValue(channel) } } as never,
    );
    database.saveGuildConfig(guildId, database.getGuildConfig(guildId));
    const ticket = database.createTicket(guildId, channelId, "owner-two", "Owner Two");
    delete process.env.DATA_ENCRYPTION_KEY;
    await expect(discord.archiveTicketFromDashboard(guildId, ticket.id, "staff"))
      .rejects.toThrow("Transcript encryption is unavailable");
    expect(database.getTicketById(guildId, ticket.id)?.status).toBe("open");
    expect(removeChannel).not.toHaveBeenCalled();
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
  });

  it("runs custom commands and deterministic AutoMod through message events", async () => {
    const customGuildId = "523456789012345678";
    const customConfig = database.getGuildConfig(customGuildId);
    customConfig.customCommandsEnabled = true;
    database.saveGuildConfig(customGuildId, customConfig);
    database.saveCustomCommand(customGuildId, "hello", "Hello {username} in {server}");
    const customSend = vi.fn().mockResolvedValue(undefined);
    const member = {
      id: "member",
      guild: { id: customGuildId, ownerId: "owner" },
      permissions: { has: vi.fn().mockReturnValue(false) },
      roles: { cache: new Map() },
    };
    const messageListener = discord.bot.listeners(Events.MessageCreate)[0] as (
      message: unknown,
    ) => Promise<void>;
    await messageListener({
      guild: { id: customGuildId, name: "Orbit", memberCount: 7 },
      author: { id: "member", username: "AstraUser", bot: false },
      member,
      content: "!hello",
      channel: { send: customSend },
    });
    expect(customSend).toHaveBeenCalledWith("Hello AstraUser in Orbit");

    const automodGuildId = "623456789012345678";
    const automodConfig = database.getGuildConfig(automodGuildId);
    automodConfig.automodEnabled = true;
    automodConfig.blockInvites = true;
    database.saveGuildConfig(automodGuildId, automodConfig);
    const warningDelete = vi.fn().mockResolvedValue(undefined);
    const warningSend = vi.fn().mockResolvedValue({ delete: warningDelete });
    const deleted = vi.fn().mockResolvedValue(undefined);
    const automodGuild = {
      id: automodGuildId,
      name: "Protected",
      ownerId: "owner",
      memberCount: 2,
    };
    await messageListener({
      guild: automodGuild,
      author: { id: "spammer", username: "Spammer", bot: false },
      member: {
        id: "spammer",
        guild: automodGuild,
        permissions: { has: vi.fn().mockReturnValue(false) },
        roles: { cache: new Map() },
      },
      content: "join discord.gg/spam",
      mentions: { users: new Map(), roles: new Map() },
      delete: deleted,
      channel: { id: "general", send: warningSend },
    });
    expect(deleted).toHaveBeenCalledOnce();
    expect(database.listCases(automodGuildId)[0]).toMatchObject({
      action: "automod_invitesBlocked",
      target_id: "spammer",
    });
  });

  it("contains Discord message and client errors instead of rejecting event handlers", async () => {
    const guildId = "633456789012345679";
    const config = database.getGuildConfig(guildId);
    config.customCommandsEnabled = true;
    database.saveGuildConfig(guildId, config);
    database.saveCustomCommand(guildId, "explode", "Safe response");
    const messageListener = discord.bot.listeners(Events.MessageCreate)[0] as (
      message: unknown,
    ) => Promise<void>;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(messageListener({
      guild: { id: guildId, name: "Containment", memberCount: 1 },
      author: { id: "member", username: "Member", bot: false },
      member: {
        id: "member",
        guild: { id: guildId, ownerId: "owner" },
        permissions: { has: vi.fn().mockReturnValue(false) },
        roles: { cache: new Map() },
      },
      content: "!explode",
      channel: { send: vi.fn().mockRejectedValue(new Error("Discord unavailable")) },
    })).resolves.toBeUndefined();
    expect(discord.bot.listenerCount(Events.Error)).toBeGreaterThan(0);
    expect(() => discord.bot.emit(Events.Error, new Error("Gateway failure"))).not.toThrow();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("adds and removes Unicode reaction roles through Discord events", async () => {
    const guildId = "723456789012345678";
    database.addReactionRole({
      guildId,
      channelId: "channel",
      messageId: "message",
      emoji: "🚀",
      roleId: "role",
    });
    const add = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const guild = {
      id: guildId,
      members: {
        fetch: vi.fn().mockResolvedValue({ roles: { add, remove } }),
      },
    };
    const reaction = {
      partial: false,
      message: { id: "message", guild },
      emoji: { id: null, name: "🚀", identifier: "%F0%9F%9A%80" },
    };
    const user = { id: "user", bot: false };
    const addListener = discord.bot.listeners(Events.MessageReactionAdd)[0] as (
      reaction: unknown,
      user: unknown,
    ) => Promise<void>;
    const removeListener = discord.bot.listeners(Events.MessageReactionRemove)[0] as (
      reaction: unknown,
      user: unknown,
    ) => Promise<void>;
    await addListener(reaction, user);
    await removeListener(reaction, user);
    expect(add).toHaveBeenCalledWith("role", "Astra reaction role");
    expect(remove).toHaveBeenCalledWith("role", "Astra reaction role removed");
  });

  it("handles member welcome, auto-role, goodbye, and Join Guard events", async () => {
    const guildId = "823456789012345678";
    const send = vi.fn().mockResolvedValue(undefined);
    const guild = {
      id: guildId,
      name: "Members Guild",
      ownerId: "owner",
      memberCount: 11,
      roles: {
        cache: new Map([
          [
            "member-role",
            {
              id: "member-role",
              managed: false,
              position: 1,
              permissions: { bitfield: 0n },
            },
          ],
        ]),
        fetch: vi.fn(),
      },
      members: {
        me: { roles: { highest: { position: 10 } } },
        fetchMe: vi.fn(),
      },
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          isDMBased: () => false,
          send,
        }),
      },
    };
    const config = database.getGuildConfig(guildId);
    config.welcomeEnabled = true;
    config.welcomeChannelId = "welcome";
    config.goodbyeEnabled = true;
    config.goodbyeChannelId = "goodbye";
    config.autoRoleEnabled = true;
    config.autoRoleId = "member-role";
    database.saveGuildConfig(guildId, config);
    const roleAdd = vi.fn().mockResolvedValue(undefined);
    const member = {
      id: "new-user",
      guild,
      user: {
        username: "NewUser",
        tag: "NewUser#0001",
        createdTimestamp: 0,
        displayAvatarURL: () => "https://cdn.example/avatar",
      },
      roles: { add: roleAdd },
      send: vi.fn(),
      kick: vi.fn(),
      toString: () => "<@new-user>",
    };
    const addListener = discord.bot.listeners(Events.GuildMemberAdd)[0] as (
      member: unknown,
    ) => Promise<void>;
    const removeListener = discord.bot.listeners(Events.GuildMemberRemove)[0] as (
      member: unknown,
    ) => Promise<void>;
    await addListener(member);
    await removeListener(member);
    expect(roleAdd).toHaveBeenCalledWith("member-role", "Astra auto-role");
    expect(send).toHaveBeenCalledTimes(2);

    const guardedGuildId = "923456789012345678";
    database.setGuildSubscription(guardedGuildId, "standard", null);
    const guardedConfig = database.getGuildConfig(guardedGuildId);
    guardedConfig.joinGuardEnabled = true;
    guardedConfig.minimumAccountAgeDays = 7;
    database.saveGuildConfig(guardedGuildId, guardedConfig);
    const directMessage = vi.fn().mockResolvedValue(undefined);
    const kick = vi.fn().mockResolvedValue(undefined);
    await addListener({
      id: "fresh-user",
      guild: {
        id: guardedGuildId,
        name: "Guarded",
        memberCount: 2,
        channels: { fetch: vi.fn() },
      },
      user: {
        tag: "Fresh#0001",
        createdTimestamp: Date.now(),
      },
      send: directMessage,
      kick,
      roles: { add: vi.fn() },
    });
    expect(directMessage).toHaveBeenCalledOnce();
    expect(kick).toHaveBeenCalledWith("Astra Join Guard: account too new");
  });

  it("refuses a privileged auto-role even if stale configuration reaches runtime", async () => {
    const guildId = "933456789012345679";
    const roleId = "933456789012345680";
    const config = database.getGuildConfig(guildId);
    config.autoRoleEnabled = true;
    config.autoRoleId = roleId;
    database.saveGuildConfig(guildId, config);
    const roleAdd = vi.fn().mockResolvedValue(undefined);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const listener = discord.bot.listeners(Events.GuildMemberAdd)[0] as (
      member: unknown,
    ) => Promise<void>;
    await listener({
      id: "new-user",
      guild: {
        id: guildId,
        name: "Privileged Auto Role",
        memberCount: 1,
        roles: {
          cache: new Map([[roleId, {
            id: roleId,
            managed: false,
            position: 1,
            permissions: { bitfield: PermissionFlagsBits.Administrator },
          }]]),
        },
        members: { me: { roles: { highest: { position: 10 } } } },
        channels: { fetch: vi.fn() },
      },
      user: { username: "New", tag: "New#0001", createdTimestamp: 0 },
      roles: { add: roleAdd },
      send: vi.fn(),
      kick: vi.fn(),
      toString: () => "<@new-user>",
    });
    expect(roleAdd).not.toHaveBeenCalled();
    expect(warnings).toHaveBeenCalled();
    warnings.mockRestore();
  });

  it("does not let stale @everyone ticket staff close another user's ticket", async () => {
    const guildId = "943456789012345679";
    const channelId = "943456789012345680";
    database.setGuildSubscription(guildId, "standard", null);
    const config = database.getGuildConfig(guildId);
    config.ticketsEnabled = true;
    config.ticketStaffRoleId = guildId;
    database.saveGuildConfig(guildId, config);
    const ticket = database.createTicket(guildId, channelId, "owner", "Owner");
    const guild = {
      id: guildId,
      ownerId: "server-owner",
      members: {
        fetch: vi.fn().mockResolvedValue({
          id: "ordinary",
          guild: { id: guildId, ownerId: "server-owner" },
          permissions: { has: vi.fn().mockReturnValue(false) },
          roles: { cache: new Map([[guildId, { id: guildId }]]) },
        }),
      },
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    await discord.handleTicketButton({
      isButton: () => true,
      customId: "astra_ticket_close",
      guild,
      channel: {
        id: channelId,
        type: ChannelType.GuildText,
        topic: "astra-ticket:owner",
      },
      user: { id: "ordinary", username: "Ordinary", tag: "Ordinary#0001" },
      memberPermissions: { has: vi.fn().mockReturnValue(false) },
      reply,
    } as never);
    expect(database.getTicketById(guildId, ticket.id)?.status).toBe("open");
    const response = reply.mock.calls[0]?.[0] as { content: string };
    expect(response.content).toContain("permission");
  });

  it("executes help, AI plan denial, warning, and permission checks", async () => {
    const guildId = "133456789012345678";
    const moderatorId = "moderator";
    const target = {
      id: "target",
      username: "Target",
      send: vi.fn().mockResolvedValue(undefined),
    };
    const moderator = {
      id: moderatorId,
      guild: { id: guildId, ownerId: "owner" },
      permissions: { has: vi.fn().mockReturnValue(true) },
      roles: { cache: new Map(), highest: { position: 10 } },
    };
    const targetMember = {
      id: "target",
      moderatable: true,
      roles: { highest: { position: 1 } },
    };
    const guild = {
      id: guildId,
      name: "Commands",
      ownerId: "owner",
      members: {
        fetch: vi.fn((id: string) =>
          Promise.resolve(id === moderatorId ? moderator : targetMember),
        ),
      },
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => true,
      guild,
      user: { id: moderatorId, username: "Moderator" },
      commandName: "help",
      reply,
      options: {
        getUser: () => target,
        getString: () => "Be kind",
        getInteger: () => 1,
      },
    };
    await discord.handleCommand(interaction as never);
    expect(reply).toHaveBeenCalledOnce();
    interaction.commandName = "ai";
    await discord.handleCommand(interaction as never);
    expect(reply).toHaveBeenCalledTimes(2);
    interaction.commandName = "warn";
    await discord.handleCommand(interaction as never);
    expect(database.listCases(guildId)[0]).toMatchObject({ action: "warn" });
    expect(target.send).toHaveBeenCalledOnce();

    moderator.permissions.has.mockReturnValue(false);
    interaction.commandName = "kick";
    await discord.handleCommand(interaction as never);
    const lastReply = reply.mock.calls.at(-1)?.[0] as { content: string };
    expect(lastReply.content).toContain("permission");
  });

  it("opens and lets a configured moderator close a ticket button flow", async () => {
    vi.useFakeTimers();
    const guildId = "233456789012345678";
    const moderatorId = "333456789012345678";
    const userId = "433456789012345678";
    database.setGuildSubscription(guildId, "standard", null);
    const config = database.getGuildConfig(guildId);
    config.ticketsEnabled = true;
    config.ticketRetentionDays = 0;
    config.moderatorRoleIds = ["533456789012345678"];
    database.saveGuildConfig(guildId, config);
    const channelSend = vi.fn().mockResolvedValue(undefined);
    const channelDelete = vi.fn().mockResolvedValue(undefined);
    const ticketChannel = {
      id: "633456789012345678",
      type: ChannelType.GuildText,
      topic: `astra-ticket:${userId}`,
      send: channelSend,
      delete: channelDelete,
    };
    const create = vi.fn().mockResolvedValue(ticketChannel);
    const guild = {
      id: guildId,
      name: "Tickets",
      ownerId: "owner",
      channels: { cache: new Map(), create },
      roles: { everyone: { id: guildId } },
      members: {
        fetch: vi.fn().mockResolvedValue({
          id: moderatorId,
          guild: { id: guildId, ownerId: "owner" },
          permissions: { has: vi.fn().mockReturnValue(false) },
          roles: { cache: new Map([["533456789012345678", {}]]) },
        }),
      },
    };
    const openReply = vi.fn().mockResolvedValue(undefined);
    await discord.handleTicketButton({
      isButton: () => true,
      customId: "astra_ticket_open",
      guild,
      user: { id: userId, username: "Ticket User", tag: "TicketUser#0001" },
      reply: openReply,
    } as never);
    const ticket = database.getOpenTicketForOwner(guildId, userId);
    expect(ticket?.channelId).toBe(ticketChannel.id);
    expect(create).toHaveBeenCalledOnce();
    expect(channelSend).toHaveBeenCalledOnce();

    const closeReply = vi.fn().mockResolvedValue(undefined);
    await discord.handleTicketButton({
      isButton: () => true,
      customId: "astra_ticket_close",
      guild,
      user: { id: moderatorId, username: "Moderator", tag: "Moderator#0001" },
      channel: ticketChannel,
      memberPermissions: { has: vi.fn().mockReturnValue(false) },
      reply: closeReply,
    } as never);
    expect(database.getTicketById(guildId, ticket!.id)?.status).toBe("closed");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(channelDelete).toHaveBeenCalledOnce();
  });

  it("executes an allowed AI ask command without exposing the response publicly", async () => {
    const guildId = "733456789012345678";
    database.setGuildSubscription(guildId, "ai", null);
    process.env.OPENAI_API_KEY = "test-openai-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Private answer" } }] }),
          { status: 200 },
        ),
      ),
    );
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    await discord.handleAiCommand({
      guild: { id: guildId },
      channel: null,
      options: {
        getSubcommand: () => "ask",
        getString: () => "What is Astra?",
      },
      reply: vi.fn(),
      deferReply,
      editReply,
    } as never);
    expect(deferReply).toHaveBeenCalledWith(expect.objectContaining({ flags: expect.anything() }));
    expect(editReply).toHaveBeenCalledWith("Private answer");
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("sends configured boost and role-change event messages", async () => {
    const guildId = "833456789012345678";
    database.setGuildSubscription(guildId, "standard", null);
    const config = database.getGuildConfig(guildId);
    config.boostEnabled = true;
    config.boostChannelId = "events";
    config.roleMessageEnabled = true;
    config.roleMessageChannelId = "events";
    database.saveGuildConfig(guildId, config);
    const send = vi.fn().mockResolvedValue(undefined);
    const guild = {
      id: guildId,
      name: "Events",
      memberCount: 5,
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          isDMBased: () => false,
          send,
        }),
      },
    };
    const beforeRoles = new Collection([[guildId, { id: guildId, name: "@everyone" }]]);
    const afterRoles = new Collection([
      [guildId, { id: guildId, name: "@everyone" }],
      ["new-role", { id: "new-role", name: "VIP" }],
    ]);
    const before = { guild, premiumSinceTimestamp: null, roles: { cache: beforeRoles } };
    const after = {
      id: "member",
      guild,
      premiumSinceTimestamp: Date.now(),
      roles: { cache: afterRoles },
      user: { username: "Member" },
    };
    const listener = discord.bot.listeners(Events.GuildMemberUpdate)[0] as (
      before: unknown,
      after: unknown,
    ) => Promise<void>;
    await listener(before, after);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects kick, ban, and timeout when the target matches or outranks the invoker", async () => {
    const guildId = "143456789012345678";
    const invoker = {
      id: "junior",
      guild: { id: guildId, ownerId: "owner" },
      permissions: { has: vi.fn().mockReturnValue(true) },
      roles: { cache: new Map(), highest: { position: 5 } },
    };
    const target = { id: "senior", username: "Senior", send: vi.fn().mockResolvedValue(undefined) };
    const targetMember = {
      id: "senior",
      moderatable: true,
      kick: vi.fn().mockResolvedValue(undefined),
      ban: vi.fn().mockResolvedValue(undefined),
      timeout: vi.fn().mockResolvedValue(undefined),
      roles: { highest: { position: 5 } },
    };
    const guild = {
      id: guildId,
      name: "Hierarchy",
      ownerId: "owner",
      members: {
        fetch: vi.fn((id: string) =>
          Promise.resolve(id === "junior" ? invoker : targetMember),
        ),
      },
    };
    const run = async (commandName: string) => {
      const reply = vi.fn().mockResolvedValue(undefined);
      await discord.handleCommand({
        isChatInputCommand: () => true,
        guild,
        user: { id: "junior", username: "Junior" },
        commandName,
        reply,
        options: {
          getUser: () => target,
          getString: () => null,
          getInteger: () => 5,
        },
      } as never);
      return reply;
    };
    for (const commandName of ["kick", "ban", "timeout"]) {
      const reply = await run(commandName);
      expect(reply).toHaveBeenCalledOnce();
      const lastReply = reply.mock.calls.at(-1)?.[0] as { content: string };
      expect(lastReply.content).toContain("permission");
    }
    expect(targetMember.kick).not.toHaveBeenCalled();
    expect(targetMember.ban).not.toHaveBeenCalled();
    expect(targetMember.timeout).not.toHaveBeenCalled();

    targetMember.roles.highest.position = 1;
    const reply = await run("kick");
    const lastReply = reply.mock.calls.at(-1)?.[0] as { content: string };
    expect(lastReply.content).toContain("Action completed");
    expect(targetMember.kick).toHaveBeenCalledOnce();
  });

  it("does not treat ManageMessages alone as sufficient for ban", async () => {
    const guildId = "153456789012345678";
    const invoker = {
      id: "mod",
      guild: { id: guildId, ownerId: "owner" },
      permissions: {
        has: vi.fn((bit: bigint) => bit === PermissionFlagsBits.ManageMessages),
      },
      roles: { cache: new Map(), highest: { position: 5 } },
    };
    const target = { id: "target", username: "Target", send: vi.fn().mockResolvedValue(undefined) };
    const targetMember = {
      id: "target",
      moderatable: true,
      ban: vi.fn().mockResolvedValue(undefined),
      roles: { highest: { position: 1 } },
    };
    const guild = {
      id: guildId,
      name: "Permissions",
      ownerId: "owner",
      members: {
        fetch: vi.fn((id: string) =>
          Promise.resolve(id === "mod" ? invoker : targetMember),
        ),
      },
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => true,
      guild,
      user: { id: "mod", username: "Mod" },
      commandName: "ban",
      reply,
      options: {
        getUser: () => target,
        getString: () => null,
        getInteger: () => 5,
      },
    };
    await discord.handleCommand(interaction as never);
    const lastReply = reply.mock.calls.at(-1)?.[0] as { content: string };
    expect(lastReply.content).toContain("permission");
    expect(targetMember.ban).not.toHaveBeenCalled();

    interaction.commandName = "warn";
    await discord.handleCommand(interaction as never);
    expect(database.listCases(guildId)[0]).toMatchObject({ action: "warn" });
  });

  it("rejects moderation actions against the server owner", async () => {
    const guildId = "163456789012345678";
    const invoker = {
      id: "admin",
      guild: { id: guildId, ownerId: "owner" },
      permissions: { has: vi.fn().mockReturnValue(true) },
      roles: { cache: new Map(), highest: { position: 10 } },
    };
    const target = { id: "owner", username: "Owner", send: vi.fn() };
    const targetMember = {
      id: "owner",
      moderatable: true,
      kick: vi.fn(),
      ban: vi.fn(),
      timeout: vi.fn(),
      roles: { highest: { position: 1 } },
    };
    const guild = {
      id: guildId,
      name: "Owner Guard",
      ownerId: "owner",
      members: {
        fetch: vi.fn((id: string) =>
          Promise.resolve(id === "admin" ? invoker : targetMember),
        ),
      },
    };
    for (const commandName of ["warn", "kick", "ban", "timeout"]) {
      const reply = vi.fn().mockResolvedValue(undefined);
      await discord.handleCommand({
        isChatInputCommand: () => true,
        guild,
        user: { id: "admin", username: "Admin" },
        commandName,
        reply,
        options: {
          getUser: () => target,
          getString: () => "Reason",
          getInteger: () => 5,
        },
      } as never);
      expect(reply).toHaveBeenCalledOnce();
      const lastReply = reply.mock.calls.at(-1)?.[0] as { content: string };
      expect(lastReply.content).toContain("permission");
    }
    expect(targetMember.kick).not.toHaveBeenCalled();
    expect(targetMember.ban).not.toHaveBeenCalled();
    expect(targetMember.timeout).not.toHaveBeenCalled();
  });

  it("declares default member permissions on destructive moderation commands", () => {
    const expected: Record<string, bigint> = {
      kick: PermissionFlagsBits.KickMembers,
      ban: PermissionFlagsBits.BanMembers,
      timeout: PermissionFlagsBits.ModerateMembers,
    };
    for (const [name, permission] of Object.entries(expected)) {
      const command = discord.commandDefinitions.find((item) => item.name === name);
      expect(command?.default_member_permissions).toBe(String(permission));
    }
  });
});
