export type User = {
  id: string;
  username: string;
  avatar: string | null;
  global_name?: string | null;
};

export type Guild = {
  id: string;
  name: string;
  icon: string | null;
  botPresent: boolean;
  accessLevel: "moderator" | "admin";
};

export type Config = {
  locale: "tr" | "en";
  setupCompleted: boolean;
  setupTemplate: "gaming" | "creator" | "support" | "empty";
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
  ticketRetentionDays: 0 | 30 | 90;
};

export type ReactionRole = {
  id: number;
  channelId: string;
  messageId: string;
  emoji: string;
  roleId: string;
};

export type CustomCommand = { id: number; name: string; response: string };

export type ModerationCase = {
  id: number;
  action: string;
  reason: string;
  created_at: number;
};

export type SubscriptionPlan = "free" | "standard" | "premium" | "ai";

export type Subscription = {
  plan: SubscriptionPlan;
  status: "active" | "expired";
  startsAt: number;
  expiresAt: number | null;
};

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

export type Ticket = {
  id: number;
  guildId: string;
  channelId: string;
  ownerId: string;
  ownerName: string;
  assigneeId: string | null;
  status: "open" | "assigned" | "closed";
  createdAt: number;
  assignedAt: number | null;
  closedAt: number | null;
  transcriptExpiresAt: number | null;
  hasTranscript: boolean;
};

export type DeveloperGuildSubscription = {
  id: string;
  name: string;
  memberCount: number;
  subscription: Subscription;
};

export type BillingGuild = {
  id: string;
  name: string;
  icon: string | null;
  subscription: Subscription;
};

export type BillingOverview = {
  guilds: BillingGuild[];
  plans: Plan[];
  paymentsEnabled: boolean;
};

export type GuildData = {
  config: Config;
  premium: boolean;
  subscription: Subscription;
  capabilities: Capabilities;
  limits: PlanLimits;
  stats: { members: number; channels: number; roles: number };
  channels: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  roles: { id: string; name: string; color: string }[];
  reactionRoles: ReactionRole[];
  customCommands: CustomCommand[];
  cases: ModerationCase[];
  auditEvents: AuditEvent[];
  tickets: Ticket[];
  transcriptEncryptionAvailable: boolean;
};

export type Plan = {
  id: "standard" | "premium" | "ai";
  name: string;
  enabled: boolean;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  accent: "standard" | "premium" | "ai";
};

export type SiteSettings = {
  maintenanceMode: boolean;
  announcement: string;
  premiumGuildIds?: string[];
  aiProvider: "openai" | "openrouter" | "gemini" | "moonshot" | "custom";
  aiModel: string;
  aiBaseUrl: string;
  plans: Plan[];
};

export type IconName =
  | "orbit"
  | "grid"
  | "spark"
  | "shield"
  | "sliders"
  | "log"
  | "arrow"
  | "menu"
  | "close"
  | "check"
  | "users"
  | "hash"
  | "roles";
