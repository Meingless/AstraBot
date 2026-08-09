import { isSafePattern } from "redos-detector";

export type Locale = "tr" | "en";
export type SetupTemplate = "gaming" | "creator" | "support" | "empty";
export type TicketRetentionDays = 0 | 30 | 90;

export type GuildConfig = {
  locale: Locale;
  setupCompleted: boolean;
  setupTemplate: SetupTemplate;
  dashboardAdminRoleIds: string[];
  moderatorRoleIds: string[];
  welcomeEnabled: boolean;
  welcomeChannelId: string;
  welcomeMessage: string;
  welcomeColor: string;
  goodbyeEnabled: boolean;
  goodbyeChannelId: string;
  goodbyeMessage: string;
  autoRoleEnabled: boolean;
  autoRoleId: string;
  logsEnabled: boolean;
  logsChannelId: string;
  automodEnabled: boolean;
  blockInvites: boolean;
  blockLinks: boolean;
  maxCapsPercent: number;
  bannedWords: string[];
  spamEnabled: boolean;
  spamMessageLimit: number;
  spamWindowSeconds: number;
  duplicateEnabled: boolean;
  duplicateMessageLimit: number;
  duplicateWindowSeconds: number;
  mentionSpamEnabled: boolean;
  mentionLimit: number;
  regexEnabled: boolean;
  regexRules: string[];
  prefix: string;
  customCommandsEnabled: boolean;
  joinGuardEnabled: boolean;
  minimumAccountAgeDays: number;
  boostEnabled: boolean;
  boostChannelId: string;
  boostMessage: string;
  roleMessageEnabled: boolean;
  roleMessageChannelId: string;
  roleMessage: string;
  notifyUsers: boolean;
  ticketsEnabled: boolean;
  ticketCategoryId: string;
  ticketStaffRoleId: string;
  ticketRetentionDays: TicketRetentionDays;
};

export const defaultConfig: GuildConfig = {
  locale: "en",
  setupCompleted: false,
  setupTemplate: "empty",
  dashboardAdminRoleIds: [],
  moderatorRoleIds: [],
  welcomeEnabled: false,
  welcomeChannelId: "",
  welcomeMessage: "Welcome {user} to **{server}**! You are member #{count}.",
  welcomeColor: "#8b5cf6",
  goodbyeEnabled: false,
  goodbyeChannelId: "",
  goodbyeMessage: "**{username}** has left {server}.",
  autoRoleEnabled: false,
  autoRoleId: "",
  logsEnabled: false,
  logsChannelId: "",
  automodEnabled: false,
  blockInvites: true,
  blockLinks: false,
  maxCapsPercent: 80,
  bannedWords: [],
  spamEnabled: false,
  spamMessageLimit: 6,
  spamWindowSeconds: 10,
  duplicateEnabled: false,
  duplicateMessageLimit: 3,
  duplicateWindowSeconds: 30,
  mentionSpamEnabled: false,
  mentionLimit: 5,
  regexEnabled: false,
  regexRules: [],
  prefix: "!",
  customCommandsEnabled: true,
  joinGuardEnabled: false,
  minimumAccountAgeDays: 7,
  boostEnabled: false,
  boostChannelId: "",
  boostMessage: "Thank you {user} for boosting **{server}**!",
  roleMessageEnabled: false,
  roleMessageChannelId: "",
  roleMessage: "{user} received the **{role}** role.",
  notifyUsers: true,
  ticketsEnabled: false,
  ticketCategoryId: "",
  ticketStaffRoleId: "",
  ticketRetentionDays: 30,
};

function safeInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.round(parsed)))
    : fallback;
}

function snowflakes(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string =>
          typeof item === "string" && /^\d{17,20}$/.test(item),
        )
        .filter((item, index, values) => values.indexOf(item) === index)
        .slice(0, 20)
    : [];
}

