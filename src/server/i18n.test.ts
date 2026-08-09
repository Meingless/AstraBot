import { describe, expect, it } from "vitest";
import { t } from "./i18n.js";

describe("bot translations", () => {
  it("returns English and Turkish messages with replacements", () => {
    expect(t("en", "ticketCreated", { channel: "<#1>" })).toContain("<#1>");
    expect(t("tr", "ticketCreated", { channel: "<#1>" })).toContain("oluşturuldu");
    expect(t("tr", "aiQuota", { count: 100 })).toContain("100");
  });
});
