import { describe, expect, it } from "vitest";
import { sanitizeConfig } from "./config.js";
import { AutomodEngine } from "./moderation.js";

const basic = { basicAutomod: true, advancedAutomod: false };
const advanced = { basicAutomod: true, advancedAutomod: true };

function config(patch: Record<string, unknown> = {}) {
  return sanitizeConfig({
    automodEnabled: true,
    blockInvites: false,
    blockLinks: false,
    spamEnabled: false,
    duplicateEnabled: false,
    mentionSpamEnabled: false,
    bannedWords: [],
    maxCapsPercent: 100,
    regexEnabled: false,
    regexRules: [],
    ...patch,
  });
}

function message(content: string, patch: Record<string, unknown> = {}) {
  return {
    guildId: "guild",
    userId: "user",
    content,
    userMentions: 0,
    roleMentions: 0,
    now: 1_000,
    ...patch,
  };
}

describe("deterministic AutoMod engine", () => {
  it("detects invite, link, and mention rules", () => {
    expect(
      new AutomodEngine().evaluate(
        message("join discord.gg/astra"),
        config({ blockInvites: true }),
        basic,
      ),
    ).toBe("invitesBlocked");
    expect(
      new AutomodEngine().evaluate(
        message("see https://example.com"),
        config({ blockLinks: true }),
        basic,
      ),
    ).toBe("linksBlocked");
    expect(
      new AutomodEngine().evaluate(
        message("hello", { userMentions: 2, roleMentions: 1 }),
        config({ mentionSpamEnabled: true, mentionLimit: 3 }),
        basic,
      ),
    ).toBe("mentionsBlocked");
  });

  it("enforces flood windows and expires old events", () => {
    const engine = new AutomodEngine();
    const rules = config({
      spamEnabled: true,
      spamMessageLimit: 3,
      spamWindowSeconds: 5,
    });
    expect(engine.evaluate(message("one", { now: 0 }), rules, basic)).toBeNull();
    expect(engine.evaluate(message("two", { now: 1_000 }), rules, basic)).toBeNull();
    expect(engine.evaluate(message("three", { now: 2_000 }), rules, basic)).toBe("spamBlocked");
    expect(engine.evaluate(message("later", { now: 10_000 }), rules, basic)).toBeNull();
  });

  it("detects normalized duplicate messages", () => {
    const engine = new AutomodEngine();
    const rules = config({
      duplicateEnabled: true,
      duplicateMessageLimit: 2,
      duplicateWindowSeconds: 30,
    });
    expect(engine.evaluate(message("  SAME message ", { now: 0 }), rules, basic)).toBeNull();
    expect(engine.evaluate(message("same MESSAGE", { now: 1 }), rules, basic)).toBe("duplicateBlocked");
  });

  it("keeps premium content rules behind advanced capability", () => {
    const banned = config({ bannedWords: ["scam"] });
    expect(new AutomodEngine().evaluate(message("a scam offer"), banned, basic)).toBeNull();
    expect(new AutomodEngine().evaluate(message("a scam offer"), banned, advanced)).toBe("wordBlocked");
    expect(
      new AutomodEngine().evaluate(
        message("THIS IS VERY LOUD"),
        config({ maxCapsPercent: 80 }),
        advanced,
      ),
    ).toBe("capsBlocked");
    expect(
      new AutomodEngine().evaluate(
        message("free nitro gift"),
        config({ regexEnabled: true, regexRules: ["free\\s+nitro"] }),
        advanced,
      ),
    ).toBe("regexBlocked");
  });

  it("does nothing while AutoMod is disabled", () => {
    const engine = new AutomodEngine();
    expect(
      engine.evaluate(
        message("discord.gg/astra"),
        config({ automodEnabled: false, blockInvites: true }),
        advanced,
      ),
    ).toBeNull();
    engine.clear();
  });
});