export function isSafeRegex(pattern: string) {
  if (!pattern || pattern.length > 80) return false;
  if (/\\[1-9]|\(\?[=!<]|\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return false;
  try {
    void new RegExp(pattern, "i");
    return isSafePattern(`^(?:${pattern})$`, {
      caseInsensitive: true,
      maxScore: 100,
      maxSteps: 10_000,
      timeout: 25,
    }).safe;
  } catch {
    return false;
  }
}

export function sanitizeConfig(value: unknown): GuildConfig {
  const input =
    typeof value === "object" && value
      ? (value as Record<string, unknown>)
      : {};
  const bool = (key: keyof GuildConfig) =>
    typeof input[key] === "boolean"
      ? (input[key] as boolean)
      : (defaultConfig[key] as boolean);
  const text = (key: keyof GuildConfig, max = 2000) =>
    typeof input[key] === "string"
      ? (input[key] as string).slice(0, max)
      : (defaultConfig[key] as string);
  const locale: Locale = input.locale === "tr" ? "tr" : "en";
  const templates: SetupTemplate[] = ["gaming", "creator", "support", "empty"];
  const setupTemplate = templates.includes(input.setupTemplate as SetupTemplate)
    ? (input.setupTemplate as SetupTemplate)
    : "empty";
  const retention: TicketRetentionDays = [0, 30, 90].includes(
    Number(input.ticketRetentionDays),
  )
    ? (Number(input.ticketRetentionDays) as TicketRetentionDays)
    : 30;
  const maxCaps = Number(input.maxCapsPercent);
  return {
    locale,
    setupCompleted: bool("setupCompleted"),
    setupTemplate,
    dashboardAdminRoleIds: snowflakes(input.dashboardAdminRoleIds),
    moderatorRoleIds: snowflakes(input.moderatorRoleIds),
    welcomeEnabled: bool("welcomeEnabled"),
    welcomeChannelId: text("welcomeChannelId", 30),
    welcomeMessage: text("welcomeMessage"),
    welcomeColor: /^#[0-9a-f]{6}$/i.test(text("welcomeColor", 7))
      ? text("welcomeColor", 7)
      : defaultConfig.welcomeColor,
    goodbyeEnabled: bool("goodbyeEnabled"),
    goodbyeChannelId: text("goodbyeChannelId", 30),
    goodbyeMessage: text("goodbyeMessage"),
    autoRoleEnabled: bool("autoRoleEnabled"),
    autoRoleId: text("autoRoleId", 30),
    logsEnabled: bool("logsEnabled"),
    logsChannelId: text("logsChannelId", 30),
    automodEnabled: bool("automodEnabled"),
    blockInvites: bool("blockInvites"),
    blockLinks: bool("blockLinks"),
    maxCapsPercent: Number.isFinite(maxCaps)
      ? Math.min(100, Math.max(0, Math.round(maxCaps)))
      : defaultConfig.maxCapsPercent,
    bannedWords: Array.isArray(input.bannedWords)
      ? input.bannedWords
          .filter((word): word is string => typeof word === "string")
          .map((word) => word.trim().toLowerCase().slice(0, 50))
          .filter(Boolean)
          .slice(0, 100)
      : [],
    spamEnabled: bool("spamEnabled"),
    spamMessageLimit: safeInteger(input.spamMessageLimit, 6, 3, 20),
    spamWindowSeconds: safeInteger(input.spamWindowSeconds, 10, 3, 60),
    duplicateEnabled: bool("duplicateEnabled"),
    duplicateMessageLimit: safeInteger(input.duplicateMessageLimit, 3, 2, 10),
    duplicateWindowSeconds: safeInteger(input.duplicateWindowSeconds, 30, 5, 120),
    mentionSpamEnabled: bool("mentionSpamEnabled"),
    mentionLimit: safeInteger(input.mentionLimit, 5, 2, 30),
    regexEnabled: bool("regexEnabled"),
    regexRules: Array.isArray(input.regexRules)
      ? input.regexRules
          .filter((rule): rule is string => typeof rule === "string")
          .map((rule) => rule.trim())
          .filter(isSafeRegex)
          .slice(0, 20)
      : [],
    prefix: text("prefix", 5) || defaultConfig.prefix,
    customCommandsEnabled: bool("customCommandsEnabled"),
    joinGuardEnabled: bool("joinGuardEnabled"),
    minimumAccountAgeDays: safeInteger(input.minimumAccountAgeDays, 7, 0, 365),
    boostEnabled: bool("boostEnabled"),
    boostChannelId: text("boostChannelId", 30),
    boostMessage: text("boostMessage"),
    roleMessageEnabled: bool("roleMessageEnabled"),
    roleMessageChannelId: text("roleMessageChannelId", 30),
    roleMessage: text("roleMessage"),
    notifyUsers: bool("notifyUsers"),
    ticketsEnabled: bool("ticketsEnabled"),
    ticketCategoryId: text("ticketCategoryId", 30),
    ticketStaffRoleId: text("ticketStaffRoleId", 30),
    ticketRetentionDays: retention,
  };
}

export function formatMessage(
  template: string,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
