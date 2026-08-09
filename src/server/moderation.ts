import type { GuildConfig } from "./config.js";
import type { Capabilities } from "./plans.js";

export type AutomodReason =
  | "invitesBlocked"
  | "linksBlocked"
  | "mentionsBlocked"
  | "spamBlocked"
  | "duplicateBlocked"
  | "wordBlocked"
  | "capsBlocked"
  | "regexBlocked";

type MessageWindow = {
  times: number[];
  duplicates: Array<{ content: string; at: number }>;
};

export type AutomodMessage = {
  guildId: string;
  userId: string;
  content: string;
  userMentions: number;
  roleMentions: number;
  now?: number;
};

export class AutomodEngine {
  private windows = new Map<string, MessageWindow>();

  clear() {
    this.windows.clear();
  }

  evaluate(
    message: AutomodMessage,
    config: GuildConfig,
    capabilities: Pick<Capabilities, "basicAutomod" | "advancedAutomod">,
  ): AutomodReason | null {
    if (!config.automodEnabled) return null;

    const content = message.content.toLowerCase();
    if (
      capabilities.basicAutomod &&
      config.blockInvites &&
      /discord(?:app)?\.(?:gg|com\/invite)\//i.test(content)
    )
      return "invitesBlocked";
    if (
      capabilities.basicAutomod &&
      config.blockLinks &&
      /https?:\/\/|www\./i.test(content)
    )
      return "linksBlocked";
    if (
      capabilities.basicAutomod &&
      config.mentionSpamEnabled &&
      message.userMentions + message.roleMentions >= config.mentionLimit
    )
      return "mentionsBlocked";

    const rateReason = capabilities.basicAutomod
      ? this.rateLimitReason(message, config)
      : null;
    if (rateReason) return rateReason;

    if (
      capabilities.advancedAutomod &&
      config.bannedWords.some((word) =>
        new RegExp(
          `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i",
        ).test(content),
      )
    )
      return "wordBlocked";

    const letters = message.content.replace(/[^a-z]/gi, "");
    const capitals = letters.replace(/[^A-Z]/g, "").length;
    if (
      capabilities.advancedAutomod &&
      letters.length >= 10 &&
      (capitals / letters.length) * 100 >= config.maxCapsPercent
    )
      return "capsBlocked";
    if (
      capabilities.advancedAutomod &&
      config.regexEnabled &&
      config.regexRules.some((pattern) => new RegExp(pattern, "i").test(message.content))
    )
      return "regexBlocked";
    return null;
  }

  private rateLimitReason(
    message: AutomodMessage,
    config: GuildConfig,
  ): "spamBlocked" | "duplicateBlocked" | null {
    if (!config.spamEnabled && !config.duplicateEnabled) return null;
    const now = message.now ?? Date.now();
    const key = `${message.guildId}:${message.userId}`;
    const current = this.windows.get(key) || { times: [], duplicates: [] };
    current.times = current.times.filter(
      (timestamp) => now - timestamp <= config.spamWindowSeconds * 1000,
    );
    current.duplicates = current.duplicates.filter(
      (item) => now - item.at <= config.duplicateWindowSeconds * 1000,
    );
    current.times.push(now);
    const normalized = message.content.trim().toLowerCase();
    if (normalized)
      current.duplicates.push({ content: normalized, at: now });
    this.windows.set(key, current);

    if (this.windows.size > 10_000)
      for (const [itemKey, value] of this.windows)
        if (!value.times.some((timestamp) => now - timestamp < 120_000))
          this.windows.delete(itemKey);

    if (config.spamEnabled && current.times.length >= config.spamMessageLimit)
      return "spamBlocked";
    const duplicateCount = current.duplicates.filter(
      (item) => item.content === normalized,
    ).length;
    if (
      config.duplicateEnabled &&
      normalized.length >= 3 &&
      duplicateCount >= config.duplicateMessageLimit
    )
      return "duplicateBlocked";
    return null;
  }
}
