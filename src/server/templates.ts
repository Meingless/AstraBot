import { defaultConfig, sanitizeConfig, type GuildConfig, type SetupTemplate } from "./config.js";

const templatePatches: Record<SetupTemplate, Partial<GuildConfig>> = {
  empty: {},
  gaming: {
    welcomeEnabled: true,
    autoRoleEnabled: true,
    logsEnabled: true,
    automodEnabled: true,
    blockInvites: true,
    spamEnabled: true,
    duplicateEnabled: true,
    mentionSpamEnabled: true,
    joinGuardEnabled: true,
    ticketsEnabled: true,
  },
  creator: {
    welcomeEnabled: true,
    autoRoleEnabled: true,
    logsEnabled: true,
    automodEnabled: true,
    blockInvites: true,
    blockLinks: false,
    spamEnabled: true,
    ticketsEnabled: true,
  },
  support: {
    welcomeEnabled: true,
    logsEnabled: true,
    automodEnabled: true,
    blockInvites: true,
    blockLinks: false,
    spamEnabled: true,
    duplicateEnabled: true,
    ticketsEnabled: true,
    ticketRetentionDays: 30,
  },
};

export function previewTemplate(
  current: GuildConfig,
  template: SetupTemplate,
): GuildConfig {
  const patch = templatePatches[template];
  const localizedMessages =
    current.locale === "tr"
      ? {
          welcomeMessage: "{user}, **{server}** sunucusuna hoş geldin! Sen #{count}. üyesin.",
          goodbyeMessage: "**{username}**, {server} sunucusundan ayrıldı.",
          boostMessage: "**{server}** sunucusuna boost bastığın için teşekkürler {user}!",
          roleMessage: "{user}, **{role}** rolünü aldı.",
        }
      : {};
  const identifiers = {
    welcomeChannelId: current.welcomeChannelId,
    goodbyeChannelId: current.goodbyeChannelId,
    autoRoleId: current.autoRoleId,
    logsChannelId: current.logsChannelId,
    boostChannelId: current.boostChannelId,
    roleMessageChannelId: current.roleMessageChannelId,
    ticketCategoryId: current.ticketCategoryId,
    ticketStaffRoleId: current.ticketStaffRoleId,
    dashboardAdminRoleIds: current.dashboardAdminRoleIds,
    moderatorRoleIds: current.moderatorRoleIds,
  };
  return sanitizeConfig({
    ...defaultConfig,
    locale: current.locale,
    ...patch,
    ...localizedMessages,
    ...identifiers,
    setupTemplate: template,
    setupCompleted: true,
  });
}
