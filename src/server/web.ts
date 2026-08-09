import { randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { archiveTicketFromDashboard, bot } from "./bot.js";
import { assertAiConnectionAllowed } from "./ai.js";
import { defaultConfig, sanitizeConfig, type SetupTemplate } from "./config.js";
import {
  addAuditEvent,
  addReactionRole,
  assignTicket,
  createSession,
  databaseHealthy,
  deleteCustomCommand,
  deleteGuildOperationalData,
  deleteReactionRole,
  deleteSession,
  deleteTicketTranscript,
  getEncryptedTranscript,
  getGuildConfig,
  getGuildSubscription,
  getSession,
  getSiteSettings,
  getTicketById,
  hasGuildConfig,
  listAuditEvents,
  listAllAuditEvents,
  listAllCases,
  listCases,
  listCustomCommands,
  listReactionRoles,
  listTickets,
  saveCustomCommand,
  saveGuildConfig,
  sanitizeSiteSettings,
  saveSiteSettings,
  setGuildSubscription,
  type DiscordGuild,
  type Session,
  type SubscriptionPlan,
} from "./database.js";
import { decryptTranscript, encryptionAvailable } from "./crypto.js";
import { emojiKey, normalizeEmoji } from "./discord/emoji.js";
import { metricsText, requestTelemetry, log as structuredLog } from "./observability.js";
import { getPlanAccess, preserveLockedConfig } from "./plans.js";
import { previewTemplate } from "./templates.js";

type AccessLevel = "moderator" | "admin";
type AuthedRequest = Request & { session?: Session; accessLevel?: AccessLevel };
const manageable = BigInt(PermissionFlagsBits.ManageGuild);

function rateLimit(windowMs: number, maximum: number) {
  const clients = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = clients.get(key);
    if (!current && clients.size >= 5_000) {
      for (const [client, value] of clients)
        if (value.resetAt <= now) clients.delete(client);
      if (clients.size >= 5_000) {
        res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
        return res
          .status(429)
          .json({ error: "Too many request sources; try again later" });
      }
    }
    const state = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;
    state.count += 1;
    clients.set(key, state);
    res.setHeader("RateLimit-Limit", String(maximum));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, maximum - state.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(state.resetAt / 1000)));
    if (state.count > maximum) {
      res.setHeader("Retry-After", String(Math.ceil((state.resetAt - now) / 1000)));
      return res.status(429).json({ error: "Too many requests; try again later" });
    }
    next();
  };
}

function allowedOrigin() {
  if (process.env.APP_DOMAIN) return `https://${process.env.APP_DOMAIN}`;
  try {
    return new URL(process.env.DISCORD_REDIRECT_URI || "").origin;
  } catch {
    return "";
  }
}

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function signature(value: string) {
  return createHmac("sha256", env("SESSION_SECRET"))
    .update(value)
    .digest("hex");
}
function safeEqual(expectedValue: string, givenValue: string | undefined) {
  const expected = Buffer.from(expectedValue);
  const actual = Buffer.from(givenValue || "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function validSignature(value: string, given: string) {
  return safeEqual(signature(value), given);
}
function canManage(guild: DiscordGuild) {
  return guild.owner || (BigInt(guild.permissions) & manageable) === manageable;
}
function isDeveloper(req: AuthedRequest) {
  return (process.env.DEVELOPER_DISCORD_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .includes(req.session?.user.id || "");
}

function isGuildOwner(req: AuthedRequest) {
  const guildId = String(req.params.guildId);
  const oauthGuild = req.session?.guilds.find((item) => item.id === guildId);
  const guild = bot.guilds.cache.get(guildId);
  return Boolean(
    oauthGuild?.owner && (!guild || guild.ownerId === req.session?.user.id),
  );
}

function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies.astra_session as string | undefined;
  const session = token && getSession(token);
  if (!session)
    return res.status(401).json({ error: "Authentication required" });
  req.session = session;
  next();
}

async function resolveGuildAccess(
  req: AuthedRequest,
  guildId = String(req.params.guildId),
): Promise<AccessLevel | null> {
  const oauthGuild = req.session?.guilds.find((item) => item.id === guildId);
  if (!oauthGuild) return null;
  const guild = bot.guilds.cache.get(guildId);
  if (!guild) return canManage(oauthGuild) ? "admin" : null;
  const userId = req.session!.user.id;
  if (guild.ownerId === userId) return "admin";
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return null;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return "admin";
  const config = getGuildConfig(guildId);
  if (config.dashboardAdminRoleIds.some((id) => member.roles.cache.has(id)))
    return "admin";
  if (
    config.moderatorRoleIds.some((id) => member.roles.cache.has(id)) ||
    (config.ticketStaffRoleId && member.roles.cache.has(config.ticketStaffRoleId))
  )
    return "moderator";
  return null;
}

async function guildAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const access = await resolveGuildAccess(req);
  if (access !== "admin")
    return res.status(403).json({ error: "Administrator access required" });
  const guild = bot.guilds.cache.get(String(req.params.guildId));
  if (!guild) {
    if (req.method === "GET") return next();
    return res.status(404).json({ error: "Bot is not in this server" });
  }
  req.accessLevel = access;
  next();
}

