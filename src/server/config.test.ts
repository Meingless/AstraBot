import { describe, expect, it } from "vitest";
import { formatMessage, isSafeRegex, sanitizeConfig } from "./config.js";
import { previewTemplate } from "./templates.js";

describe("guild configuration", () => {
  it("fills new fields while ignoring retired AI moderation values", () => {
    const config = sanitizeConfig({
      locale: "tr",
      aiModerationEnabled: true,
      aiModerationThreshold: 99,
      spamMessageLimit: 999,
      ticketRetentionDays: 90,
    });
    expect(config.locale).toBe("tr");
    expect(config.spamMessageLimit).toBe(20);
    expect(config.ticketRetentionDays).toBe(90);
    expect(config).not.toHaveProperty("aiModerationEnabled");
  });

  it("rejects unsafe or invalid regular expressions", () => {
    expect(isSafeRegex("(?:free|nitro)\\s+gift")).toBe(true);
    expect(isSafeRegex("(a+)+$")).toBe(false);
    expect(isSafeRegex("(a|aa)+$")).toBe(false);
    expect(isSafeRegex("a+a+$")).toBe(false);
    expect(isSafeRegex("[")).toBe(false);
  });

  it("applies templates without overwriting Discord identifiers", () => {
    const current = sanitizeConfig({
      locale: "tr",
      logsChannelId: "12345678901234567",
      ticketStaffRoleId: "22345678901234567",
    });
    const result = previewTemplate(current, "support");
    expect(result.setupCompleted).toBe(true);
    expect(result.setupTemplate).toBe("support");
    expect(result.ticketsEnabled).toBe(true);
    expect(result.logsChannelId).toBe(current.logsChannelId);
    expect(result.ticketStaffRoleId).toBe(current.ticketStaffRoleId);
  });

  it("normalizes identifiers, lists, colors, prefixes, and numeric bounds", () => {
    const validRole = "123456789012345678";
    const result = sanitizeConfig({
      dashboardAdminRoleIds: [validRole, validRole, "bad"],
      moderatorRoleIds: ["223456789012345678"],
      welcomeColor: "javascript:red",
      bannedWords: [" Scam ", 7, ""],
      regexRules: ["safe\\s+rule", "(a+)+$"],
      prefix: "123456789",
      minimumAccountAgeDays: -20,
      duplicateWindowSeconds: 999,
      ticketRetentionDays: 31,
    });
    expect(result.dashboardAdminRoleIds).toEqual([validRole]);
    expect(result.welcomeColor).toBe("#8b5cf6");
    expect(result.bannedWords).toEqual(["scam"]);
    expect(result.regexRules).toEqual(["safe\\s+rule"]);
    expect(result.prefix).toBe("12345");
    expect(result.minimumAccountAgeDays).toBe(0);
    expect(result.duplicateWindowSeconds).toBe(120);
    expect(result.ticketRetentionDays).toBe(30);
  });

  it("formats every occurrence of known placeholders", () => {
    expect(formatMessage("{user} joined {server}; welcome {user}", {
      user: "Astra",
      server: "Orbit",
    })).toBe("Astra joined Orbit; welcome Astra");
  });

  it.each(["gaming", "creator", "support", "empty"] as const)(
    "produces a completed %s setup",
    (template) => {
      const result = previewTemplate(sanitizeConfig({ locale: "en" }), template);
      expect(result.setupCompleted).toBe(true);
      expect(result.setupTemplate).toBe(template);
    },
  );
});
