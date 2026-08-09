import { describe, expect, it } from "vitest";
import { emojiKey, emojiMatches, normalizeEmoji } from "./emoji.js";

describe("Discord emoji normalization", () => {
  it("normalizes custom and percent-encoded Unicode emoji", () => {
    expect(normalizeEmoji("<a:dance:123456789012345678>"))
      .toBe("dance:123456789012345678");
    expect(normalizeEmoji("%F0%9F%9A%80")).toBe("🚀");
  });

  it("matches stored Unicode and custom emoji against Discord objects", () => {
    expect(emojiMatches("🚀", { name: "🚀", identifier: "%F0%9F%9A%80" })).toBe(true);
    expect(emojiMatches("dance:123", { id: "123", name: "dance" })).toBe(true);
    expect(emojiKey({ id: "123", name: null })).toBe("emoji:123");
  });

  it("keeps malformed encodings stable", () => {
    expect(normalizeEmoji("%E0%A4%A")).toBe("%E0%A4%A");
  });
});
