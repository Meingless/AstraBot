type DiscordEmoji = {
  id?: string | null;
  name?: string | null;
  identifier?: string;
};

export function normalizeEmoji(value: string) {
  let normalized = value.trim();
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep malformed percent sequences unchanged so validation can reject them.
  }
  const customEmoji = normalized.match(/^<a?:([^:>]+):(\d+)>$/);
  return customEmoji ? `${customEmoji[1]}:${customEmoji[2]}` : normalized;
}

export function emojiKey(emoji: DiscordEmoji) {
  if (emoji.id) return `${emoji.name || "emoji"}:${emoji.id}`;
  return normalizeEmoji(emoji.name || emoji.identifier || "");
}

export function emojiMatches(stored: string, emoji: DiscordEmoji) {
  return normalizeEmoji(stored) === emojiKey(emoji);
}
