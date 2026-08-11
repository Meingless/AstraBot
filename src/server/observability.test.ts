import { afterEach, describe, expect, it, vi } from "vitest";
import { gauge, increment, log, metricsText } from "./observability.js";

afterEach(() => vi.restoreAllMocks());

describe("observability", () => {
  it("removes sensitive fields from structured logs", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("info", "safe_event", {
      guildId: "guild",
      token: "do-not-log",
      nested: { content: "private", count: 2 },
    });
    const parsed = JSON.parse(String(output.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(parsed).toMatchObject({ level: "info", event: "safe_event", guildId: "guild" });
    expect(JSON.stringify(parsed)).not.toContain("do-not-log");
    expect(JSON.stringify(parsed)).not.toContain("private");
  });

  it("redacts secrets embedded inside otherwise safe string fields", () => {
    process.env.OBSERVABILITY_TEST_TOKEN = "embedded-secret-value";
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log("error", "provider_failed", {
      message:
        "Bearer abc.def token=inline-secret endpoint?key=query-secret embedded-secret-value",
    });
    const rendered = String(output.mock.calls[0]?.[0]);
    expect(rendered).not.toContain("abc.def");
    expect(rendered).not.toContain("inline-secret");
    expect(rendered).not.toContain("query-secret");
    expect(rendered).not.toContain("embedded-secret-value");
    delete process.env.OBSERVABILITY_TEST_TOKEN;
  });

  it("renders counters and gauges in Prometheus format", () => {
    increment("test_counter", 2);
    gauge("test_gauge", 7);
    expect(metricsText()).toContain("astra_test_counter 2");
    expect(metricsText()).toContain("astra_test_gauge 7");
  });
});