async function moderatorAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const access = await resolveGuildAccess(req);
  if (!access)
    return res.status(403).json({ error: "Moderator access required" });
  if (!bot.guilds.cache.has(String(req.params.guildId)))
    return res.status(404).json({ error: "Bot is not in this server" });
  req.accessLevel = access;
  next();
}

export function createWebServer() {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(requestTelemetry);
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === "production"
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: [
                  "'self'",
                  "data:",
                  "https://cdn.discordapp.com",
                ],
                connectSrc: ["'self'"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
              },
            }
          : false,
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use("/api/auth", rateLimit(10 * 60_000, 60));
  app.use("/api", rateLimit(60_000, 300));
  app.use("/api", (req, res, next) => {
    if (process.env.NODE_ENV !== "production" ||
        !["POST", "PUT", "PATCH", "DELETE"].includes(req.method))
      return next();
    const origin = req.header("origin");
    if (origin === allowedOrigin()) return next();
    return res.status(403).json({ error: "Request origin is not allowed" });
  });

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", (_req, res) => {
    const checks = {
      database: databaseHealthy(),
      discord: bot.isReady(),
      encryption:
        process.env.NODE_ENV !== "production" || encryptionAvailable(),
    };
    const ready = Object.values(checks).every(Boolean);
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", checks });
  });
  app.get("/metrics", (req, res) => {
    const token = process.env.METRICS_TOKEN;
    const supplied = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token || !safeEqual(token, supplied))
      return res.status(401).json({ error: "Metrics authentication required" });
    res.type("text/plain; version=0.0.4").send(metricsText());
  });

  app.get("/api/auth/login", (_req, res) => {
    const nonce = randomBytes(18).toString("hex");
    const issuedAt = Date.now().toString();
    const payload = `${issuedAt}.${nonce}`;
    const state = `${payload}.${signature(payload)}`;
    res.cookie("astra_oauth", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60_000,
    });
    const query = new URLSearchParams({
      client_id: env("DISCORD_CLIENT_ID"),
      redirect_uri: env("DISCORD_REDIRECT_URI"),
      response_type: "code",
      scope: "identify guilds",
      state,
    });
    res.redirect(`https://discord.com/oauth2/authorize?${query}`);
  });

  app.get("/api/auth/callback", async (req, res) => {
    const state = String(req.query.state || "");
    const parts = state.split(".");
    const [issuedAt, nonce, given] = parts;
    const issuedAtMs = Number(issuedAt);
    const age = Date.now() - issuedAtMs;
    const code = String(req.query.code || "");
    if (
      parts.length !== 3 ||
      !nonce ||
      !given ||
      !Number.isSafeInteger(issuedAtMs) ||
      age < -60_000 ||
      age > 10 * 60_000 ||
      !code ||
      code.length > 512 ||
      req.cookies.astra_oauth !== state ||
      !validSignature(`${issuedAt}.${nonce}`, given)
    )
      return res.status(400).send("Invalid OAuth state.");
    res.clearCookie("astra_oauth", { path: "/" });
    try {
      const body = new URLSearchParams({
        client_id: env("DISCORD_CLIENT_ID"),
        client_secret: env("DISCORD_CLIENT_SECRET"),
        grant_type: "authorization_code",
        code,
        redirect_uri: env("DISCORD_REDIRECT_URI"),
      });
      const tokenResponse = await fetch(
        "https://discord.com/api/oauth2/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
          body,
        },
      );
      if (!tokenResponse.ok) throw new Error("Discord token exchange failed");
      const token = (await tokenResponse.json()) as { access_token: string };
      if (typeof token.access_token !== "string" || !token.access_token)
        throw new Error("Discord token response was invalid");
      const headers = { Authorization: `Bearer ${token.access_token}` };
      const requestOptions = {
        headers,
        signal: AbortSignal.timeout(10_000),
        redirect: "error" as const,
      };
      const [userResponse, guildResponse] = await Promise.all([
        fetch("https://discord.com/api/users/@me", requestOptions),
        fetch("https://discord.com/api/users/@me/guilds", requestOptions),
      ]);
      if (!userResponse.ok || !guildResponse.ok)
        throw new Error("Discord profile request failed");
      const user = (await userResponse.json()) as Session["user"];
      const guilds = (await guildResponse.json()) as DiscordGuild[];
      const sessionToken = randomBytes(32).toString("hex");
      createSession(sessionToken, {
        user,
        guilds,
        expiresAt: Date.now() + 7 * 24 * 60 * 60_000,
      });
      res.cookie("astra_session", sessionToken, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60_000,
        path: "/",
      });
      res.redirect("/");
    } catch (error) {
      console.error(error);
      res.status(502).send("Discord authentication failed. Please try again.");
    }
  });

  app.post("/api/auth/logout", auth, (req: AuthedRequest, res) => {
    const token = req.cookies.astra_session as string;
    deleteSession(token);
    res.clearCookie("astra_session", { path: "/" });
    res.status(204).end();
  });

  app.get("/api/me", auth, async (req: AuthedRequest, res) => {
    const guilds = (
      await Promise.all(
        req.session!.guilds.map(async (guild) => {
          const accessLevel = await resolveGuildAccess(req, guild.id);
          return accessLevel
            ? {
                ...guild,
                botPresent: bot.guilds.cache.has(guild.id),
                accessLevel,
              }
            : null;
        }),
      )
    ).filter(Boolean);
    res.json({ user: req.session!.user, guilds });
  });
  app.get("/api/billing/overview", auth, (req: AuthedRequest, res) => {
    const settings = getSiteSettings();
    const guilds = req.session!.guilds
      .filter(canManage)
      .filter(guild => bot.guilds.cache.has(guild.id))
      .map(guild => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        subscription: getGuildSubscription(guild.id),
      }));
    res.json({ guilds, plans: settings.plans.filter(plan => plan.enabled), paymentsEnabled: false });
  });
  app.get("/api/public/site-settings", (_req, res) => {
    const settings = getSiteSettings();
    res.json({
      maintenanceMode: settings.maintenanceMode,
      announcement: settings.announcement,
      plans: settings.plans,
    });
  });
  app.get("/api/developer/settings", auth, (req: AuthedRequest, res) => {
    if (!isDeveloper(req))
      return res.status(403).json({ error: "Developer access required" });
    res.json(getSiteSettings());
  });
  app.put("/api/developer/settings", auth, (req: AuthedRequest, res) => {
    if (!isDeveloper(req))
      return res.status(403).json({ error: "Developer access required" });
    const settings = sanitizeSiteSettings(req.body);
    try {
      assertAiConnectionAllowed({
        provider: settings.aiProvider,
        model: settings.aiModel,
        baseUrl: settings.aiBaseUrl,
      });
    } catch {
      return res.status(400).json({ error: "Custom AI endpoint is not allowed" });
    }
    saveSiteSettings(settings);
    structuredLog("warn", "developer_settings_updated", {
      actorId: req.session!.user.id,
    });
    res.json(getSiteSettings());
  });
  app.get("/api/developer/subscriptions", auth, (req: AuthedRequest, res) => {
    if (!isDeveloper(req))
      return res.status(403).json({ error: "Developer access required" });
    res.json(
      bot.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        subscription: getGuildSubscription(guild.id),
      })),
    );
  });
  app.put(
    "/api/developer/subscriptions/:guildId",
    auth,
    (req: AuthedRequest, res) => {
      if (!isDeveloper(req))
        return res.status(403).json({ error: "Developer access required" });
      const guildId = String(req.params.guildId);
      if (!/^\d{17,20}$/.test(guildId) || !bot.guilds.cache.has(guildId))
        return res.status(404).json({ error: "Bot guild not found" });
      const plans: SubscriptionPlan[] = ["free", "standard", "premium", "ai"];
      const plan = req.body?.plan as SubscriptionPlan;
      if (!plans.includes(plan))
        return res
          .status(400)
          .json({ error: "Plan must be free, standard, premium, or ai" });
      const suppliedExpiry = req.body?.expiresAt;
      let expiresAt: number | null = null;
      if (
        suppliedExpiry !== null &&
        suppliedExpiry !== undefined &&
        suppliedExpiry !== ""
      ) {
        expiresAt =
          typeof suppliedExpiry === "number"
            ? suppliedExpiry
            : Date.parse(String(suppliedExpiry));
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
          return res
            .status(400)
            .json({
              error: "expiresAt must be null, a timestamp, or a valid date",
            });
      }
      const subscription = setGuildSubscription(guildId, plan, expiresAt);
      addAuditEvent(guildId, req.session!.user.id, "subscription.assign", {
        metadata: { plan, expiresAt },
      });
      res.json({
        guildId,
        subscription,
      });
    },
  );

  app.get("/api/guilds/:guildId", auth, guildAuth, async (req, res) => {
    const guild = bot.guilds.cache.get(String(req.params.guildId));
    if (!guild)
      return res
        .status(404)
        .json({ error: "Invite Astra before configuring this server" });
    if (!hasGuildConfig(guild.id))
      {
        const turkish = guild.preferredLocale.toLowerCase().startsWith("tr");
        saveGuildConfig(
          guild.id,
          sanitizeConfig({
            ...defaultConfig,
            locale: turkish ? "tr" : "en",
            ...(turkish
              ? {
                  welcomeMessage: "{user}, **{server}** sunucusuna hoş geldin! Sen #{count}. üyesin.",
                  goodbyeMessage: "**{username}**, {server} sunucusundan ayrıldı.",
                  boostMessage: "**{server}** sunucusuna boost bastığın için teşekkürler {user}!",
                  roleMessage: "{user}, **{role}** rolünü aldı.",
                }
              : {}),
          }),
        );
      }
    const [channels, roles] = await Promise.all([
      guild.channels.fetch(),
      guild.roles.fetch(),
    ]);
    const access = getPlanAccess(guild.id);
    res.json({
      config: getGuildConfig(guild.id),
      subscription: access.subscription,
      capabilities: access.capabilities,
      limits: access.limits,
      premium: access.capabilities.aiCommands,
      stats: {
        members: guild.memberCount,
        channels: channels.size,
        roles: roles.size,
      },
      channels: channels
        .filter((channel) => channel?.isTextBased() && !channel.isDMBased())
        .map((channel) => ({ id: channel!.id, name: channel!.name })),
      categories: channels
        .filter((channel) => channel?.type === ChannelType.GuildCategory)
        .map((channel) => ({ id: channel!.id, name: channel!.name })),
      roles: roles
        .filter((role) => role.id !== guild.id && !role.managed)
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
          id: role.id,
          name: role.name,
          color: role.hexColor,
        })),
      reactionRoles: listReactionRoles(guild.id),
      customCommands: listCustomCommands(guild.id),
      cases: listCases(guild.id).slice(0, access.limits.moderationCases),
      auditEvents: listAuditEvents(guild.id, access.limits.moderationCases),
      tickets: listTickets(guild.id, { limit: 50 }),
      transcriptEncryptionAvailable: encryptionAvailable(),
    });
  });

  app.put("/api/guilds/:guildId/config", auth, guildAuth, (req: AuthedRequest, res) => {
    const guildId = String(req.params.guildId);
    if (!bot.guilds.cache.has(guildId))
      return res.status(404).json({ error: "Bot is not in this server" });
    const existing = getGuildConfig(guildId);
    const config = preserveLockedConfig(
      existing,
      sanitizeConfig(req.body),
      getPlanAccess(guildId).capabilities,
    );
    saveGuildConfig(guildId, config);
    const changedFields = Object.keys(config).filter(
      (key) =>
        JSON.stringify(existing[key as keyof typeof existing]) !==
        JSON.stringify(config[key as keyof typeof config]),
    );
    addAuditEvent(guildId, req.session!.user.id, "config.update", {
      metadata: { changedFields },
    });
    res.json({ config });
  });

  app.post(
    "/api/guilds/:guildId/reaction-roles",
    auth,
    guildAuth,
    async (req: AuthedRequest, res) => {
      const guild = bot.guilds.cache.get(String(req.params.guildId));
      if (!guild)
        return res.status(404).json({ error: "Bot is not in this server" });
      const { capabilities, limits } = getPlanAccess(guild.id);
      if (!capabilities.reactionRoles)
        return res
          .status(403)
          .json({ error: "Reaction roles are not available on this plan" });
      const currentRules = listReactionRoles(guild.id);
      if (
        limits.reactionRoles !== null &&
        currentRules.length >= limits.reactionRoles
      )
        return res
          .status(409)
          .json({
            error: `This plan allows ${limits.reactionRoles} reaction role${limits.reactionRoles === 1 ? "" : "s"}`,
            limit: limits.reactionRoles,
          });
      const { channelId, messageId, emoji, roleId } = req.body as Record<
        string,
        unknown
      >;
      if (
        ![channelId, messageId, emoji, roleId].every(
          (value) =>
            typeof value === "string" && value.length > 0 && value.length < 100,
        )
      )
        return res
          .status(400)
          .json({ error: "Channel, message, emoji, and role are required" });
      const channel = await guild.channels
        .fetch(channelId as string)
        .catch(() => null);
      const role = await guild.roles.fetch(roleId as string).catch(() => null);
      if (
        !channel?.isTextBased() ||
        channel.isDMBased() ||
        !role ||
        role.managed
      )
        return res
          .status(400)
          .json({ error: "Choose a valid text channel and assignable role" });
      const message = await channel.messages
        .fetch(messageId as string)
        .catch(() => null);
      if (!message)
        return res
          .status(404)
          .json({ error: "Message not found in that channel" });
      const createdReaction = await message.react(emoji as string).catch(() => null);
      if (!createdReaction)
        return res.status(400).json({ error: "Astra could not add that emoji" });
      const normalizedEmoji = emojiKey(createdReaction.emoji);
      const latestRules = listReactionRoles(guild.id);
      if (
        latestRules.some(
          (rule) =>
            rule.messageId === message.id &&
            normalizeEmoji(rule.emoji) === normalizedEmoji,
        )
      )
        return res
          .status(409)
          .json({
            error: "That message and emoji already have a reaction role",
          });
      if (
        limits.reactionRoles !== null &&
        latestRules.length >= limits.reactionRoles
      )
        return res
          .status(409)
          .json({
            error: `This plan allows ${limits.reactionRoles} reaction role${limits.reactionRoles === 1 ? "" : "s"}`,
            limit: limits.reactionRoles,
          });
      addReactionRole({
        guildId: guild.id,
        channelId: channel.id,
        messageId: message.id,
        emoji: normalizedEmoji,
        roleId: role.id,
      });
      addAuditEvent(guild.id, req.session!.user.id, "reaction_role.create", {
        channelId: channel.id,
        targetId: role.id,
        metadata: { messageId: message.id, emoji: normalizedEmoji },
      });
      res.status(201).json({ reactionRoles: listReactionRoles(guild.id) });
    },
  );
  app.delete(
    "/api/guilds/:guildId/reaction-roles/:id",
    auth,
    guildAuth,
    (req: AuthedRequest, res) => {
      const guildId = String(req.params.guildId);
      deleteReactionRole(guildId, Number(req.params.id));
      addAuditEvent(guildId, req.session!.user.id, "reaction_role.delete", {
        metadata: { id: Number(req.params.id) },
      });
      res.status(204).end();
    },
  );
  app.post(
    "/api/guilds/:guildId/custom-commands",
    auth,
    guildAuth,
    (req: AuthedRequest, res) => {
      const guildId = String(req.params.guildId);
      const { capabilities, limits } = getPlanAccess(guildId);
      if (!capabilities.customCommands)
        return res
          .status(403)
          .json({ error: "Custom commands are not available on this plan" });
      const name =
        typeof req.body.name === "string"
          ? req.body.name
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_-]/g, "")
              .slice(0, 32)
          : "";
      const response =
        typeof req.body.response === "string"
          ? req.body.response.trim().slice(0, 2000)
          : "";
      if (!name || !response)
        return res
          .status(400)
          .json({ error: "A command name and response are required" });
      const commands = listCustomCommands(guildId);
      if (
        !commands.some((command) => command.name === name) &&
        limits.customCommands !== null &&
        commands.length >= limits.customCommands
      )
        return res
          .status(409)
          .json({
            error: `This plan allows ${limits.customCommands} custom commands`,
            limit: limits.customCommands,
          });
      saveCustomCommand(guildId, name, response);
      addAuditEvent(guildId, req.session!.user.id, "custom_command.save", {
        metadata: { name },
      });
      res.status(201).json({ customCommands: listCustomCommands(guildId) });
    },
  );
  app.delete(
    "/api/guilds/:guildId/custom-commands/:id",
    auth,
    guildAuth,
    (req: AuthedRequest, res) => {
      const guildId = String(req.params.guildId);
      deleteCustomCommand(guildId, Number(req.params.id));
      addAuditEvent(guildId, req.session!.user.id, "custom_command.delete", {
        metadata: { id: Number(req.params.id) },
      });
      res.status(204).end();
    },
  );

  app.post(
    "/api/guilds/:guildId/setup/preview",
    auth,
    guildAuth,
    (req: AuthedRequest, res) => {
      const templates: SetupTemplate[] = ["gaming", "creator", "support", "empty"];
      const template = req.body?.template as SetupTemplate;
      if (!templates.includes(template))
        return res.status(400).json({ error: "Unknown setup template" });
      res.json({ config: previewTemplate(getGuildConfig(String(req.params.guildId)), template) });
    },
  );
  app.post(
    "/api/guilds/:guildId/setup/apply",
    auth,
    guildAuth,
    (req: AuthedRequest, res) => {
      const templates: SetupTemplate[] = ["gaming", "creator", "support", "empty"];
      const template = req.body?.template as SetupTemplate;
      if (!templates.includes(template) || req.body?.confirm !== true)
        return res.status(400).json({ error: "Template and explicit confirmation are required" });
      const guildId = String(req.params.guildId);
      const config = previewTemplate(getGuildConfig(guildId), template);
      saveGuildConfig(guildId, config);
      addAuditEvent(guildId, req.session!.user.id, "setup.apply", {
        metadata: { template },
      });
      res.json({ config });
    },
  );

  app.get(
    "/api/guilds/:guildId/moderation",
    auth,
    moderatorAuth,
    (req, res) => {
      const guildId = String(req.params.guildId);
      const limit = getPlanAccess(guildId).limits.moderationCases;
      res.json({
        cases: listCases(guildId).slice(0, limit),
        auditEvents: listAuditEvents(guildId, limit),
      });
    },
  );

  app.get(
    "/api/guilds/:guildId/tickets",
    auth,
    moderatorAuth,
    (req, res) => {
      const statuses = ["open", "assigned", "closed"] as const;
      const suppliedStatus = String(req.query.status || "");
      const status = statuses.includes(suppliedStatus as (typeof statuses)[number])
        ? (suppliedStatus as (typeof statuses)[number])
        : undefined;
      res.json({
        tickets: listTickets(String(req.params.guildId), {
          status,
          query: typeof req.query.q === "string" ? req.query.q : undefined,
          before: Number(req.query.before) || undefined,
          limit: Number(req.query.limit) || 50,
        }),
      });
    },
  );
  app.patch(
    "/api/guilds/:guildId/tickets/:id",
    auth,
    moderatorAuth,
    async (req: AuthedRequest, res) => {
      const guildId = String(req.params.guildId);
      const id = Number(req.params.id);
      const assigneeId = String(req.body?.assigneeId || req.session!.user.id);
      if (!/^\d{17,20}$/.test(assigneeId))
        return res.status(400).json({ error: "A valid assignee is required" });
      const guild = bot.guilds.cache.get(guildId)!;
      const member = await guild.members.fetch(assigneeId).catch(() => null);
      const config = getGuildConfig(guildId);
      const eligible = Boolean(
        member &&
          (member.permissions.has(PermissionFlagsBits.ManageGuild) ||
            config.dashboardAdminRoleIds.some((role) => member.roles.cache.has(role)) ||
            config.moderatorRoleIds.some((role) => member.roles.cache.has(role)) ||
            (config.ticketStaffRoleId && member.roles.cache.has(config.ticketStaffRoleId))),
      );
      if (!eligible) return res.status(400).json({ error: "Assignee is not support staff" });
      const ticket = assignTicket(guildId, id, assigneeId);
      if (!ticket) return res.status(404).json({ error: "Open ticket not found" });
      addAuditEvent(guildId, req.session!.user.id, "ticket.assign", {
        targetId: ticket.ownerId,
        channelId: ticket.channelId,
        metadata: { ticketId: id, assigneeId },
      });
      res.json({ ticket });
    },
  );
  app.post(
    "/api/guilds/:guildId/tickets/:id/close",
    auth,
    moderatorAuth,
    async (req: AuthedRequest, res) => {
      try {
        const ticket = await archiveTicketFromDashboard(
          String(req.params.guildId),
          Number(req.params.id),
          req.session!.user.id,
        );
        res.json({ ticket });
      } catch (error) {
        res.status(409).json({
          error: error instanceof Error ? error.message : "Ticket could not be closed",
        });
      }
    },
  );
  app.get(
    "/api/guilds/:guildId/tickets/:id/transcript",
    auth,
    moderatorAuth,
    (req: AuthedRequest, res) => {
      const guildId = String(req.params.guildId);
      const id = Number(req.params.id);
      const ticket = getTicketById(guildId, id);
      const encrypted = getEncryptedTranscript(guildId, id);
      if (!ticket || !encrypted)
        return res.status(404).json({ error: "Transcript not found" });
      try {
        const transcript = decryptTranscript(encrypted, `${guildId}:${id}`);
        addAuditEvent(guildId, req.session!.user.id, "ticket.transcript.read", {
          targetId: ticket.ownerId,
          channelId: ticket.channelId,
          metadata: { ticketId: id },
        });
        res.setHeader("Content-Disposition", `attachment; filename="astra-ticket-${id}.json"`);
        res.type("application/json").send(transcript);
      } catch {
        res.status(503).json({ error: "Transcript decryption is unavailable" });
      }
    },
  );
  app.delete(
    "/api/guilds/:guildId/tickets/:id/transcript",
    auth,
    moderatorAuth,
    (req: AuthedRequest, res) => {
      const guildId = String(req.params.guildId);
      const id = Number(req.params.id);
      const ticket = getTicketById(guildId, id);
      if (!ticket || !deleteTicketTranscript(guildId, id))
        return res.status(404).json({ error: "Ticket not found" });
      addAuditEvent(guildId, req.session!.user.id, "ticket.transcript.delete", {
        targetId: ticket.ownerId,
        channelId: ticket.channelId,
        metadata: { ticketId: id },
      });
      res.status(204).end();
    },
  );

  app.get(
    "/api/guilds/:guildId/privacy/export",
    auth,
    guildAuth,
    (req: AuthedRequest, res) => {
      const guildId = String(req.params.guildId);
      const allTickets = [];
      let before: number | undefined;
      for (;;) {
        const page = listTickets(guildId, { limit: 100, before });
        allTickets.push(...page);
        if (page.length < 100) break;
        before = page.at(-1)?.id;
      }
      const tickets = allTickets.map((ticket) => {
        const encrypted = getEncryptedTranscript(guildId, ticket.id);
        let transcript: unknown = null;
        if (encrypted)
          try {
            transcript = JSON.parse(
              decryptTranscript(encrypted, `${guildId}:${ticket.id}`),
            ) as unknown;
          } catch {
            transcript = { unavailable: true };
          }
        return { ...ticket, transcript };
      });
      addAuditEvent(guildId, req.session!.user.id, "privacy.export");
      res.setHeader("Content-Disposition", `attachment; filename="astra-guild-${guildId}.json"`);
      res.json({
        exportedAt: Date.now(),
        guildId,
        config: getGuildConfig(guildId),
        reactionRoles: listReactionRoles(guildId),
        customCommands: listCustomCommands(guildId),
        cases: listAllCases(guildId),
        auditEvents: listAllAuditEvents(guildId),
        tickets,
      });
    },
  );
  app.post(
    "/api/guilds/:guildId/privacy/delete",
    auth,
    guildAuth,
    (req: AuthedRequest, res) => {
      const guildId = String(req.params.guildId);
      const guild = bot.guilds.cache.get(guildId);
      if (!guild || !isGuildOwner(req))
        return res.status(403).json({ error: "Only the server owner can delete guild data" });
      if (req.body?.confirmation !== guild.name)
        return res.status(400).json({ error: "Enter the exact server name to confirm deletion" });
      deleteGuildOperationalData(guildId);
      structuredLog("warn", "guild_data_deleted", {
        guildId,
        actorId: req.session!.user.id,
      });
      res.status(204).end();
    },
  );

  app.get("/api/invite", auth, (_req, res) => {
    const permissions =
      PermissionFlagsBits.ViewChannel |
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.EmbedLinks |
      PermissionFlagsBits.ManageMessages |
      PermissionFlagsBits.KickMembers |
      PermissionFlagsBits.BanMembers |
      PermissionFlagsBits.ModerateMembers |
      PermissionFlagsBits.ManageRoles |
      PermissionFlagsBits.ManageChannels |
      PermissionFlagsBits.ReadMessageHistory;
    const query = new URLSearchParams({
      client_id: env("DISCORD_CLIENT_ID"),
      scope: "bot applications.commands",
      permissions: permissions.toString(),
    });
    res.json({ url: `https://discord.com/oauth2/authorize?${query}` });
  });

  const dashboard = path.resolve("dist/dashboard");
  if (existsSync(dashboard)) {
    app.use(express.static(dashboard, { maxAge: "1d", index: false }));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(dashboard, "index.html")),
    );
  }
  app.use(
    (error: unknown, _req: Request, res: Response, next: NextFunction) => {
      void next;
      console.error(error);
      const candidate = error as { status?: unknown; statusCode?: unknown };
      const suppliedStatus = Number(candidate?.status || candidate?.statusCode);
      const status = Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus < 500
        ? suppliedStatus
        : 500;
      const message =
        status === 400
          ? "Invalid JSON request body"
          : status === 413
            ? "Request body is too large"
            : "Unexpected server error";
      res.status(status).json({ error: message });
    },
  );
  return app;
}
