import {
  PermissionFlagsBits,
  type GuildMember,
  type Role,
} from "discord.js";

const safeAutoRolePermissions =
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.Stream |
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.UseExternalEmojis |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.UseVAD |
  PermissionFlagsBits.ChangeNickname |
  PermissionFlagsBits.UseApplicationCommands |
  PermissionFlagsBits.RequestToSpeak |
  PermissionFlagsBits.UseExternalStickers |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.UseEmbeddedActivities |
  PermissionFlagsBits.UseSoundboard |
  PermissionFlagsBits.UseExternalSounds |
  PermissionFlagsBits.SendVoiceMessages |
  PermissionFlagsBits.SendPolls;

export function isConfigurableRole(guildId: string, role: Role | undefined) {
  return Boolean(role && role.id !== guildId && !role.managed);
}

export function hasConfiguredRole(
  member: GuildMember,
  roleIds: string[],
  guildId = member.guild.id,
) {
  return roleIds.some((roleId) => {
    if (roleId === guildId) return false;
    const role = member.roles.cache.get(roleId);
    return Boolean(role && !role.managed);
  });
}

export function autoRoleError(
  guildId: string,
  role: Role | undefined,
  botMember: GuildMember | null,
) {
  if (!isConfigurableRole(guildId, role))
    return "Choose an existing, non-managed role other than @everyone";
  if ((role!.permissions.bitfield & ~safeAutoRolePermissions) !== 0n)
    return "Auto-role cannot grant administrative or moderation permissions";
  if (!botMember)
    return "Astra's guild member could not be resolved";
  if (role!.position >= botMember.roles.highest.position)
    return "Astra cannot assign a role at or above its own highest role";
  return null;
}
