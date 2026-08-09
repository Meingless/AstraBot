import type { GuildConfig } from "./config.js";
import { getGuildSubscription, type SubscriptionPlan } from "./database.js";

export type Capabilities = {
  welcomeGoodbye: boolean;
  autoRole: boolean;
  basicAutomod: boolean;
  logs: boolean;
  moderationCommands: boolean;
  reactionRoles: boolean;
  customCommands: boolean;
  joinGuard: boolean;
  eventMessages: boolean;
  advancedAutomod: boolean;
  aiCommands: boolean;
  tickets: boolean;
};

export type PlanLimits = {
  reactionRoles: number | null;
  customCommands: number | null;
  moderationCases: number;
  aiCommandsPerDay: number;
};

const rank: Record<SubscriptionPlan, number> = {
  free: 0,
  standard: 1,
  premium: 2,
  ai: 3,
};

export function getPlanAccess(guildId: string) {
  const subscription = getGuildSubscription(guildId);
  const plan: SubscriptionPlan =
    subscription.status === "active" ? subscription.plan : "free";
  const atLeast = (required: SubscriptionPlan) => rank[plan] >= rank[required];
  const capabilities: Capabilities = {
    welcomeGoodbye: true,
    autoRole: true,
    basicAutomod: true,
    logs: true,
    moderationCommands: true,
    reactionRoles: true,
    customCommands: true,
    joinGuard: atLeast("standard"),
    eventMessages: atLeast("standard"),
    advancedAutomod: atLeast("premium"),
    aiCommands: atLeast("ai"),
    tickets: atLeast("standard"),
  };
  const limits: PlanLimits = {
    reactionRoles: atLeast("premium") ? null : atLeast("standard") ? 15 : 1,
    customCommands: atLeast("premium") ? null : atLeast("standard") ? 25 : 3,
    moderationCases: atLeast("standard") ? 100 : 10,
    aiCommandsPerDay: capabilities.aiCommands ? 100 : 0,
  };
  return { subscription, effectivePlan: plan, capabilities, limits };
}

const customCommandFields: Array<keyof GuildConfig> = [
  "customCommandsEnabled",
  "prefix",
];
const joinGuardFields: Array<keyof GuildConfig> = [
  "joinGuardEnabled",
  "minimumAccountAgeDays",
];
const eventMessageFields: Array<keyof GuildConfig> = [
  "boostEnabled",
  "boostChannelId",
  "boostMessage",
  "roleMessageEnabled",
  "roleMessageChannelId",
  "roleMessage",
];
const premiumFields: Array<keyof GuildConfig> = [
  "bannedWords",
  "maxCapsPercent",
  "regexEnabled",
  "regexRules",
];
const ticketFields: Array<keyof GuildConfig> = [
  "ticketsEnabled",
  "ticketCategoryId",
  "ticketStaffRoleId",
  "ticketRetentionDays",
];

export function preserveLockedConfig(
  existing: GuildConfig,
  requested: GuildConfig,
  capabilities: Capabilities,
): GuildConfig {
  const merged = { ...requested };
  const preserve = (fields: Array<keyof GuildConfig>) => {
    for (const field of fields)
      Object.assign(merged, { [field]: existing[field] });
  };
  if (!capabilities.customCommands) preserve(customCommandFields);
  if (!capabilities.joinGuard) preserve(joinGuardFields);
  if (!capabilities.eventMessages) preserve(eventMessageFields);
  if (!capabilities.advancedAutomod) preserve(premiumFields);
  if (!capabilities.tickets) preserve(ticketFields);
  return merged;
}
